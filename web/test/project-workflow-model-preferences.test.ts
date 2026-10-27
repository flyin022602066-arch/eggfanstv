import { expect, test } from "bun:test";
import { normalizeProjectWorkflowModels } from "../src/lib/project-workflow-model-preferences";
import { groupModelsByDisplayName, groupModelsIndividually, resolveActiveWorkflowModel, resolveWorkflowModelPreference } from "../src/lib/model-selection";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, selectableModelsByCapability, type AiConfig } from "../src/stores/use-config-store";

test("workflow model preferences retain independent projects and production stages", () => {
    const preferences = {
        first: { video: "jiasu::sd-2.5-j2-V", storyboard: "images::gpt-image-2", previz: "images::gpt-image-1", chapterText: "text::claude-fable-5" },
        second: { video: "mints::doubao-seedance-2-0-mini-260615" },
    };
    const normalizedDefaults = normalizeConfigSnapshot({ config: defaultConfig }).config;
    const restored = normalizeConfigSnapshot({ config: { ...defaultConfig, projectWorkflowModels: JSON.parse(JSON.stringify(preferences)) } }).config;
    expect(restored.projectWorkflowModels).toEqual(preferences);
    expect(restored.videoModel).toBe(normalizedDefaults.videoModel);
    expect(restored.imageModel).toBe(normalizedDefaults.imageModel);
});

test("unavailable remembered models survive catalog normalization instead of being replaced", () => {
    const restored = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [], projectWorkflowModels: { first: { video: "removed::selected-model", chapterText: "removed::selected-text" } } } }).config;
    expect(restored.projectWorkflowModels?.first?.video).toBe("removed::selected-model");
    expect(restored.projectWorkflowModels?.first?.chapterText).toBe("removed::selected-text");
});

test("workflow preferences discard invalid fields and keep only model identifiers", () => {
    expect(normalizeProjectWorkflowModels({ first: { video: " jiasu::model ", storyboard: 10, previz: null, prompt: "not a preference" }, second: [], "": { video: "ignored" } })).toEqual({ first: { video: "jiasu::model" } });
    expect(normalizeProjectWorkflowModels(null)).toEqual({});
    expect(normalizeProjectWorkflowModels([])).toEqual({});
});

test("video picker keeps same-display-name models from every channel individually selectable", () => {
    const channels = [
        createModelChannel({ id: "eggfans", name: "Eggfans TV", interfaceType: "eggfans-seedance-video", models: ["seedance-2.5", "seedance-2.5-fast"], modelProfiles: ["seedance-2.5", "seedance-2.5-fast"].map((model) => ({ model, displayName: "Seedance 2.5", capability: "video" as const, protocol: "eggfans-seedance-video" })) }),
        createModelChannel({ id: "jiasu-video", name: "佳速", interfaceType: "jiasu-video", models: ["dola-sd-2.5", "minimax-h3"], modelProfiles: ["dola-sd-2.5", "minimax-h3"].map((model) => ({ model, displayName: "视频模型", capability: "video" as const, protocol: "jiasu-video" })) }),
        createModelChannel({ id: "mints", name: "Mints", interfaceType: "mints-seedance-video", models: ["doubao-seedance-2-0"], modelProfiles: [{ model: "doubao-seedance-2-0", displayName: "Seedance 2.0", capability: "video", protocol: "mints-seedance-video" }] }),
    ];
    const config = { ...defaultConfig, channels } as AiConfig;
    const available = selectableModelsByCapability(config, "video");

    expect(available).toHaveLength(5);
    expect(groupModelsByDisplayName(config, available)).toHaveLength(3);
    expect(groupModelsIndividually(config, available).flatMap((group) => group.models)).toEqual(available);
});

test("video stage skips a configured image model but preserves a not-yet-loaded preference", () => {
    const videoModels = ["jiasu-video::dola-sd-2.5", "eggfans::seedance-2.5"];
    const imageModel = "images::gpt-image-2";
    expect(resolveWorkflowModelPreference({
        rememberedModel: imageModel,
        projectDefaultModel: "",
        globalDefaultModel: imageModel,
        selectableModels: videoModels,
        allModels: [...videoModels, imageModel],
    })).toBe(videoModels[0]);
    expect(resolveWorkflowModelPreference({
        rememberedModel: "temporarily-missing::video-model",
        projectDefaultModel: "",
        globalDefaultModel: imageModel,
        selectableModels: videoModels,
        allModels: [...videoModels, imageModel],
    })).toBe("temporarily-missing::video-model");
});

test("active workflow model switches capability synchronously before effects run", () => {
    const config = {
        ...defaultConfig,
        channels: [
            createModelChannel({ id: "images", name: "Images", interfaceType: "openai-image", models: ["gpt-image-2"], modelProfiles: [{ model: "gpt-image-2", capability: "image" }] }),
            createModelChannel({ id: "jiasu", name: "Jiasu", interfaceType: "jiasu-video", models: ["sd-2.5-j2-V"], modelProfiles: [{ model: "sd-2.5-j2-V", capability: "video" }] }),
        ],
    } as AiConfig;

    expect(resolveActiveWorkflowModel({ config, capability: "video", selectedModel: "images::gpt-image-2", initialModel: "jiasu::sd-2.5-j2-V" })).toBe("jiasu::sd-2.5-j2-V");
    expect(resolveActiveWorkflowModel({ config, capability: "image", selectedModel: "images::gpt-image-2", initialModel: "jiasu::sd-2.5-j2-V" })).toBe("images::gpt-image-2");
});
