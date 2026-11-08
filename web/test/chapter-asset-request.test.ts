import { expect, spyOn, test } from "bun:test";
import { extractChapterAssets } from "../src/pages/projects/detail/project-chapter-ai";
import * as canvasGeneration from "../src/lib/canvas/canvas-project-generation";
import { useConfigStore } from "../src/stores/use-config-store";
import { chapterAssetsFromGenerationTask, chapterStoryboardFromGenerationTask } from "../src/pages/projects/detail/project-chapter-ai";

test("提取携带项目全部角色和造型，不把总库当本章出镜证据", async () => {
    const run = spyOn(canvasGeneration, "runBackendCanvasGenerationTask").mockImplementation(async (input) => {
        input.onTaskCreated?.({id:"offline-catalog-task", type:"canvas_text", status:"succeeded", prompt:"", attempts:1, createdAt:"", updatedAt:""});
        return { text: JSON.stringify({ characters: [], scenes: [], props: [] }) };
    });
    try {
        await extractChapterAssets({ projectId:"p", projectName:"项目", chapterId:"u", chapterTitle:"21", sourceText:"纪昼走进教室。", projectStyle:"3D", config:{...useConfigStore.getInitialState().config, model:"offline"}, existingCharacters:[{assetId:"existing", title:"纪昼", versionId:"v1", version:1, definition:{aliases:["小纪"], clothing:"灰色训练服"}, representations:[], visualStatus:"ready", voiceStatus:"missing", updatedAt:""}] });
        const variables = run.mock.calls[0]![0].metadata?.promptTemplateVariables as Record<string,string>;
        expect(variables.已有角色与造型).toContain("纪昼");
        expect(variables.已有角色与造型).toContain("灰色训练服");
        expect(variables.已有角色与造型).toContain("小纪");
    } finally { run.mockRestore(); }
});

test("资产恢复保留模型角色清单，分镜绑定仍核对本镜实际出场", () => {
    const card = { name: "潇潇", aliases: [], role: "潇潇在旧分镜推门进入", appearance: "短发", clothing: "白衣", physique: "纤细", personality: "冷静", props: "", consistencyPrompt: "保持短发", multiViewPrompt: "正侧背", voiceLanguage: "中文", voiceAge: "青年", voiceTimbre: "清亮" };
    const task = { id: "offline-recovery", type: "canvas_text", status: "succeeded" as const, prompt: "", attempts: 1, createdAt: "", updatedAt: "", inputJson: JSON.stringify({ metadata: { promptTemplateOperation: "chapter_assets_extract", promptTemplateVariables: { 章节正文: "林夏独坐。", 章节分镜: "潇潇推门进入" } } }), resultJson: JSON.stringify({ text: JSON.stringify({ characters: [card], scenes: [], props: [] }) }) };
    expect(chapterAssetsFromGenerationTask(task).characters).toEqual([card]);
    const storyboard = chapterStoryboardFromGenerationTask({ ...task, inputJson: JSON.stringify({ metadata: { chapterSourceText: "林夏独坐。" }, characters: [{ assetId: "phantom", name: "潇潇", definition: {} }] }), resultJson: JSON.stringify({ rows: [{ plotDescription: "潇潇推门进入。", characters: [{ characterName: "潇潇", characterAssetId: "phantom" }], assetBindings: [{ nodeId: "phantom", role: "character" }] }] }) });
    expect(storyboard.rows[0]!.characters).toEqual([]);
    expect(storyboard.rows[0]!.assetBindings).toEqual([]);
});

test("分镜恢复拒绝白名单外伪装成图片引用的人物，保留已知场景引用", () => {
    const task = {
        id: "offline-bindings", type: "canvas_text", status: "succeeded" as const, prompt: "", attempts: 1, createdAt: "", updatedAt: "",
        inputJson: JSON.stringify({ metadata: { chapterSourceText: "林夏独坐。" }, characters: [], canvasAssets: [{ id: "scene", title: "旧屋", category: "environment", type: "image" }] }),
        resultJson: JSON.stringify({ rows: [{ plotDescription: "林夏独坐。", characters: [], assetBindings: [{ nodeId: "phantom", role: "environment" }, { nodeId: "scene", role: "environment" }] }] }),
    };
    expect(chapterStoryboardFromGenerationTask(task).rows[0]!.assetBindings.map((binding) => binding.nodeId)).toEqual(["scene"]);
});

test("章节资产启用流式接收，保留任务身份和系统表现设置", async () => {
    const text = JSON.stringify({ characters: [], scenes: [{ name: "旧屋", description: "旧屋内景", prompt: "旧屋全景" }], props: [] });
    const run = spyOn(canvasGeneration, "runBackendCanvasGenerationTask").mockImplementation(async (input) => {
        input.onTaskCreated?.({ id: "asset-task", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ mode: "text", text }) });
        return { text };
    });
    try {
        const result = await extractChapterAssets({
            projectId: "project", projectName: "测试项目", chapterId: "chapter-4", chapterTitle: "第四章", sourceText: "人物走进旧屋。",
            projectStyle: "历史写实", storyboardContext: "镜头01：旧信；镜头02：旧信。", config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" },
        });
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0]![0]).toMatchObject({ streamText: true, metadata: { chapterId: "chapter-4", operation: "chapter_character_breakdown", promptTemplateOperation: "chapter_assets_extract" } });
        expect(result.taskId).toBe("asset-task");
        expect(result.scenes[0]!.name).toBe("旧屋");
        expect(run.mock.calls[0]![0].metadata?.promptTemplateVariables).toMatchObject({ 章节分镜: "镜头01：旧信；镜头02：旧信。" });
    } finally {
        run.mockRestore();
    }
});

test("即时资产提取完整保留模型角色，不用本地出镜正则删减", async () => {
    const phantom = { name: "潇潇", aliases: [], role: "潇潇推门进入，在当前章节出镜", appearance: "短发", clothing: "白衣", physique: "纤细", personality: "冷静", props: "", consistencyPrompt: "保持短发", multiViewPrompt: "正侧背", voiceLanguage: "中文", voiceAge: "青年", voiceTimbre: "清亮" };
    const text = JSON.stringify({ characters: [phantom], scenes: [], props: [] });
    const run = spyOn(canvasGeneration, "runBackendCanvasGenerationTask").mockImplementation(async (input) => {
        input.onTaskCreated?.({ id: "offline-phantom-task", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ mode: "text", text }) });
        return { text };
    });
    try {
        const result = await extractChapterAssets({ projectId: "p", projectName: "测试", chapterId: "u", chapterTitle: "本章", sourceText: "林夏独坐。", storyboardContext: "潇潇推门进入。\n【资产参考】\n- 潇潇：人物参考：图片1", config: { ...useConfigStore.getInitialState().config, model: "offline" } });
        expect(result.characters).toEqual([phantom]);
        expect(run).toHaveBeenCalledTimes(1);
    } finally {
        run.mockRestore();
    }
});
