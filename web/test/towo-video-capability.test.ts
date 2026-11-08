import assert from "node:assert/strict";
import test from "node:test";

import { defaultModelCapabilityConfig, hasAutomaticVideoAudio } from "../src/lib/model-capabilities.ts";

test("Towo SD2.5 exposes its independent full-modal video capability", () => {
    const profile = defaultModelCapabilityConfig("towo-sd25-video", "seedance-2.5").video!;
    assert.equal(profile.references.maxImages, 30);
    assert.equal(profile.references.maxVideos, 10);
    assert.equal(profile.references.maxAudios, 10);
    assert.deepEqual(profile.duration, { selection: "range", min: 4, max: 30, step: 1, default: 5 });
    assert.deepEqual(profile.resolutions, ["480p", "720p", "1080p"]);
    assert.ok(profile.ratios.includes("adaptive"));
    assert.equal(profile.generateAudio.default, true);
    assert.equal(hasAutomaticVideoAudio("towo-sd25-video"), true);
});
