import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, resolveShotAssetMentionPrompt } from "@/pages/projects/detail/workflow-shot-references";
import { unresolvedProjectAssetMentions } from "@/lib/project-asset-mentions";

describe("workflow shot asset references", () => {
    test("builds ordered image references for bound media and characters", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(context.mentionReferences.map((reference) => reference.label)).toEqual(["雨夜街道", "林默"]);
        expect(context.referenceImages.map((image) => image.id)).toEqual(["asset-scene", "asset-character"]);
        expect(context.referenceImages[1]?.storageKey).toBe("resource:character-cover");
    });

    test("resolves asset tokens to the submitted reference image order", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const [scene, character] = context.mentionReferences;
        const prompt = `让 ${canvasResourceMentionToken(character)} 从 ${canvasResourceMentionToken(scene)} 走近镜头`;

        expect(resolveShotAssetMentionPrompt(prompt, context)).toContain("让 图片2 从 图片1 走近镜头");
    });

    test("rejects stale mentions after an asset is unbound", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(() => resolveShotAssetMentionPrompt("跟随 @[asset:missing]", context)).toThrow("未绑定到当前镜头");
        expect(() => resolveShotAssetMentionPrompt("跟随 @[asset:missing]", context)).toThrow("资产 ID：missing");
    });

    test("identifies a known but unbound asset by title and ID", () => {
        const project = detail();
        project.assets.push({
            id: "asset-sword",
            title: "断剑",
            mediaType: "image",
            category: "prop",
            status: "confirmed",
            primaryVersionId: "version-sword",
            versionCount: 1,
            usages: [],
            position: 3,
            storageKey: "resource:sword-image",
            updatedAt: "2026-08-29T00:00:00Z",
        });
        const context = buildShotAssetReferenceContext(project, "shot-1");

        expect(() => resolveShotAssetMentionPrompt("跟随 @[asset:asset-sword]", context)).toThrow("断剑（资产 ID：asset-sword）");
    });

    test("generated appendix pruning preserves free prose and bound reference rows", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        context.assetCatalog!.push({ id: "phantom", title: "潇潇", category: "character" });
        const prose = "林默推门。林默：潇潇明天才来。";
        const prompt = `${prose}\n\n【角色参考】\n潇潇：@[asset:phantom]\n林默：@[asset:asset-character]\n用户备注：潇潇没有到场。\n\n【资产参考】\n- 潇潇：人物参考：@图片3\n  本镜造型：潇潇披斗篷。\n- 林默：人物参考：@图片2\n  本镜造型：林默穿白衣。\n用户动作：林默推门离开。\n\n【镜头台词】\n林默：我提到过潇潇。`;
        const ensured = ensureShotAssetMentionPrompt(prompt, context.mentionReferences, context.assetCatalog);
        const compiled = resolveShotAssetMentionPrompt(prompt, context);
        for (const result of [ensured, compiled]) {
            expect(result).not.toContain("@[asset:phantom]");
            expect(result).not.toContain("- 潇潇：人物参考");
            expect(result).not.toContain("本镜造型：潇潇披斗篷。");
            expect(result).toContain(prose);
            expect(result).toContain("用户备注：潇潇没有到场。");
            expect(result).toContain("用户动作：林默推门离开。");
            expect(result).toContain("本镜造型：林默穿白衣。");
            expect(result).toContain("【镜头台词】\n林默：我提到过潇潇。");
        }
        expect(ensured).toContain("林默：@[asset:asset-character]");
        expect(() => resolveShotAssetMentionPrompt("【角色参考】\n用户备注：@[asset:phantom]走进门。", context)).toThrow("未绑定到当前镜头");
        expect(() => resolveShotAssetMentionPrompt("【角色参考】\n未知人：@[asset:unknown]", context)).toThrow("资产 ID：unknown");
        expect(() => resolveShotAssetMentionPrompt("【场景与道具参考】\n潇潇：@[asset:phantom]", context)).toThrow("未绑定到当前镜头");
    });

    test("repairs an unknown ID only when its explicit material definition matches one bound asset", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = "将@[asset:obsolete-scene]定义为<雨夜街道>，将@[asset:obsolete-character]定义为<林默>。\n镜头1：@[asset:obsolete-character]走进@[asset:obsolete-scene]。";

        const result = resolveShotAssetMentionPrompt(prompt, context, { interfaceType: "jiasu-video" });

        expect(result).toContain("将@图片1定义为<雨夜街道>，将@图片2定义为<林默>");
        expect(result).toContain("镜头1：@图片2走进@图片1。");
        expect(result).not.toContain("obsolete-");
    });

    test("normalizes stale named references before adding the current bindings", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = ensureShotAssetMentionPrompt("镜头1：林默推门。\n【角色参考】\n林默：@[asset:old-character]", context.mentionReferences);

        expect(prompt).not.toContain("old-character");
        expect(prompt.match(/@\[asset:asset-character\]/g)).toHaveLength(1);
    });

    test("does not guess a replacement for ambiguous names or unexplained IDs", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        context.assetCatalog!.push({ id: "another-character", title: "林默", category: "character" });

        expect(() => resolveShotAssetMentionPrompt("将@[asset:unknown]定义为<林默>。", context)).toThrow("资产 ID：unknown");
        expect(() => resolveShotAssetMentionPrompt("@[asset:unknown]推门进入。", context)).toThrow("资产 ID：unknown");
    });

    test("preserves an explicitly selected asset ID even when its title matches another binding", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        context.assetCatalog!.push({ id: "unbound-character", title: "林默", category: "character" });

        expect(() => resolveShotAssetMentionPrompt("将@[asset:unbound-character]定义为<林默>。", context)).toThrow("资产 ID：unbound-character");
    });

    test("Jiasu uses native at references for both asset mentions and voice bindings", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        context.assetReferences[1]!.audioIndex = 1;
        const prompt = resolveShotAssetMentionPrompt("@[asset:asset-character] 在 @[asset:asset-scene] 说话", context, { interfaceType: "jiasu-video" });
        expect(prompt).toContain("@图片2 在 @图片1 说话");
        expect(prompt).toContain("林默：人物参考：@图片2；声音参考：@音频1");
        expect(prompt).not.toContain("@[asset:");
        const otherChannel = resolveShotAssetMentionPrompt("@[asset:asset-character] 在 @[asset:asset-scene] 说话", context, { interfaceType: "eggfans-sd2-video" });
        expect(otherChannel).toContain("图片2 在 图片1 说话");
        expect(otherChannel).not.toContain("@图片");
    });

    test("adds bound assets as editable mention tokens without duplicating existing mentions", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = ensureShotAssetMentionPrompt("让 @[asset:asset-character] 走近镜头", context.mentionReferences);

        expect(prompt).toContain("@[asset:asset-character]");
        expect(prompt.match(/@\[asset:asset-character\]/g)).toHaveLength(1);
        expect(prompt).toContain("【场景与道具参考】\n雨夜街道：@[asset:asset-scene]");
    });

    test("keeps unbound speakers when only some supplemental lines match character assets", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        context.assetReferences.push({ assetId: "guard", title: "守卫", category: "character", imageIndex: 3 });
        const result = resolveShotAssetMentionPrompt("雨夜门口交谈。", context, { dialogue: "林默：我们走。\n旁白：城门关闭。\n守卫（低声）：等一下。" });
        expect(result).toContain("镜头台词：我们走。");
        expect(result).toContain("旁白：城门关闭。");
        expect(result).toContain("守卫（低声）：等一下。");
    });

    test("does not assign a named narrator to the only bound character", () => {
        const result = resolveShotAssetMentionPrompt("雨夜门口。", buildShotAssetReferenceContext(detail(), "shot-1"), { dialogue: "旁白：城门关闭。" });
        expect(result).toContain("【镜头台词】\n\n旁白：城门关闭。");
        expect(result).not.toContain("镜头台词：旁白");
    });

    test("bound assets without pictures stay bound and retain their editable mentions", () => {
        const project = detail();
        project.assets[0]!.storageKey = "";
        project.assets[1]!.character!.representations = [];
        const context = buildShotAssetReferenceContext(project, "shot-1");
        const prompt = "镜头1：雨夜街道。\n【角色参考】\n林默：@[asset:asset-character]\n【场景与道具参考】\n雨夜街道：@[asset:asset-scene]";

        expect(context.boundAssetIds).toEqual(["asset-scene", "asset-character", "asset-audio"]);
        expect(context.referenceImages).toHaveLength(0);
        expect(context.missingImageTitles).toEqual(["雨夜街道", "林默"]);
        expect(unresolvedProjectAssetMentions(prompt, context.assetCatalog!, context.boundAssetIds!)).toEqual([]);
        expect(ensureShotAssetMentionPrompt(prompt, context.mentionReferences, context.assetCatalog, context.boundAssetIds)).toContain("林默：@[asset:asset-character]");
        expect(() => resolveShotAssetMentionPrompt(prompt, context)).toThrow("缺少参考图");
    });

    test("does not silently submit text-only video when a bound character has no image", () => {
        const project = detail();
        project.assets[1]!.character!.representations = [];
        const context = buildShotAssetReferenceContext(project, "shot-1");

        expect(() => resolveShotAssetMentionPrompt("林默走近镜头", context)).toThrow("林默");
        expect(() => resolveShotAssetMentionPrompt("林默走近镜头", context)).toThrow("参考图");
    });

    test("a replacement uses the rebound resource for previews, uploads and version metadata", () => {
        const project = detail();
        const character = project.assets[1]!;
        const oldRepresentation = character.character!.representations[0]!;
        character.primaryVersionId = "replacement-version";
        character.character = {
            ...character.character!,
            versionId: "replacement-version",
            representations: [{ ...oldRepresentation, resourceId: "replacement-image" }],
        };
        project.shotReferences[1] = {
            ...project.shotReferences[1]!,
            assetVersionId: "replacement-version",
            asset: character,
            referencedVersion: {
                id: "replacement-version", assetId: character.id, version: 2,
                representations: character.character.representations,
            },
        };
        const context = buildShotAssetReferenceContext(project, "shot-1");
        expect(context.referenceImages[1]?.storageKey).toBe("resource:replacement-image");
        expect(context.mentionReferences[1]?.storageKey).toBe(context.referenceImages[1]?.storageKey);
        expect(context.resolvedCharacterVersions).toEqual([{ assetId: character.id, versionId: "replacement-version" }]);
        expect(context.referenceImages[1]?.url).toContain("replacement-image");
    });

    test("an intentionally pinned version remains the exact image used in the submission", () => {
        const project = detail();
        const character = project.assets[1]!;
        project.shotReferences[1] = {
            ...project.shotReferences[1]!,
            asset: character,
            assetVersionId: "pinned-version",
            referencedVersion: {
                id: "pinned-version", assetId: character.id, version: 0,
                representations: [{ id: "pinned-representation", role: "primary", mediaType: "image", resourceId: "pinned-image" }],
            },
        };
        const context = buildShotAssetReferenceContext(project, "shot-1");
        expect(context.referenceImages[1]?.storageKey).toBe("resource:pinned-image");
        expect(context.mentionReferences[1]?.storageKey).toBe("resource:pinned-image");
        expect(context.resolvedCharacterVersions).toEqual([{ assetId: character.id, versionId: "pinned-version" }]);
    });
    test("historical missing images never borrow the current look", () => {
        const project = detail();
        project.shotReferences[1] = { ...project.shotReferences[1]!, assetVersionId: "old", referencedVersion: { id: "old", assetId: "asset-character", version: 0, representations: [] } };
        const context = buildShotAssetReferenceContext(project, "shot-1");
        expect(context.referenceImages).toHaveLength(1);
        expect(() => resolveShotAssetMentionPrompt("林默推门", context)).toThrow("缺少参考图");
    });
    test("pending, stale automatic choices and multiple looks block submission", () => {
        for (const state of [{ selectionStatus: "pending" as const }, { selectionStatus: "resolved" as const, selectionSource: "auto" as const, selectionRevisionId: "stale" }]) {
            const project = detail();
            Object.assign(project.shotReferences[1]!, state);
            expect(() => resolveShotAssetMentionPrompt("推门", buildShotAssetReferenceContext(project, "shot-1"))).toThrow("待确认");
        }
        const project = detail();
        project.shotReferences.push({ ...project.shotReferences[1]!, id: "duplicate", assetVersionId: "another", asset: project.assets[1]! });
        expect(() => resolveShotAssetMentionPrompt("推门", buildShotAssetReferenceContext(project, "shot-1"))).toThrow("多个造型");
    });
    test("records exact historical resources and does not inherit current voice", () => {
        const project = detail();
        project.assets[1]!.character!.voice = { id: "new", profile: { sampleResourceId: "new-voice" }, mode: "sample", instructions: "新声音" };
        project.shotReferences[1]!.referencedVersion = { id: "version-character", assetId: "asset-character", version: 1, representations: project.assets[1]!.character!.representations, definition: {} };
        const context = buildShotAssetReferenceContext(project, "shot-1");
        expect(context.referenceAudios).toHaveLength(0);
        expect(context.characterReferenceSnapshot).toMatchObject([{ assetId: "asset-character", versionId: "version-character", resourceId: "character-cover" }]);
        project.shotReferences.push({ ...project.shotReferences[1]!, id: "output", role: "output" });
        expect(buildShotAssetReferenceContext(project, "shot-1").referenceImages).toHaveLength(2);
    });
});

function detail(): ProjectDetail {
    const scene = {
        id: "asset-scene",
        title: "雨夜街道",
        mediaType: "image",
        category: "environment",
        status: "confirmed",
        primaryVersionId: "version-scene",
        versionCount: 1,
        usages: [],
        position: 0,
        storageKey: "resource:scene-image",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    const character = {
        id: "asset-character",
        title: "林默",
        mediaType: "entity",
        category: "character",
        status: "confirmed",
        primaryVersionId: "version-character",
        versionCount: 1,
        usages: [],
        position: 1,
        updatedAt: "2026-08-29T00:00:00Z",
        character: {
            versionId: "version-character",
            version: 1,
            definition: {},
            representations: [{ id: "representation-1", resourceId: "character-cover", mediaType: "image", role: "primary" }],
            visualStatus: "ready",
            voiceStatus: "missing",
        },
    } satisfies ProjectAsset;
    const audio = {
        id: "asset-audio",
        title: "雨声",
        mediaType: "audio",
        category: "other",
        status: "confirmed",
        primaryVersionId: "version-audio",
        versionCount: 1,
        usages: [],
        position: 2,
        storageKey: "resource:rain-audio",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    return {
        assets: [scene, character, audio],
        shotReferences: [
            { id: "reference-scene", shotId: "shot-1", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:00Z" },
            { id: "reference-character", shotId: "shot-1", assetVersionId: "version-character", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:01Z" },
            { id: "reference-audio", shotId: "shot-1", assetVersionId: "version-audio", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:02Z" },
            { id: "reference-other-shot", shotId: "shot-2", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:03Z" },
        ],
    } as ProjectDetail;
}
