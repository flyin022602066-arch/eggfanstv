import { describe, expect, test } from "bun:test";

import {
    chapterStoryboardAssets,
    chapterStoryboardCharacters,
    chapterStoryboardReplaceImpact,
    storyboardRowsToProjectShots,
} from "@/pages/projects/detail/chapter-storyboard-production";
import type { ProjectDetail } from "@/services/api/projects";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";
import type { StoryboardRow } from "@/types/canvas";

describe("章节分镜写入分镜制作", () => {
    test("拆解提供历史造型定稿并按所选版本绑定，排除缺图或未定稿版本", () => {
        const detail = projectDetail();
        const historical: CharacterReferenceVersion = {
            ...detail.assets[0]!.character!, assetId: "character-1", title: "林默", versionId: "historical-look", updatedAt: "",
            representations: [{ id: "rep", resourceId: "historical-image", role: "primary", mediaType: "image" }],
            referenceProfile: { lookId: "school", name: "校服少年", description: "少年时期的蓝白校服", matchHints: "少年时期", excludeHints: "成年", enabled: true, preferred: true, default: false },
        };
        const versions = [historical, { ...historical, versionId: "unreviewed", version: 2, referenceProfile: { ...historical.referenceProfile!, preferred: false } }, { ...historical, versionId: "missing-image", version: 3, representations: [] }];
        expect(chapterStoryboardAssets(detail, versions)[0]?.characterLooks).toEqual([expect.objectContaining({ versionId: "historical-look", name: "校服少年" })]);
        const [shot] = storyboardRowsToProjectShots([{ ...storyboardRow(), characters: [{ characterName: "林默", characterAssetId: "character-1", characterVersionId: "historical-look" }] }], detail, versions);
        expect(shot!.assetVersionIds).toContain("historical-look");
        expect(shot!.assetVersionIds).not.toContain("asset-version-1");
    });

    test("写入前拒绝其他角色的版本及同人多版本同框", () => {
        const detail = projectDetail();
        const versions: CharacterReferenceVersion[] = [{ ...detail.assets[0]!.character!, assetId: "character-1", title: "林默", updatedAt: "" }];
        const wrong = { characterName: "林默", characterAssetId: "character-1", characterVersionId: "foreign-version" };
        expect(() => storyboardRowsToProjectShots([{ ...storyboardRow(), characters: [wrong] }], detail, versions)).toThrow("不属于该角色");
        const valid = { ...wrong, characterVersionId: "asset-version-1" };
        expect(() => storyboardRowsToProjectShots([{ ...storyboardRow(), characters: [valid, valid] }], detail, versions)).toThrow("拆镜头");
    });

    test("模型写错场景 ID 时按本项目唯一场景名称回填，不阻断整章分镜", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "bedroom", title: "纪昼房间", category: "environment", primaryVersionId: "bedroom-v1" });
        const shots = storyboardRowsToProjectShots([
            { ...storyboardRow(), sceneAssetId: "hallucinated-id", sceneName: "纪家住所晚餐处、纪昼房间" },
            { ...storyboardRow(), sceneAssetId: "hallucinated-id", sceneName: "纪昼房间" },
        ], detail);
        expect(shots).toHaveLength(2);
        for (const shot of shots) {
            expect(shot.assetVersionIds).toContain("bedroom-v1");
            expect(shot.revision.actionBeats).toContainEqual(expect.objectContaining({ type: "asset_context", sceneAssetId: "bedroom" }));
        }
        expect(shots[0]!.revision.actionBeats).toContainEqual(expect.objectContaining({ sceneName: "纪家住所晚餐处、纪昼房间" }));
    });

    test("生成结果中未建的场景保留名称待补齐，不捏造绑定或丢弃剧情", () => {
        const [shot] = storyboardRowsToProjectShots([{ ...storyboardRow(), sceneAssetId: "unknown", sceneName: "训练区更衣空间" }], projectDetail());
        expect(shot!.revision.actionBeats).toContainEqual(expect.objectContaining({ type: "asset_context", sceneAssetId: "", sceneName: "训练区更衣空间" }));
        expect(shot!.revision.videoPrompt).toContain(storyboardRow().videoMotionPrompt);
    });

    test("场景名称重名时仍要求核对，不能把错误 ID 绑定到任意场景", () => {
        const detail = projectDetail();
        for (const id of ["bedroom-a", "bedroom-b"]) detail.assets.push({ ...detail.assets[1]!, id, title: "纪昼房间", category: "environment", primaryVersionId: `${id}-v1` });
        expect(() => storyboardRowsToProjectShots([{ ...storyboardRow(), sceneAssetId: "unknown", sceneName: "纪昼房间" }], detail)).toThrow("重名");
    });

    test("没有场景名称的错误 ID 仍需核对，真实场景 ID 不被旧名称覆盖", () => {
        const detail = projectDetail();
        expect(() => storyboardRowsToProjectShots([{ ...storyboardRow(), sceneAssetId: "unknown" }], detail)).toThrow("场景");
        detail.assets.push({ ...detail.assets[1]!, id: "bedroom", title: "纪昼房间", category: "environment", primaryVersionId: "bedroom-v1" });
        const [shot] = storyboardRowsToProjectShots([{ ...storyboardRow(), sceneAssetId: "bedroom", sceneName: "旧房间名" }], detail);
        expect(shot!.assetVersionIds).toContain("bedroom-v1");
    });

    test("按明确名称核对模型写错的资产 ID 后再持久化提示词与真实绑定", () => {
        const detail = projectDetail();
        const prompt = "将@[asset:wrong-character]定义为<林默>，将@[asset:wrong-prop]定义为<旧信封>。\n镜头1：@[asset:wrong-character]递出@[asset:wrong-prop]。";
        const [shot] = storyboardRowsToProjectShots([{ ...storyboardRow(), videoMotionPrompt: prompt, imageGenerationPrompt: prompt }], detail);

        expect(shot!.revision.videoPrompt).not.toContain("wrong-");
        expect(shot!.revision.imagePrompt).not.toContain("wrong-");
        expect(shot!.revision.videoPrompt).toContain("@[asset:character-1]递出@[asset:prop-1]");
        expect(shot!.assetVersionIds).toEqual(expect.arrayContaining(["asset-version-1", "asset-version-2"]));
    });

    test("资产白名单把场景道具标准名称及别名一起交给分镜模型", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "classroom", title: "文化楼教室", category: "environment", primaryVersionId: "classroom-v1", definitionJson: JSON.stringify({ aliases: ["文化楼核心班教室"] }) });
        expect(chapterStoryboardAssets(detail).find((asset) => asset.id === "classroom")).toMatchObject({ title: "文化楼教室", aliases: ["文化楼核心班教室"] });
    });

    test("已匹配主场景不覆盖分镜里的复合地点名称，后续仍能补齐第二个场景", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "clinic", title: "医务楼诊室", category: "environment", primaryVersionId: "clinic-v1" });
        const [shot] = storyboardRowsToProjectShots([{ ...storyboardRow(), sceneName: "监控室与医务楼诊室" }], detail);
        expect(shot!.assetVersionIds).toContain("clinic-v1");
        expect(shot!.revision.actionBeats).toContainEqual(expect.objectContaining({ type: "asset_context", sceneAssetId: "clinic", sceneName: "监控室与医务楼诊室" }));
    });

    test("拟人化系统只绑定角色，不自动补绑同项目旧面板", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[0]!, id: "sprite", title: "小白", primaryVersionId: "sprite-v1", character: { ...detail.assets[0]!.character!, versionId: "sprite-v1" } });
        detail.assets.push({ ...detail.assets[1]!, id: "panel", title: "进化系统面板", primaryVersionId: "panel-v1" });
        const [shot] = storyboardRowsToProjectShots([{
            ...storyboardRow(), characters: [{ characterName: "小白" }], assetBindings: [], propNames: [],
            systemElements: ["【宿主：苏夜】\n【等级：D级】"],
            systemPresentation: { mode: "character", characterName: "小白", characterAppearance: "白色狐狸精灵", characterVoice: "清亮少女音" },
        }], detail);
        expect(shot!.assetVersionIds).toContain("sprite-v1");
        expect(shot!.assetVersionIds).not.toContain("panel-v1");
        expect(shot!.revision.videoPrompt).toContain("小白");
        expect(shot!.revision.videoPrompt).not.toContain("作为本镜画面内的系统界面");
        expect(shot!.revision.actionBeats).toContainEqual(expect.objectContaining({ type: "system_elements", presentation: expect.objectContaining({ mode: "character" }) }));
    });

    test("将分镜任务结果完整映射为镜头脚本", () => {
        const shots = storyboardRowsToProjectShots([storyboardRow()], projectDetail());

        expect(shots).toHaveLength(1);
        expect(shots[0]).toMatchObject({
            title: "镜头01",
            description: "林默推门进入雨夜的旧屋。",
            durationMs: 5000,
            revision: {
                plotDescription: "林默推门进入雨夜的旧屋。",
                dialogue: "林默：有人吗？",
                shotSize: "中景",
                cameraAngle: "平视，35mm",
                cameraMovement: "缓慢推进",
                imagePrompt: "雨夜旧屋中的林默",
                videoPrompt: "林默推门，镜头缓慢推进\n\n【角色参考】\n林默：@[asset:character-1]\n\n【场景与道具参考】\n旧信封：@[asset:prop-1]",
                continuityNotes: "林默停在门内，右手仍扶着门把",
                actionBeats: [{ description: "0-2 秒推门；2-5 秒环顾" }],
            },
        });
        expect(shots[0].assetVersionIds).toEqual(expect.arrayContaining(["asset-version-1", "asset-version-2"]));
        expect(shots[0].revision.action).toContain("表演调度：林默谨慎推门并环顾室内");
        expect(shots[0].revision.action).toContain("声音：雨声与木门摩擦声");
    });

    test("把已确认角色和本章待确认角色交给分镜任务", () => {
        const detail = projectDetail();

        expect(chapterStoryboardCharacters(detail, "chapter-1")).toEqual([
            { assetId: "character-1", versionId: "asset-version-1", name: "林默", definition: { appearance: "黑色风衣" } },
            { name: "张天昊", definition: { role: "主角" } },
        ]);
        expect(chapterStoryboardAssets(detail).map((asset) => ({ id: asset.id, type: asset.type, characterVersionId: asset.characterVersionId }))).toEqual([
            { id: "character-1", type: "character", characterVersionId: "asset-version-1" },
            { id: "prop-1", type: "image", characterVersionId: undefined },
        ]);
    });

    test("替换确认统计该章会被删除的关联数据", () => {
        expect(chapterStoryboardReplaceImpact(projectDetail(), "chapter-1")).toEqual({
            shotCount: 1,
            revisionCount: 1,
            referenceCount: 1,
            artifactCount: 1,
            candidateCount: 1,
        });
    });

    test("模型仅返回角色名时仍绑定角色和镜头中出现的场景道具", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "scene-1", title: "雨夜旧屋", category: "environment", primaryVersionId: "scene-version" });
        const row = { ...storyboardRow(), characters: ["林默"], assetBindings: [], plotDescription: "林默进入雨夜旧屋，握着旧信封。" } as unknown as StoryboardRow;
        const [shot] = storyboardRowsToProjectShots([row], detail);

        expect(shot?.assetVersionIds).toEqual(expect.arrayContaining(["asset-version-1", "asset-version-2", "scene-version"]));
        expect(shot?.revision.videoPrompt).toContain("林默：@[asset:character-1]");
        expect(shot?.revision.videoPrompt).toContain("雨夜旧屋：@[asset:scene-1]");
    });

    test("连续镜头逐镜绑定场景，道具不从上镜继承，转场后采用新场景", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "scene-1", title: "雨夜旧屋", category: "environment", primaryVersionId: "scene-v1" });
        detail.assets.push({ ...detail.assets[1]!, id: "scene-2", title: "庭院", category: "environment", primaryVersionId: "scene-v2" });
        const row = storyboardRow();
        const shots = storyboardRowsToProjectShots([
            { ...row, sceneAssetId: "scene-1", sceneName: "雨夜旧屋" },
            { ...row, assetBindings: [], imageGenerationPrompt: "人物抬头", plotDescription: "林默环顾屋内", dialogue: "林默：把旧信封拿来。" },
            { ...row, assetBindings: [], sceneAssetId: "scene-2", sceneName: "庭院", sceneChange: true, propNames: [] },
        ], detail);
        expect(shots.map((shot) => shot.assetVersionIds)).toEqual([
            expect.arrayContaining(["scene-v1", "asset-version-2"]),
            expect.arrayContaining(["scene-v1"]),
            expect.arrayContaining(["scene-v2"]),
        ]);
        expect(shots[1]!.assetVersionIds).not.toContain("asset-version-2");
        expect(shots[2]!.assetVersionIds).not.toContain("scene-v1");
    });

    test("30秒单元保留镜头顺序和起落幅与结构化场景上下文", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "scene-1", title: "雨夜旧屋", category: "environment", primaryVersionId: "scene-v1" });
        const timeline = "镜头1：固定。起幅：林默站在门外。→ 落幅：他推门进入雨夜旧屋。脚步踏响木板。\n镜头2：缓慢推进。起幅：林默手持旧信封。→ 落幅：他将信封递到桌前。对白：请收好。";
        const [shot] = storyboardRowsToProjectShots([{ ...storyboardRow(), durationSeconds: 30, sceneAssetId: "scene-1", sceneName: "雨夜旧屋", propNames: ["旧信封"], timeBeats: timeline, videoMotionPrompt: timeline }], detail);
        expect(shot!.durationMs).toBe(30000);
        expect(shot!.revision.videoPrompt).toContain(timeline);
        expect(shot!.revision.actionBeats).toEqual([{ description: timeline }, { type: "asset_context", sceneAssetId: "scene-1", sceneName: "雨夜旧屋", sceneChange: false, propNames: ["旧信封"] }]);
        expect(shot!.revision.videoPrompt).toContain("@[asset:scene-1]");
        expect(shot!.revision.action).toContain("镜头序列：");
    });

    test("系统面板原文进入图片、视频提示词和镜头元数据", () => {
        const elements = ["【宿主：苏夜】", "【状态：蛋（进度：0%）】"];
        const [shot] = storyboardRowsToProjectShots([{
            ...storyboardRow(),
            imageGenerationPrompt: "苏夜惊讶地看着前方。",
            videoMotionPrompt: "苏夜抬头，面前亮起提示面板。",
            systemElements: elements,
        }]);

        expect(shot!.revision.imagePrompt).toContain("【系统/界面元素】");
        expect(shot!.revision.imagePrompt).toContain(elements[0]!);
        expect(shot!.revision.videoPrompt).toContain(elements[1]!);
        expect(shot!.revision.action).toContain("系统/界面元素");
        expect(shot!.revision.actionBeats).toContainEqual({ type: "system_elements", elements });
    });

    test("模型漏写道具清单时仍按状态面板原文绑定界面道具，不误绑字段中提及的实体", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "system-ui", title: "进化系统面板", primaryVersionId: "system-ui-v1" });
        const [shot] = storyboardRowsToProjectShots([{
            ...storyboardRow(), assetBindings: [], propNames: [], characters: [],
            plotDescription: "面板亮起。", imageGenerationPrompt: "属性面板亮起。", videoMotionPrompt: "面板数据逐行亮起。",
            narrativeIntent: "展现状态", performanceBlocking: "", continuityOut: "", timeBeats: "",
            systemElements: ["【进化系统启动中】\n【宿主：苏夜】\n【等级：D级】\n【装备：旧信封】"],
        }], detail);
        expect(shot!.assetVersionIds).toEqual(["system-ui-v1"]);
        expect(shot!.revision.videoPrompt).toContain("@[asset:system-ui]");
    });

    test("纯声音系统提示不自动绑定面板或要求首帧画出面板", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "system-ui", title: "进化系统面板", primaryVersionId: "system-ui-v1" });
        const [shot] = storyboardRowsToProjectShots([{
            ...storyboardRow(), assetBindings: [], propNames: [],
            systemElements: ["【叮！任务完成！】"],
        }], detail);
        expect(shot!.assetVersionIds).not.toContain("system-ui-v1");
        expect(shot!.revision.imagePrompt).toContain("提示音或播报");
        expect(shot!.revision.imagePrompt).not.toContain("作为本镜画面内的系统界面");
    });

    test("30秒整章覆盖保留超过六个资产的完整绑定", () => {
        const detail = projectDetail();
        detail.assets = Array.from({ length: 7 }, (_, index) => ({ ...detail.assets[1]!, id: `asset-${index}`, title: `道具${index}`, primaryVersionId: `version-${index}` }));
        const bindings = detail.assets.map((asset) => ({ nodeId: asset.id, role: "prop" as const, priority: 80 }));
        const rows = Array.from({ length: 4 }, (_, index) => ({ ...storyboardRow(), durationSeconds: 30, assetBindings: index === 3 ? bindings : bindings.slice(0, 3), characters: [], propNames: [] }));
        const shots = storyboardRowsToProjectShots(rows, detail);
        expect(shots).toHaveLength(4);
        expect(shots.every((shot) => shot.durationMs === 30000 && shot.revision.durationMs === 30000)).toBe(true);
        expect(shots[3]!.assetVersionIds).toHaveLength(7);
        for (const asset of detail.assets) expect(shots[3]!.revision.videoPrompt).toContain(`@[asset:${asset.id}]`);
    });

    test("未生图的已确认场景道具仍进入分镜资产白名单", () => {
        const detail = projectDetail();
        detail.assets.push({ ...detail.assets[1]!, id: "scene-text", title: "庭院", category: "environment", mediaType: "text", primaryVersionId: "scene-text-v1" });
        expect(chapterStoryboardAssets(detail)).toContainEqual(expect.objectContaining({ id: "scene-text", type: "text", category: "environment" }));
    });
});

function storyboardRow(): StoryboardRow {
    return {
        id: "row-1", shotNumber: 1, durationSeconds: 5,
        plotDescription: "林默推门进入雨夜的旧屋。", dialogue: "林默：有人吗？", characters: [{ characterName: "林默", characterAssetId: "character-1", characterVersionId: "asset-version-1" }],
        narrativeIntent: "建立悬念", viewerPOV: "跟随林默", performanceBlocking: "林默谨慎推门并环顾室内",
        shotSize: "中景", emotion: "戒备", lightingAndAtmosphere: "冷色月光与室内暖光交界", audioEffects: "雨声与木门摩擦声",
        camera: "平视，35mm", motion: "缓慢推进", timeBeats: "0-2 秒推门；2-5 秒环顾",
        imageGenerationPrompt: "雨夜旧屋中的林默", videoMotionPrompt: "林默推门，镜头缓慢推进",
        mustHave: [], optionalDetails: [], continuityOut: "林默停在门内，右手仍扶着门把", negativePrompt: "画面文字", assetBindings: [{ nodeId: "prop-1", role: "prop", priority: 80 }],
    };
}

function projectDetail(): ProjectDetail {
    return {
        project: { id: "project-1", userId: "user-1", name: "雨夜", type: "short_drama", aspectRatio: "16:9", sourceType: "novel", description: "", stylePresetId: "urban-live-action", status: "active", revision: 1, createdAt: "", updatedAt: "" },
        units: [], canvases: [], canvasUnitLinks: [], assetFolders: [], workflows: [],
        assets: [
            { id: "character-1", title: "林默", mediaType: "image", category: "character", status: "ready", primaryVersionId: "asset-version-1", versionCount: 1, usages: [], position: 0, updatedAt: "", character: { versionId: "asset-version-1", version: 1, definition: { appearance: "黑色风衣" }, representations: [], visualStatus: "ready", voiceStatus: "missing" } },
            { id: "prop-1", title: "旧信封", mediaType: "image", category: "prop", status: "ready", primaryVersionId: "asset-version-2", versionCount: 1, usages: [], position: 1, previewText: "泛黄的旧信封", updatedAt: "" },
            { id: "draft-prop", title: "未完成道具", mediaType: "image", category: "prop", status: "draft", versionCount: 0, usages: [], position: 2, updatedAt: "" },
        ],
        shots: [{ id: "shot-1", projectId: "project-1", unitId: "chapter-1", currentRevisionId: "revision-1", title: "SC.01", description: "旧分镜", position: 0, durationMs: 3000, status: "draft", createdAt: "", updatedAt: "" }],
        shotRevisions: [{ id: "revision-1", shotId: "shot-1", version: 1, plotDescription: "旧分镜", action: "", dialogue: "", shotSize: "", cameraAngle: "", cameraMovement: "", durationMs: 3000, imagePrompt: "", videoPrompt: "", negativePrompt: "", continuityNotes: "", actionBeatsJson: "[]", createdAt: "" }],
        shotArtifacts: [{ id: "artifact-1", projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", type: "storyboard", version: 1, status: "ready", selected: true, metadataJson: "{}", createdAt: "", updatedAt: "" }],
        shotReferences: [{ id: "reference-1", shotId: "shot-1", assetVersionId: "asset-version-1", role: "reference", status: "linked", createdAt: "" }],
        assetCandidates: [
            { id: "candidate-1", projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", name: "雨伞", category: "prop", status: "pending_confirmation", detailsJson: "{}", createdAt: "", updatedAt: "" },
            { id: "candidate-character-1", projectId: "project-1", unitId: "chapter-1", name: "张天昊", category: "character", status: "pending_confirmation", detailsJson: JSON.stringify({ role: "主角" }), createdAt: "", updatedAt: "" },
            { id: "candidate-character-other", projectId: "project-1", unitId: "chapter-2", name: "另一章角色", category: "character", status: "pending_confirmation", detailsJson: "{}", createdAt: "", updatedAt: "" },
        ],
    };
}
