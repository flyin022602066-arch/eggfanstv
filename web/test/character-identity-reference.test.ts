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
    for (const rule of ["同一人物", "基础版", "五官", "明确", "头部", "本次所选角色参考图格式"]) expect(prompt).toContain(rule);
    expect((submissions[0]?.metadata?.promptTemplateVariables as Record<string, string>).角色参考图格式).toBe("portrait-body-grid");
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

test("chosen reference templates reach backend task metadata without changing model or identity", async () => {
    const { submissions, dependencies } = harness([version("base", 1, "daily", "base-face"), version("combat", 2, "combat")]);
    const selectedConfig = { ...config, size: "16:9", quality: "high", projectAssetImagePresets: { character: { model, size: "16:9", quality: "high", extraPrompt: "", characterLayoutId: "source-design-sheet", characterDesignTemplateId: "distinct-2d-animation" } } };
    await generateCharacterTurnaround({ ...input, config: selectedConfig }, dependencies);
    const prepared = await prepareBackendGenerationTask(submissions[0]!);
    const payload = prepared.input as { config: { model: string; size: string; quality: string }; metadata: { promptTemplateVariables: Record<string, string>; characterIdentityResourceId: string }; referenceImages: { storageKey: string }[] };
    expect(payload.metadata.promptTemplateVariables).toMatchObject({ 角色参考图格式: "source-design-sheet", 角色形象模板: "distinct-2d-animation" });
    expect(payload.metadata.promptTemplateVariables.角色设定).toContain("铠甲");
    expect(payload.metadata.characterIdentityResourceId).toBe("base-face");
    expect(payload.referenceImages.map((image) => image.storageKey)).toEqual(["resource:base-face"]);
    expect(payload.config).toMatchObject({ model: "gpt-image-2", size: "16:9", quality: "high" });
});

test("later looks explicitly replace removed accessories and rebuilt body parts while preserving the base face", async () => {
    const base = version("base", 1, "early", "base-face");
    base.definition = { appearance: "同一青年，胸背为生锈接口", clothing: "黑色背心，戴红色爆炸颈环", state: "早期清道夫" };
    const later = version("combat", 2, "rebuilt");
    later.definition = { appearance: "胸腔嵌入暗金核心，背部为合金脊椎", clothing: "黑色战损背心，爆炸颈环已去除", state: "已捏碎颈环，重铸脊椎" };
    const { submissions, dependencies } = harness([base, later]);
    await generateCharacterTurnaround({ ...input, definition: later.definition }, dependencies);
    const request = submissions[0]!;
    const variables = request.metadata!.promptTemplateVariables as Record<string, string>;
    const changes = variables.角色设定.split("【本次造型编辑清单")[1]!;
    for (const rule of ["爆炸颈环已去除", "暗金核心", "合金脊椎", "全部头部与身体视图移除", "五官", "优先于参考图", "不得只改变标题"]) expect(changes).toContain(rule);
    expect(changes).not.toContain("戴红色爆炸颈环");
    expect(request.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:base-face"]);
    const prepared = await prepareBackendGenerationTask(request);
    expect((prepared.input as { metadata: { promptTemplateVariables: Record<string, string> } }).metadata.promptTemplateVariables.角色设定).toBe(variables.角色设定);
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

test("alternate image requests do not repeat copied base outfits and equipment as positive instructions", async () => {
    const base = version("base", 1, "armored", "base-image");
    base.definition = { appearance: "黑发方脸青年，穿黑甲戴头盔", physique: "挺拔", clothing: "黑甲", props: "头盔、胸甲", consistencyPrompt: "始终穿黑甲戴头盔", multiViewPrompt: "黑甲全身设定" };
    const later = version("combat", 2, "unarmored");
    later.definition = { ...base.definition, clothing: "卸除黑甲、头盔与胸甲，穿白衬衫", state: "无护甲" };
    const { submissions, dependencies } = harness([base, later]);
    await generateCharacterTurnaround({ ...input, definition: later.definition, promptOverride: "保留眼鼻口，左袖挽起" }, dependencies);
    const request = submissions[0]!;
    const setting = (request.metadata!.promptTemplateVariables as Record<string, string>).角色设定;
    for (const stale of ["黑发方脸青年，穿黑甲戴头盔", "头盔、胸甲", "始终穿黑甲戴头盔", "黑甲全身设定"]) expect(setting).not.toContain(stale);
    for (const required of ["卸除黑甲、头盔与胸甲，穿白衬衫", "无护甲", "左袖挽起", "本次造型编辑清单"]) expect(setting).toContain(required);
    expect(request.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:base-image"]);
    expect(later.definition.props).toBe("头盔、胸甲");
    const prepared = await prepareBackendGenerationTask(request);
    expect((prepared.input as { metadata: { promptTemplateVariables: Record<string, string> } }).metadata.promptTemplateVariables.角色设定).toBe(setting);
    later.definition = { ...later.definition, props: "铜怀表", consistencyPrompt: "白衬衫，保留左眼泪痣" };
    await generateCharacterTurnaround({ ...input, definition: later.definition }, dependencies);
    const edited = (submissions[1]!.metadata!.promptTemplateVariables as Record<string, string>).角色设定;
    expect(edited).toContain("铜怀表");
    expect(edited).toContain("保留左眼泪痣");
});

test("rebuilt look prompts cannot reintroduce inherited armor through shared appearance", async () => {
    const base = version("base", 1, "armored", "base-image");
    base.definition = { appearance: "黑发方脸青年，穿黑甲戴头盔", clothing: "黑甲", props: "头盔、胸甲" };
    const later = version("combat", 2, "daily");
    later.definition = { ...base.definition, clothing: "卸除护甲后穿白衬衫", props: "", consistencyPrompt: "当前造型常服：黑发方脸青年，穿黑甲戴头盔；卸除护甲后穿白衬衫", multiViewPrompt: "常服四视图：黑发方脸青年，穿黑甲戴头盔；白衬衫，左眼泪痣" };
    const { submissions, dependencies } = harness([base, later]);
    await generateCharacterTurnaround({ ...input, definition: later.definition }, dependencies);
    const setting = (submissions[0]!.metadata!.promptTemplateVariables as Record<string, string>).角色设定;
    expect(setting).not.toContain("穿黑甲戴头盔");
    for (const required of ["卸除护甲后穿白衬衫", "左眼泪痣", "随身道具：无", "保留身体固有结构"]) expect(setting).toContain(required);
    expect(submissions[0]!.config).toEqual({ ...config, count: "1" });
});

test("redrawing the base look keeps its own appearance and equipment", async () => {
    const base = version("base", 1, "daily", "base-image");
    base.definition = { appearance: "黑发方脸青年，穿黑甲戴头盔", clothing: "黑甲", props: "头盔、胸甲", consistencyPrompt: "始终穿黑甲戴头盔", multiViewPrompt: "黑甲全身设定" };
    const { submissions, dependencies } = harness([base]);
    await generateCharacterTurnaround({ ...input, versionId: "base", definition: base.definition }, dependencies);
    const setting = (submissions[0]!.metadata!.promptTemplateVariables as Record<string, string>).角色设定;
    for (const required of [base.definition.appearance, base.definition.props, base.definition.consistencyPrompt, base.definition.multiViewPrompt]) expect(setting).toContain(String(required));
    expect(setting).not.toContain("本次造型编辑清单");
});

test("removing copied equipment preserves explicit new descriptions that mention its traces", async () => {
    const base = version("base", 1, "daily", "base-image");
    base.definition = { appearance: "黑发青年", clothing: "青衣", props: "玉佩" };
    const later = version("combat", 2, "after");
    later.definition = { ...base.definition, clothing: "卸除玉佩，换成白衣", consistencyPrompt: "白衣衣襟留下玉佩印痕；玉佩；右袖卷起" };
    const { submissions, dependencies } = harness([base, later]);
    await generateCharacterTurnaround({ ...input, definition: later.definition }, dependencies);
    const setting = (submissions[0]!.metadata!.promptTemplateVariables as Record<string, string>).角色设定;
    expect(setting).toContain("白衣衣襟留下玉佩印痕");
    expect(setting).toContain("右袖卷起");
    expect(setting).not.toContain("；玉佩；");
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

test("explicit base rebuilding uses the saved face preset, not the previously generated wrong face", async () => {
    const presets = JSON.stringify({ female: { resourceId: "saved-face", assetIds: ["hero"], useAsIdentity: true } });
    const { submissions, dependencies } = harness([version("base", 1, "daily", "old-face"), version("combat", 2, "combat")], presets);
    await generateCharacterTurnaround({ ...input, versionId: "base" }, dependencies);
    const submitted = submissions[0]!;
    expect(submitted.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:saved-face"]);
    expect(submitted.metadata?.characterFacePresetResourceId).toBe("saved-face");
    expect(submitted.metadata?.characterIdentityResourceId).toBeUndefined();
    expect(String((submitted.metadata?.promptTemplateVariables as Record<string, string>).角色设定)).toContain("面孔身份依据");
    await generateCharacterTurnaround(input, dependencies);
    expect(submissions[1]?.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:saved-face"]);
    expect(submissions).toHaveLength(2);
});

test("explicit face identity cannot mix in a second identity", async () => {
    const bound = harness([version("base", 1, "daily", "old-face")], JSON.stringify({ male: { resourceId: "face", assetIds: ["hero"], useAsIdentity: true } }));
    await expect(generateCharacterTurnaround({ ...input, versionId: "base", referenceImage: { id: "other", name: "other", type: "image/png", dataUrl: "", storageKey: "resource:other" } }, bound.dependencies)).rejects.toThrow("移除");
    expect(bound.submissions).toHaveLength(0);
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

test("character image requests carry stable peer design context without mixing other faces", async () => {
    const peer = { ...version("emperor", 1, "robe", "peer-face"), assetId: "emperor", title: "嬴政", definition: { appearance: "消瘦长脸，深眼窝", clothing: "玄色宽袖帝王袍" } };
    const { submissions, dependencies } = harness([version("base", 1, "daily"), peer, { ...peer, versionId: "emperor-later", version: 2, definition: { appearance: "后续伤态" } }]);
    await generateCharacterTurnaround({ ...input, versionId: "base" }, dependencies);
    const variables = submissions[0]?.metadata?.promptTemplateVariables as Record<string, string>;
    expect(variables.同项目角色设计参考).toContain("消瘦长脸");
    expect(variables.同项目角色设计参考).toContain("嬴政");
    expect(variables.同项目角色设计参考).not.toContain("后续伤态");
    expect(submissions[0]?.referenceImages).toEqual([]);
    expect(variables.角色设定).toContain("角色视觉辨识设计");
    const prepared = await prepareBackendGenerationTask(submissions[0]!);
    const metadata = (prepared.input as { metadata: { promptTemplateVariables: Record<string, string> } }).metadata;
    expect(metadata.promptTemplateVariables.同项目角色设计参考).toBe(variables.同项目角色设计参考);
});

test("group actor generations ignore single-face presets and historical single-face images", async () => {
    const versions = [version("base", 1, "daily", "old-single-face"), version("combat", 2, "combat")].map((item) => ({ ...item, title: "工人与食客群像", definition: { ...item.definition, characterType: "group" } }));
    const { submissions, dependencies } = harness(versions, JSON.stringify({ male: { resourceId: "hero-face", assetIds: ["hero"], useAsIdentity: true } }));
    await generateCharacterTurnaround({ ...input, name: "工人与食客群像", definition: versions[1]!.definition }, dependencies);
    expect(submissions[0]?.referenceImages).toEqual([]);
    expect(submissions[0]?.metadata?.characterIdentityResourceId).toBeUndefined();
    expect(submissions[0]?.metadata?.characterFacePresetResourceId).toBeUndefined();
    const variables = submissions[0]?.metadata?.promptTemplateVariables as Record<string, string>;
    expect(variables.角色类型).toBe("group");
    expect(variables.角色设定).toContain("不同面孔");
    expect(variables.角色设定).not.toContain("基础版身份继承");
    await generateCharacterTurnaround({ ...input, name: "工人与食客群像", definition: versions[1]!.definition, referenceImage: { id: "library-group", name: "群演服饰", storageKey: "resource:group-clothing", dataUrl: "", type: "image/png" } }, dependencies);
    expect(submissions[1]?.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:group-clothing"]);
    expect(String((submissions[1]?.metadata?.promptTemplateVariables as Record<string, string>).角色设定)).toContain("不把其中一个人的脸复制给其他成员");
    const calls: string[] = [];
    await submitCharacterLookImages(versions, versions, async (target) => { calls.push(target.versionId); return { status: "queued" } as GenerationTask; }, async () => { throw new Error("group must not wait for base face"); });
    expect(calls).toEqual(["base", "combat"]);
});
