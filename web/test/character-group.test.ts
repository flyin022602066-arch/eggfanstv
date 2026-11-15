import { expect, test } from "bun:test";
import { characterAssetType, GROUP_CHARACTER_DESIGN_RULE, groupCharacterVideoRule } from "@/lib/character-asset-type";
import { characterTurnaroundVariables } from "@/lib/character-reference-generation";
import { compileCharacterReferencePrompt, parseCharacterBreakdown } from "@/lib/canvas/canvas-character-reference";
import { buildShotAssetReferenceContext } from "@/pages/projects/detail/workflow-shot-references";
import { buildWorkflowVideoPrompt } from "@/pages/projects/detail/workflow-video-prompt";
import type { ProjectDetail } from "@/services/api/projects";

test("group classification uses explicit setting or collective identity, never incidental role mentions", () => {
    for (const name of ["买凉粉的工人与食客群像", "围观群众", "其余六位师傅", "工人群演"]) expect(characterAssetType(name, {})).toBe("group");
    expect(characterAssetType("食客", { role: "【群体演员】店内多位食客" })).toBe("group");
    expect(characterAssetType("三师傅", { role: "其余六位师傅中的一位，独立出场" })).toBe("individual");
    expect(characterAssetType("陈尧", { role: "与工人群像交谈", appearance: "青年男子" })).toBe("individual");
    expect(characterAssetType("群众演员小王", {})).toBe("individual");
    expect(characterAssetType("工人群像", { characterType: "individual" })).toBe("individual");
    expect(characterAssetType("店内食客", { characterType: "group" })).toBe("group");
});

test("group design replaces stale single-person layout while preserving script facts and edited prompt", () => {
    const variables = characterTurnaroundVariables("买凉粉的工人与食客群像", {
        role: "【群体演员】工人买凉粉，食客在桌边吃饭", clothing: "工人穿工装，食客穿日常衣服",
        appearance: "剧本明确都是成年男性", multiViewPrompt: "旧提示：独立头部特写与同一人三视图", consistencyPrompt: "旧规则：保留同一张脸",
    }, "保留蓝灰工装，前排站两位工人");
    expect(variables.角色类型).toBe("group");
    expect(variables.角色设定).toContain(GROUP_CHARACTER_DESIGN_RULE);
    expect(variables.角色设定).toContain("保留蓝灰工装，前排站两位工人");
    expect(variables.角色设定).toContain("都是成年男性");
    expect(variables.角色设定).not.toContain("旧提示");
    expect(variables.角色设定).not.toContain("旧规则");
});

test("group video reference describes diverse extras without replacing named speaking roles", () => {
    const rule = groupCharacterVideoRule("工人与食客群像");
    for (const value of ["不同面孔", "不复制", "人数", "具名角色", "不是一个人"]) expect(rule).toContain(value);
});

test("group generation keeps legitimate supplemental design without old single-person clauses", () => {
    const variables = characterTurnaroundVariables("工人群像", {
        consistencyPrompt: "旧规则：保留同一张脸；服饰统一蓝灰色，面孔各异。",
        multiViewPrompt: "多人同框，前排双手可见，展示磨旧工具。",
    });
    expect(variables.角色设定).toContain("服饰统一蓝灰色，面孔各异");
    expect(variables.角色设定).toContain("前排双手可见，展示磨旧工具");
    expect(variables.角色设定).not.toContain("旧规则");
});

test("group generation preserves member count next to a negative single-person layout requirement", () => {
    const variables = characterTurnaroundVariables("押运员", {
        characterType: "group", clothing: "深灰工装",
        multiViewPrompt: "采用4名不同个体作为选角样例同框站立，不使用同一人的正侧背三视图、独立头像加无头身体布局。每位成员面孔各异。",
    });
    expect(variables.角色设定).toContain("采用4名不同个体作为选角样例同框站立");
    expect(variables.角色设定).toContain("不使用同一人的正侧背三视图");
    expect(variables.角色设定).toContain("每位成员面孔各异");
});

test("group generation removes only obsolete layout clauses without discarding clothing and count", () => {
    const variables = characterTurnaroundVariables("押运员", {
        characterType: "group", clothing: "深灰工装",
        consistencyPrompt: "采用同一张脸，4名押运员同框，服饰统一蓝灰色。",
    });
    expect(variables.角色设定).not.toContain("采用同一张脸");
    expect(variables.角色设定).toContain("4名押运员同框");
    expect(variables.角色设定).toContain("服饰统一蓝灰色");
});

test("group type survives extraction and reaches actual shot video and canvas reference prompts", () => {
    const definition = { name: "店内食客", characterType: "group", aliases: [], role: "【群体演员】店内多位食客", appearance: "面孔各异", clothing: "灰衣、蓝衣", physique: "高矮不同", personality: "安静", props: "", consistencyPrompt: "身份一致、面孔不同", multiViewPrompt: "多人同框", voiceLanguage: "中文", voiceAge: "成年", voiceTimbre: "各有不同" };
    const parsed = parseCharacterBreakdown(JSON.stringify({ characters: [definition] }))[0]!;
    expect(parsed.characterType).toBe("group");
    const character = { versionId: "group-version", version: 1, definition: parsed, representations: [{ resourceId: "group-image", mediaType: "image", role: "primary" }] };
    const asset = { id: "group", title: "店内食客", category: "character", character, primaryVersionId: "group-version" };
    const project = { assets: [asset], shots: [{ id: "shot", currentRevisionId: "revision" }], shotReferences: [{ id: "ref", shotId: "shot", role: "reference", status: "linked", assetVersionId: "group-version", asset, referencedVersion: { ...character, id: "group-version", assetId: "group" } }] } as unknown as ProjectDetail;
    const context = buildShotAssetReferenceContext(project, "shot");
    expect(context.referenceImages[0]?.storageKey).toBe("resource:group-image");
    expect(context.assetReferences[0]?.characterType).toBe("group");
    const result = buildWorkflowVideoPrompt({ videoPrompt: "店内三位食客各自吃饭，主角走进来。" }, context, "nono-video");
    expect(result.prompt).toContain("店内三位食客各自吃饭");
    expect(result.prompt).toContain(groupCharacterVideoRule("店内食客"));
    expect(compileCharacterReferencePrompt("店内食客", parsed)).toContain(groupCharacterVideoRule("店内食客"));
});
