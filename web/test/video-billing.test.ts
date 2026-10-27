import { expect, test } from "bun:test";
import { sanitizeChannelModelCatalogItem, mergeFetchedChannelModelProfiles } from "../src/lib/channel-model-catalog";
import { sanitizeVideoBilling, videoBillingLines, videoBillingSummary } from "../src/lib/video-billing";
import { createModelChannel } from "../src/stores/use-config-store";

test("video billing uses the active unit and preserves resolution-specific per-item rates", () => {
    const billing = { enabled: true, unit: "per_item", default_resolution: "720p", tiers: [{ key: "720p", price_per_second: 0.2, price_per_item: 6.5 }, { key: "1080p", price_per_item: 12 }] };
    expect(videoBillingLines(billing)).toEqual(["720p：6.5 / 条", "1080p：12 / 条"]);
    expect(videoBillingSummary(billing)).toBe("6.5–12 / 条");
    expect(videoBillingLines({ ...billing, unit: "per_second", tiers: [billing.tiers[0]] })).toEqual(["720p：0.2 / 秒"]);
});

test("catalog prices survive profile merging and a refreshed price replaces the old quote", () => {
    const channel = createModelChannel({ id: "jiasu-video", interfaceType: "jiasu-video", models: ["seedance2.5"] });
    const item = sanitizeChannelModelCatalogItem({ id: "seedance2.5", modelType: "video", supportedEndpointTypes: ["openai-video"], videoBilling: sanitizeVideoBilling(undefined, 1, 7) })!;
    const profiles = mergeFetchedChannelModelProfiles(channel, [item]);
    expect(videoBillingSummary(profiles[0].videoBilling)).toBe("7 / 条");
    const refreshed = mergeFetchedChannelModelProfiles({ ...channel, modelProfiles: profiles }, [{ ...item, videoBilling: null }]);
    expect(refreshed[0].videoBilling).toBeNull();
});

test("billing falls back to explicit per-item model pricing and rejects missing or invalid rates", () => {
    expect(videoBillingSummary(sanitizeVideoBilling(null, 1, 0.8))).toBe("0.8 / 条");
    expect(videoBillingSummary(sanitizeVideoBilling(null, 2, 0.4))).toBe("0.4 / 秒");
    for (const value of [undefined, {}, { enabled: false }, { enabled: true, unit: "per_item", tiers: [{ key: "720p", price_per_item: -1 }] }]) {
        expect(videoBillingSummary(value)).toBe("");
    }
    expect(sanitizeVideoBilling(null, 0, 7)).toBeNull();
});
