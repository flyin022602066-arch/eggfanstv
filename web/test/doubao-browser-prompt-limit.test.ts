import assert from "node:assert/strict";
import test from "node:test";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor } from "../src/lib/model-capabilities.ts";
import { modelPromptLengthError } from "../src/lib/model-selection.ts";
import type { AiConfig } from "../src/stores/use-config-store.ts";

test("Doubao browser allows 8000 characters despite a cached 4000-character profile", () => {
    for (const model of ["seedance_v2.5", "seedance_v2.0_std", "seedance_v2.0", "seedance_v2.0_mini"]) {
        const stale = defaultModelCapabilityConfig("doubao-browser-video", model);
        stale.video!.references.promptMaxChars = 4000;
        const config = { channels: [{ id: "doubao-browser", interfaceType: "doubao-browser-video" as const, models: [model], modelProfiles: [{ model, protocol: "doubao-browser-video" as const, capabilityConfig: stale }] }] };
        assert.equal(defaultModelCapabilityConfig("doubao-browser-video", model).video!.references.promptMaxChars, 8000);
        assert.equal(modelCapabilityConfigFor(config, `doubao-browser::${model}`).video!.references.promptMaxChars, 8000);
        const prompt = "镜\u{1F3AC}".repeat(4000);
        assert.equal(modelPromptLengthError(config as AiConfig, `doubao-browser::${model}`, "video", prompt), "");
        assert.match(modelPromptLengthError(config as AiConfig, `doubao-browser::${model}`, "video", prompt + "镜"), /8000/);
    }
    assert.equal(defaultModelCapabilityConfig("full-video", "sd-native-full-2.0").video!.references.promptMaxChars, 4000);
    assert.equal(defaultModelCapabilityConfig("nono-video", "fixture").video!.references.promptMaxChars, 15000);
});
