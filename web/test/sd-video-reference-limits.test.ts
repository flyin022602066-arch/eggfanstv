import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor } from "@/lib/model-capabilities";

const cases = [
    ["eggfans-sd2-video", "sd-2.5-B", 30],
    ["eggfans-sd2-video", "sd-2.5-D", 30],
    ["eggfans-sd2-video", "sd-2.0-A", 10],
    ["jiasu-video", "dola-sd-2.5", 30],
    ["jiasu-video", "sd-2.5-j2-V", 30],
    ["jiasu-video", "dola-sd-2.0", 10],
    ["jiasu-video", "sd-2.0-mini-J1", 10],
    ["eggfans-seedance-video", "seedance-2.5", 30],
    ["eggfans-volc-video", "seedance-2.0", 10],
    ["mints-seedance-video", "doubao-seedance-2-0-mini-260615", 10],
    ["openai", "vendor/sd2.5-pro", 30],
    ["newapi", "custom-SD2.5-fast", 30],
    ["jiasu-video", "dola-sd2.5", 30],
    ["eggfans-sd2-video", "SD2.5-D", 30],
    ["volcengine-ark-video", "doubao-seedance-2-5-260528", 30],
    ["openai", "seedance-2.5-fast", 30],
    ["jiasu-video", "minimax-h3", 10],
    ["newapi", "video-custom", 10],
] as const;

for (const [protocol, model, maximum] of cases) {
    test(`${protocol} ${model} uses ${maximum} image references even with stale saved limits`, () => {
        expect(defaultModelCapabilityConfig(protocol, model).video!.references.maxImages).toBe(maximum);
        const saved = defaultModelCapabilityConfig(protocol, model);
        saved.video!.references.maxImages = 6;
        const config = { channels: [{ id: "fixture", interfaceType: protocol, models: [model], modelProfiles: [{ model, protocol, capabilityConfig: saved }] }] };
        expect(modelCapabilityConfigFor(config, `fixture::${model}`).video!.references.maxImages).toBe(maximum);
    });
}

test("video reference policy leaves image and text model limits unchanged", () => {
    const saved = defaultModelCapabilityConfig("openai", "video-custom");
    saved.image!.references.maxImages = 6;
    saved.text!.references.maxImages = 6;
    saved.video!.references.maxImages = 6;
    const config = { channels: [{ id: "fixture", interfaceType: "openai" as const, models: ["video-custom"], modelProfiles: [{ model: "video-custom", protocol: "openai" as const, capabilityConfig: saved }] }] };
    const profile = modelCapabilityConfigFor(config, "fixture::video-custom");
    expect(profile.image!.references.maxImages).toBe(6);
    expect(profile.text!.references.maxImages).toBe(6);
    expect(profile.video!.references.maxImages).toBe(10);
});

for (const [protocol, model] of cases.filter((item) => item[2] === 30)) {
    test(`${protocol} ${model} restores the 15000 character prompt limit`, () => {
        const saved = defaultModelCapabilityConfig(protocol, model);
        expect(saved.video!.references.promptMaxChars).toBe(15000);
        saved.video!.references.promptMaxChars = 8000;
        const config = { channels: [{ id: "fixture", interfaceType: protocol, models: [model], modelProfiles: [{ model, protocol, capabilityConfig: saved }] }] };
        expect(modelCapabilityConfigFor(config, `fixture::${model}`).video!.references.promptMaxChars).toBe(15000);
    });
}
