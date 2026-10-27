import { describe, expect, test } from "bun:test";

import { buildMaskEditGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const defaultImageModel = "eggfans::gpt-image-2";
const otherImageModel = "eggfans::aigc-image-kling";
const config: AiConfig = {
    ...defaultConfig,
    model: otherImageModel,
    imageModel: defaultImageModel,
    models: [otherImageModel, defaultImageModel],
    imageModels: [otherImageModel, defaultImageModel],
    channels: [{
        id: "eggfans",
        name: "Eggfans TV",
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        interfaceType: "openai-image",
        models: ["aigc-image-kling", "gpt-image-2"],
        modelProfiles: ["aigc-image-kling", "gpt-image-2"].map((model) => ({ model, capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 1 })),
    }],
};

const source: CanvasNodeData = {
    id: "source",
    type: CanvasNodeType.Image,
    title: "Source image",
    position: { x: 0, y: 0 },
    width: 512,
    height: 512,
    metadata: { content: "data:image/png;base64,source" },
};

describe("canvas mask edit model selection", () => {
    test("uses the default image model when the general model is different", () => {
        const generationConfig = buildMaskEditGenerationConfig(config, source);

        expect(generationConfig.model).toBe(defaultImageModel);
        expect(generationConfig.imageModel).toBe(defaultImageModel);
    });

    test("uses the current default instead of the source image's previous model", () => {
        const previousSource = { ...source, metadata: { ...source.metadata, model: otherImageModel } };
        const generationConfig = buildMaskEditGenerationConfig(config, previousSource);

        expect(generationConfig.model).toBe(defaultImageModel);
        expect(generationConfig.imageModel).toBe(defaultImageModel);
        expect(previousSource.metadata.model).toBe(otherImageModel);
    });

    test("keeps the explicitly selected image model for submission", () => {
        const generationConfig = buildMaskEditGenerationConfig(config, source, { imageModel: otherImageModel, size: "16:9", quality: "2k", count: "2" });

        expect(generationConfig.model).toBe(otherImageModel);
        expect(generationConfig.imageModel).toBe(otherImageModel);
        expect(generationConfig.size).toBe("16:9");
        expect(generationConfig.quality).toBe("2k");
        expect(generationConfig.count).toBe("2");
        expect(config.imageModel).toBe(defaultImageModel);
    });

    test("submits the model shown by the picker when model fields disagree", () => {
        const generationConfig = buildMaskEditGenerationConfig(config, source, { model: otherImageModel, imageModel: defaultImageModel });

        expect(generationConfig.model).toBe(defaultImageModel);
        expect(generationConfig.imageModel).toBe(defaultImageModel);
    });
});
