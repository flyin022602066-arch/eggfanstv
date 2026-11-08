import { expect, test } from "bun:test";
import { chapterStoryboardRequirements, chapterStoryboardSourcePrompt, reviewChapterDialogueCoverage } from "../src/lib/chapter-storyboard-mode";
import { chapterStoryboardAssets } from "../src/pages/projects/detail/chapter-storyboard-production";
import { chapterStoryboardFromGenerationTask } from "../src/pages/projects/detail/project-chapter-ai";

test("whole-chapter review catches a detailed ending that omits earlier original dialogue", () => {
    const source = '她搓手。\n“总算没白吃。”\n韩策问：“有风。”\n“我头晕。”';
    expect(reviewChapterDialogueCoverage(source, [{ dialogue: '纪昼：“我头晕。”' }]).join("\n")).toContain("遗漏 2 句");
    expect(reviewChapterDialogueCoverage(source, [{ dialogue: '纪昼：“总算没白吃。”\n韩策：“有风。”' }, { dialogue: '纪昼：“我头晕。”' }])).toEqual([]);
});

test("structured delivery omits the competing legacy screenplay instructions", () => {
    const rules = chapterStoryboardRequirements("continuous_30s", "unrestricted", undefined, "shots-v1");
    expect(rules).toContain("directorScript");
    expect(rules).toContain("对白字数限制：关闭");
    expect(rules).not.toContain("先完成完整 videoMotionPrompt");
    expect(rules).toContain("已经可见的信息不再转成OS朗读");
    const source = chapterStoryboardSourcePrompt("章", '她走向门口。\n“好了没有？”\n“我头晕。”');
    expect(source).toContain("1. “好了没有？”\n2. “我头晕。”");
});

test("whole-chapter dialogue review preserves repeated turns and original order", () => {
    const source = '“开始。”\n“结束。”\n“开始。”';
    expect(reviewChapterDialogueCoverage(source, [{ dialogue: '甲：“开始。”\n乙：“结束。”' }])).not.toEqual([]);
    expect(reviewChapterDialogueCoverage('“开始。”\n“结束。”', [{ dialogue: '乙：“结束。”\n甲：“开始。”' }])).not.toEqual([]);
    expect(reviewChapterDialogueCoverage(source, [{ dialogue: '甲：“开始。”\n乙：“结束。”\n甲：“开始。”' }])).toEqual([]);
});

test("chapter prompt catalog excludes generated products", () => {
    const assets = [{ id: "output", title: "镜头01视频", mediaType: "video", category: "material", primaryVersionId: "generated" }, { id: "scene", title: "更衣室", mediaType: "image", category: "environment", primaryVersionId: "scene-version" }];
    expect(chapterStoryboardAssets({ assets } as any).map((asset) => asset.id)).toEqual(["scene"]);
});

test("recovery keeps scene and character bindings from the saved compact context", () => {
    const task = { id: "task", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", inputJson: JSON.stringify({ metadata: { chapterSourceText: "纪昼站在更衣室门前。", storyboardCharacters: [{ assetId: "hero", name: "纪昼", definition: {} }], storyboardAssets: [{ id: "hero", title: "纪昼", type: "character", category: "character" }, { id: "scene", title: "更衣室", type: "image", category: "environment" }] } }), resultJson: JSON.stringify({ rows: [{ plotDescription: "纪昼站在更衣室门前。", characters: [{ characterName: "纪昼", characterAssetId: "hero" }], assetBindings: [{ nodeId: "hero", role: "character" }, { nodeId: "scene", role: "environment" }] }] }) };
    expect(chapterStoryboardFromGenerationTask(task as any).rows[0]!.assetBindings.map((binding) => binding.nodeId)).toEqual(["hero", "scene"]);
});

test("recovery does not delete the visible protagonist when her action is removing gloves", () => {
    const task = { id: "task", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", inputJson: JSON.stringify({ metadata: { chapterSourceText: "纪昼摘下手套，将指尖按在冰冷的玻璃上。", storyboardCharacters: [{ assetId: "hero", name: "纪昼", definition: {} }], storyboardAssets: [{ id: "hero", title: "纪昼", type: "character", category: "character" }] } }), resultJson: JSON.stringify({ rows: [{ plotDescription: "纪昼摘下手套，将指尖按在冰冷的玻璃上。", characters: [{ characterName: "纪昼", characterAssetId: "hero", characterVersionId: "selected-look" }], assetBindings: [{ nodeId: "hero", role: "character" }] }] }) };
    const row = chapterStoryboardFromGenerationTask(task as any).rows[0]!;
    expect(row.characters).toEqual([{ characterName: "纪昼", characterAssetId: "hero", characterVersionId: "selected-look" }]);
    expect(row.assetBindings.map(binding => binding.nodeId)).toEqual(["hero"]);
});
