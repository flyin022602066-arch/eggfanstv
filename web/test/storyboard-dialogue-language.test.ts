import { expect, spyOn, test } from "bun:test";
import { omitChineseDialogueTranslations, storyboardSourceDialogue } from "../src/lib/storyboard-dialogue-language";
import { chapterStoryboardRequirements, chapterStoryboardSourcePrompt, reviewChapterDialogueCoverage } from "../src/lib/chapter-storyboard-mode";
import { storyboardRowsFromTask, storyboardRowsOutputContract } from "../src/lib/canvas/canvas-project-domain";
import { storyboardRowsToProjectShots } from "../src/pages/projects/detail/chapter-storyboard-production";
import { generateChapterStoryboard, chapterStoryboardFromGenerationTask } from "../src/pages/projects/detail/project-chapter-ai";
import { buildWorkflowVideoPrompt } from "../src/pages/projects/detail/workflow-video-prompt";
import * as taskApi from "../src/services/api/task-center";
import { useConfigStore } from "../src/stores/use-config-store";

const original = 'Dante Locke（冷漠）："Three crystals. Your quota was five. Tell me why I should care."（三枚晶核。配额是五枚。给我一个该网开一面的理由。）\nCole Vance（抬头）："The west shaft collapsed. I carried two of your workers out."（西矿道塌了。我把你们两个工人背了出来。）';
const spoken = 'Dante Locke（冷漠）："Three crystals. Your quota was five. Tell me why I should care."\nCole Vance（抬头）："The west shaft collapsed. I carried two of your workers out."';

test("bilingual dialogue keeps original foreign speech, speaker and acting notes without the Chinese translation", () => {
    expect(omitChineseDialogueTranslations(original)).toBe(spoken);
    expect(omitChineseDialogueTranslations(spoken)).toBe(spoken);
    expect(storyboardSourceDialogue(original)).toEqual([
        "Three crystals. Your quota was five. Tell me why I should care.",
        "The west shaft collapsed. I carried two of your workers out.",
    ]);
    expect(chapterStoryboardSourcePrompt("第一章", original)).toContain(original);
    expect(reviewChapterDialogueCoverage(original, [{ dialogue: spoken }])).toEqual([]);
    expect(reviewChapterDialogueCoverage(original, [{ dialogue: spoken.split("\n")[0]! }])[0]).toContain("遗漏 1 句");
});

for (const [input, expected] of [
    ['Cole: "Don\'t move." (别动。)', 'Cole: "Don\'t move."'],
    ["Cole: ‘Don't move.’（别动。）", "Cole: ‘Don't move.’"],
    ['Ana：“No te vayas.”（不要走。）', 'Ana：“No te vayas.”'],
    ['Иван：「Не уходи.」（不要走。）', 'Иван：「Не уходи.」'],
    ['葵：「行かないで。」（不要走。）', '葵：「行かないで。」'],
    ['Cole：“Stay.（留下来。）”', 'Cole：“Stay.”'],
    ['Cole：“Stay.”（中文翻译：留下来（别走）。）', 'Cole：“Stay.”'],
    ['Cole：“Stay.”（抬头）', 'Cole：“Stay.”（抬头）'],
    ['Cole：“Stay.”（愤怒）', 'Cole：“Stay.”（愤怒）'],
    ['Cole：“Stay.”（满脸怒色，咬牙切齿）', 'Cole：“Stay.”（满脸怒色，咬牙切齿）'],
    ['Cole：“Stay.”（译文：别走）', 'Cole：“Stay.”'],
    ['Cole：“Stay.”（他抬起头，望向门口。）', 'Cole：“Stay.”（他抬起头，望向门口。）'],
    ['林默（低声）：“我们走。”（他转身走向门口。）', '林默（低声）：“我们走。”（他转身走向门口。）'],
    ['Cole：“Stay.”\n林默：“不要走。”', 'Cole：“Stay.”\n林默：“不要走。”'],
    ["Cole Vance（科尔·万斯）抬头。", "Cole Vance（科尔·万斯）抬头。"],
    ["镜头：Long shot（长镜头）", "镜头：Long shot（长镜头）"],
    ["声音：Cole: Stay.（留下来。）", "声音：Cole: Stay."],
] as const) {
    test(`translation normalization: ${input}`, () => expect(omitChineseDialogueTranslations(input)).toBe(expected));
}

test("unquoted dialogue normalization is restricted to the actual voice fields", () => {
    expect(omitChineseDialogueTranslations("Cole: Stay.（留下来。）", { unquoted: true })).toBe("Cole: Stay.");
    expect(omitChineseDialogueTranslations("Cole: Stay.（抬头）", { unquoted: true })).toBe("Cole: Stay.（抬头）");
    expect(omitChineseDialogueTranslations("林默：别走（压低声音）。", { unquoted: true })).toBe("林默：别走（压低声音）。");
    expect(storyboardSourceDialogue("Cole: 'Don't move.'（别动。）")).toEqual(["Don't move."]);
});

test("plain and structured storyboard results save and submit foreign speech without duplicated translations", () => {
    for (const structured of [false, true]) {
        const row = {
            durationSeconds: 30, dialogue: original, plotDescription: "Cole抬头回答，Dante冷漠地盯着他。",
            videoMotionPrompt: `镜头1：缓慢推进。\n声音：${original}`,
            ...(structured ? { directorScript: {
                setting: "矿井入口，冷色光。", ending: "同一人物与服装。",
                shots: [{ durationSeconds: 30, camera: "平视中景，缓慢推进。", start: "Cole抬头。", performance: "Dante冷漠地等待回答。", focusAndLight: "面部侧光。", end: "Cole迎上目光。", sound: original }],
            } } : {}),
        };
        const task = { id: "offline-bilingual", resultJson: JSON.stringify({ mode: "text", text: JSON.stringify({ rows: [row] }) }) } as taskApi.GenerationTask;
        const result = storyboardRowsFromTask(task).rows[0]!;
        expect(result.dialogue).toBe(spoken);
        expect(result.videoMotionPrompt).not.toContain("三枚晶核");
        expect(result.directorScript?.shots[0]?.sound).toBe(structured ? spoken : undefined);
        const saved = storyboardRowsToProjectShots([result])[0]!.revision;
        expect(saved.dialogue).toBe(spoken);
        expect(saved.videoPrompt).not.toContain("三枚晶核");
        const final = buildWorkflowVideoPrompt(saved, { mentionReferences: [], referenceImages: [], referenceAudios: [], resolvedCharacterVersions: [], missingImageTitles: [], assetReferences: [] });
        expect(final.prompt).toContain("The west shaft collapsed.");
        expect(final.prompt).not.toContain("西矿道塌了");
        expect(final.prompt).toContain("冷漠");
        expect(final.prompt).toContain("抬头");
    }
});

for (const mode of ["standard", "continuous_30s"] as const) {
    test(`${mode} request and recovered task use the same original-language rule`, async () => {
        const completed = {
            id: "offline-bilingual", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "",
            resultJson: JSON.stringify({ rows: [{ durationSeconds: 30, dialogue: original, videoMotionPrompt: `声音：${original}`, characters: [] }] }),
        } as taskApi.GenerationTask;
        const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued" });
        const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
        try {
            const result = await generateChapterStoryboard({
                projectId: "offline-project", chapterId: "chapter", chapterTitle: "第一章", sourceText: original,
                projectStyle: { presetId: "", title: "", prompt: "海外写实" }, characters: [], assets: [],
                config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" },
                skills: [], selectedSkillIds: [], storyboardMode: mode, approvedRevision: 1, approvedShotIds: [],
            });
            const submitted = create.mock.calls[0]![0];
            expect(submitted.prompt).toContain(original);
            expect(submitted.input?.requirements).toContain("外语原对白是唯一发声文本");
            expect(submitted.prompt).toContain("不带中文译文");
            expect(result.rows[0]!.dialogue).toBe(spoken);
            const recovered = chapterStoryboardFromGenerationTask({ ...completed, inputJson: JSON.stringify(submitted.input) });
            expect(recovered.rows[0]!.dialogue).toBe(spoken);
            expect(recovered.rows[0]!.videoMotionPrompt).not.toContain("西矿道塌了");
            expect(create).toHaveBeenCalledTimes(1);
        } finally { wait.mockRestore(); create.mockRestore(); }
    });
}

test("structured director contract carries the language rule even when the backend separates planning and shots", () => {
    expect(chapterStoryboardRequirements("continuous_30s", "unrestricted", undefined, "shots-v1")).toContain("外语原对白是唯一发声文本");
    expect(storyboardRowsOutputContract("完整分镜", "continuous_30s", { maxInternalShotSeconds: 4 })).toContain("不带中文译文");
});

test("previously saved bilingual scripts do not re-add the translation from their dialogue appendix", () => {
    const final = buildWorkflowVideoPrompt({ videoPrompt: `镜头1：缓慢推进。\n声音：${original}`, dialogue: original }, { mentionReferences: [], referenceImages: [], referenceAudios: [], resolvedCharacterVersions: [], missingImageTitles: [], assetReferences: [] });
    expect(final.prompt).not.toContain("三枚晶核");
    expect(final.prompt).not.toContain("西矿道塌了");
    expect(final.prompt.match(/Three crystals\./gu)).toHaveLength(1);
    expect(final.prompt.match(/The west shaft collapsed\./gu)).toHaveLength(1);
});
