import { expect, test } from "bun:test";
import { characterFacePresetForAsset, parseCharacterFacePresets } from "../src/lib/project-character-face-presets";
import { generateCharacterTurnaround } from "../src/pages/projects/detail/project-character-media";
import { prepareBackendGenerationTask, type submitBackendGenerationTask } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import type { ProjectCore } from "../src/services/api/projects";
import type { GenerationTask } from "../src/services/api/task-center";
import { uploadCharacterFaceReference } from "../src/services/project-character-face-presets";
import type { RemoteResource } from "../src/services/api/resources";

const channel = createModelChannel({ id: "face-test", name: "fixture", interfaceType: "openai-image", baseUrl: "https://example.invalid", apiKey: "fixture-only", models: ["gpt-image-2"] });
const model = encodeChannelModel(channel.id, "gpt-image-2");
const config = { ...defaultConfig, channels: [channel], model, imageModel: model };
const rawPresets = JSON.stringify({ male: { resourceId: "male-face", assetIds: ["hero", "hero-costume"] }, female: { resourceId: "female-face", assetIds: ["heroine"] } });
const character = { projectId: "project", assetId: "hero", versionId: "v1", name: "男主甲", definition: { role: "东汉医者", clothing: "青色麻布长袍", multiViewPrompt: "保留药囊" }, config };
type Submission = Parameters<typeof submitBackendGenerationTask>[0];

test("male and female presets bind by explicit character ID and survive JSON reload", () => {
    const saved = JSON.stringify(parseCharacterFacePresets(rawPresets));
    expect(characterFacePresetForAsset(saved, "hero")?.resourceId).toBe("male-face");
    expect(characterFacePresetForAsset(saved, "hero-costume")?.resourceId).toBe("male-face");
    expect(characterFacePresetForAsset(saved, "heroine")?.resourceId).toBe("female-face");
    expect(characterFacePresetForAsset(saved, "other")).toBeUndefined();
    expect(characterFacePresetForAsset(undefined, "hero")).toBeUndefined();
});

test("invalid settings and dual-face bindings fail visibly instead of silently generating", () => {
    for (const raw of ["invalid", "null", "[]", '{"male":{"assetIds":["hero"]}}', '{"male":{"resourceId":"a","assetIds":["hero"]},"female":{"resourceId":"b","assetIds":["hero"]}}']) {
        expect(() => parseCharacterFacePresets(raw)).toThrow();
    }
});

test("actual task payload carries one face reference plus script costume and protected layout instructions", async () => {
    let submitted: Submission | undefined;
    await generateCharacterTurnaround(character, {
        loadProject: async () => ({ project: { id: "project", characterFacePresetsJson: rawPresets } } as ProjectCore),
        submitTask: async (options) => { submitted = options; return {} as GenerationTask; },
    });
    const task = await prepareBackendGenerationTask(submitted!);
    const input = task.input as { referenceImages: Array<{ storageKey: string }>; metadata: { promptTemplateVariables: { 角色设定: string }; resolvedCharacterVersions: unknown[] }; config: { model: string } };
    expect(input.referenceImages.map((image) => image.storageKey)).toEqual(["resource:male-face"]);
    expect(input.config.model).toBe("gpt-image-2");
    expect(input.metadata.resolvedCharacterVersions).toEqual([{ assetId: "hero", versionId: "v1" }]);
    for (const requirement of ["东汉医者", "青色麻布长袍", "保留药囊", "面孔身份依据", "不照搬", "不混合男女主", "不含头部"]) expect(input.metadata.promptTemplateVariables.角色设定).toContain(requirement);
});

test("each batch character uses its own face and fetches latest saved project reference", async () => {
    let latest = rawPresets;
    const submissions: Submission[] = [];
    const dependencies = {
        loadProject: async (projectId: string) => ({ project: { id: projectId, characterFacePresetsJson: projectId === "other-project" ? "{}" : latest } } as ProjectCore),
        submitTask: async (options: Submission) => { submissions.push(options); return {} as GenerationTask; },
    };
    await generateCharacterTurnaround(character, dependencies);
    await generateCharacterTurnaround({ ...character, assetId: "heroine" }, dependencies);
    latest = JSON.stringify({ male: { resourceId: "new-face", assetIds: ["hero"] } });
    await generateCharacterTurnaround(character, dependencies);
    await generateCharacterTurnaround({ ...character, projectId: "other-project" }, dependencies);
    latest = "{}";
    await generateCharacterTurnaround(character, dependencies);
    expect(submissions.map((item) => item.referenceImages?.map((image) => image.storageKey))).toEqual([["resource:male-face"], ["resource:female-face"], ["resource:new-face"], [], []]);
    expect(JSON.stringify(submissions[4].metadata)).not.toContain("主角预设人脸与服装造型设计");
});

test("unreadable preset source prevents task submission", async () => {
    let calls = 0;
    await expect(generateCharacterTurnaround(character, { loadProject: async () => { throw new Error("本地项目读取失败"); }, submitTask: async () => { calls++; return {} as GenerationTask; } })).rejects.toThrow("本地项目读取失败");
    expect(calls).toBe(0);
});

test("face upload saves the original resource and only returns stable IDs", async () => {
    const file = new File(["synthetic"], "男主.png", { type: "image/png" });
    let calls = 0;
    const result = await uploadCharacterFaceReference(file, {
        readFileAsDataUrl: async () => "data:image/png;base64,fixture",
        readImageMeta: async () => ({ width: 1000, height: 1200, mimeType: "image/png" }),
        uploadResourceFile: async (original, kind, meta) => {
            calls++;
            expect(original).toBe(file);
            expect(kind).toBe("image");
            expect(meta).toMatchObject({ fileName: "男主.png", width: 1000, height: 1200 });
            return { id: "stable-face", status: "ready" } as RemoteResource;
        },
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ resourceId: "stable-face", fileName: "男主.png" });
    expect(JSON.stringify(result)).not.toContain("data:");
});

test("non-image files are rejected before any upload", async () => {
    await expect(uploadCharacterFaceReference(new File(["bad"], "bad.mp4", { type: "video/mp4" }))).rejects.toThrow("JPG");
});
