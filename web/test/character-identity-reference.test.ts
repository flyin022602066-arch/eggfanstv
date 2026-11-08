import { expect, test } from "bun:test";
import { generateCharacterTurnaround, submitCharacterLookImages } from "@/pages/projects/detail/project-character-media";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";
import type { ProjectCore } from "@/services/api/projects";
import type { GenerationTask } from "@/services/api/task-center";
import { prepareBackendGenerationTask, type submitBackendGenerationTask } from "@/services/api/generation-task";
import { characterIdentitySource } from "@/lib/character-identity-reference";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";

const channel = createModelChannel({ id: "identity-test", name: "fixture", interfaceType: "openai-image", baseUrl: "https://example.invalid", apiKey: "fixture-only", models: ["gpt-image-2"] });
const model = encodeChannelModel(channel.id, "gpt-image-2");
const config = { ...defaultConfig, channels: [channel], model, imageModel: model };
const input = { projectId: "project", assetId: "hero", versionId: "combat", name: "云舒", definition: { appearance: "黑发青年", clothing: "铠甲" }, config };
type Submission = Parameters<typeof submitBackendGenerationTask>[0];
function version(versionId: string, number: number, lookId: string, resourceId?: string): CharacterReferenceVersion {
    return { assetId: "hero", title: "云舒", versionId, version: number, definition: { appearance: "黑发青年", clothing: lookId }, representations: resourceId ? [{ role: "primary", mediaType: "image", resourceId }] : [], referenceProfile: { lookId, name: lookId, description: "", matchHints: "", excludeHints: "", enabled: true, preferred: false, default: false }, updatedAt: "" } as CharacterReferenceVersion;
}
function harness(versions: CharacterReferenceVersion[], presets = "{}") {
    const submissions: Submission[] = [];
    return { submissions, dependencies: {
        loadProject: async () => ({ project: { id: "project", characterFacePresetsJson: presets } } as ProjectCore),
        loadCatalog: async () => ({ versions, revision: 1 }),
        submitTask: async (options: Submission) => { submissions.push(options); return {} as GenerationTask; },
    } };
}

test("later looks edit the earliest identity image, not their own drifted face or another character", async () => {
    const { submissions, dependencies } = harness([version("combat", 9, "combat", "drifted"), version("base-image", 4, "daily", "base-face"), { ...version("other", 1, "other", "other-face"), assetId: "other" }, version("base", 1, "daily")]);
    await generateCharacterTurnaround(input, dependencies);
    expect(submissions[0]?.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:base-face"]);
    expect(submissions[0]?.metadata).toMatchObject({ characterIdentityVersionId: "base-image", characterIdentityResourceId: "base-face", characterVersionId: "combat" });
    const prompt = String((submissions[0]?.metadata?.promptTemplateVariables as Record<string, string>).角色设定);
    for (const rule of ["同一人物", "基础版", "五官", "明确", "头部", "不含头部"]) expect(prompt).toContain(rule);
    expect(prompt).toContain("铠甲");
    const task = await prepareBackendGenerationTask(submissions[0]!);
    expect((task.input as { referenceImages: { storageKey: string }[] }).referenceImages.map((image) => image.storageKey)).toEqual(["resource:base-face"]);
});

test("library references establish the first identity and only supply clothing for later looks", async () => {
    const referenceImage = { id: "library", name: "选定素材", storageKey: "resource:chosen-original", dataUrl: "", type: "image/png" };
    const { submissions, dependencies } = harness([version("base", 1, "daily")]);
    await generateCharacterTurnaround({ ...input, versionId: "base", referenceImage }, dependencies);
    expect(submissions[0]?.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:chosen-original"]);
    dependencies.loadCatalog = async () => ({ versions: [version("base", 1, "daily", "base-face"), version("combat", 2, "combat")], revision: 2 });
    await generateCharacterTurnaround({ ...input, referenceImage }, dependencies);
    expect(submissions[1]?.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:base-face", "resource:chosen-original"]);
    expect(String((submissions[1]?.metadata?.promptTemplateVariables as Record<string, string>).角色设定)).toContain("不得替换基础版身份");
});

test("expression sheets cannot establish the base identity and a legacy base survives later grouping", () => {
    const base = version("base", 1, "daily");
    const picture = version("base-image", 4, "daily", "base-face");
    const expression = version("expression", 2, "daily", "expression-face");
    expression.representations[0]!.role = "expression_sheet";
    base.referenceProfile = undefined;
    const source = characterIdentitySource([version("combat", 3, "combat"), picture, expression, base], "hero", "combat");
    expect(source.image?.resourceId).toBe("base-face");
});

test("splitting an old mixed definition establishes the first independent look, not the unusable mixed record", () => {
    const mixed = version("mixed", 1, "mixed");
    mixed.definition = { clothing: "造型1：白衣；造型2：黑甲" };
    mixed.referenceProfile = undefined;
    const versions = [version("combat", 3, "combat"), mixed, version("base", 2, "daily")];
    expect(characterIdentitySource(versions, "hero", "base").canCreateBase).toBe(true);
    expect(characterIdentitySource(versions, "hero", "combat").canCreateBase).toBe(false);
    expect(() => characterIdentitySource(versions, "hero", "mixed")).toThrow("拆分");
    mixed.representations = [{ resourceId: "original-face", role: "primary", mediaType: "image" }] as CharacterReferenceVersion["representations"];
    expect(characterIdentitySource(versions, "hero", "combat").image?.resourceId).toBe("original-face");
});

test("a missing base image blocks alternate looks instead of silently doing text-to-image", async () => {
    const { submissions, dependencies } = harness([version("combat", 2, "combat"), version("base", 1, "daily")]);
    await expect(generateCharacterTurnaround(input, dependencies)).rejects.toThrow("基础");
    expect(submissions).toHaveLength(0);
});

test("the first look can create its base image and later looks never override it with a new preset", async () => {
    const presets = JSON.stringify({ female: { resourceId: "new-preset", assetIds: ["hero"] } });
    const { submissions, dependencies } = harness([version("base", 1, "daily")], presets);
    await generateCharacterTurnaround({ ...input, versionId: "base" }, dependencies);
    expect(submissions[0]?.referenceImages?.[0]?.storageKey).toBe("resource:new-preset");
    dependencies.loadCatalog = async () => ({ versions: [version("combat", 5, "combat"), version("base-image", 3, "daily", "original-face"), version("base", 1, "daily")], revision: 2 });
    await generateCharacterTurnaround(input, dependencies);
    expect(submissions[1]?.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:original-face"]);
});

test("explicit hairstyle and head changes stay in the editing instruction without losing identity", async () => {
    const { submissions, dependencies } = harness([version("base", 1, "daily", "base-face"), version("combat", 2, "combat")]);
    await generateCharacterTurnaround({ ...input, definition: { ...input.definition, hairstyle: "剧情明确剃发，额头新增伤疤" }, promptOverride: "保留眼鼻口比例，换成战损服装" }, dependencies);
    const prompt = String((submissions[0]?.metadata?.promptTemplateVariables as Record<string, string>).角色设定);
    expect(prompt).toContain("剃发");
    expect(prompt).toContain("额头新增伤疤");
    expect(prompt).toContain("保留眼鼻口比例");
    expect(submissions[0]?.referenceImages?.[0]?.storageKey).toBe("resource:base-face");
});

test("catalog failure or missing target never falls back to unrelated text-to-image", async () => {
    const { submissions, dependencies } = harness([version("base", 1, "daily", "base-face")]);
    await expect(generateCharacterTurnaround(input, dependencies)).rejects.toThrow();
    dependencies.loadCatalog = async () => { throw new Error("角色目录读取失败"); };
    await expect(generateCharacterTurnaround(input, dependencies)).rejects.toThrow("角色目录读取失败");
    expect(submissions).toHaveLength(0);
});

test("batch finishes the base before submitting variants and stops on a failed base", async () => {
    const versions = [version("combat", 2, "combat"), version("base", 1, "daily")];
    const events: string[] = [];
    const submit = async (target: CharacterReferenceVersion) => { events.push(target.versionId); return { id: target.versionId, status: "queued" } as GenerationTask; };
    const wait = async () => { events.push("base-ready"); return { status: "succeeded" } as GenerationTask; };
    await submitCharacterLookImages(versions, versions, submit, wait);
    expect(events).toEqual(["base", "base-ready", "combat"]);
    events.length = 0;
    const result = await submitCharacterLookImages(versions, versions, submit, async () => { throw new Error("基础图生成失败"); });
    expect(events).toEqual(["base"]);
    expect(result.errors.join("")).toContain("基础");
    expect(result.submitted).toBe(1);
});

test("a real batch reloads the completed base image before creating alternate tasks", async () => {
    const versions = [version("combat", 2, "combat"), version("base", 1, "daily")];
    const { submissions, dependencies } = harness(versions);
    const result = await submitCharacterLookImages(versions, versions, (target) => generateCharacterTurnaround({ ...input, versionId: target.versionId, definition: target.definition }, dependencies), async () => {
        versions.push(version("base-ready", 3, "daily", "new-base-image"));
        return { status: "succeeded" } as GenerationTask;
    });
    expect(result).toEqual({ submitted: 2, errors: [] });
    expect(submissions[0]?.referenceImages).toEqual([]);
    expect(submissions[1]?.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:new-base-image"]);
});

test("models explicitly lacking reference support cannot silently generate a new face", async () => {
    const { submissions, dependencies } = harness([version("base", 1, "daily", "base-face"), version("combat", 2, "combat")]);
    const capabilityConfig = defaultModelCapabilityConfig("openai-image", "gpt-image-2");
    capabilityConfig.image!.references.maxImages = 0;
    const unsupported = { ...config, channels: [{ ...channel, modelProfiles: [{ model: "gpt-image-2", capabilityConfig }] }] };
    await expect(generateCharacterTurnaround({ ...input, config: unsupported }, dependencies)).rejects.toThrow("不支持参考图");
    expect(submissions).toHaveLength(0);
});
