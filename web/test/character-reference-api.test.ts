import { afterEach, expect, test } from "bun:test";
import { apiClient } from "@/services/api/request";
import { getCharacterReferenceCatalog, listProjectCharacters } from "@/services/api/project-character-references";
import { listProjectAssets } from "@/services/api/projects";

const adapter = apiClient.defaults.adapter;
afterEach(() => { apiClient.defaults.adapter = adapter; });

test("storyboard character reads filter on the server without changing other asset requests", async () => {
    const controller = new AbortController();
    apiClient.defaults.adapter = async (config) => {
        expect(config.url).toBe("/projects/p/assets");
        expect(config.params).toEqual({ category: "character" });
        expect(config.timeout).toBe(60_000);
        expect(config.signal).toBe(controller.signal);
        return { data: { code: 0, data: { assets: [] } }, status: 200, statusText: "OK", headers: {}, config };
    };
    expect(await listProjectCharacters("p", undefined, controller.signal)).toEqual({ assets: [] });
    expect(apiClient.defaults.timeout).toBe(4_000);
});

test("appearance catalog has a scoped 60-second deadline and forwards cancellation", async () => {
    const controller = new AbortController();
    apiClient.defaults.adapter = async (config) => {
        expect(config.timeout).toBe(60_000);
        expect(config.signal).toBe(controller.signal);
        return { data: { code: 0, data: { revision: 1, versions: [] } }, status: 200, statusText: "OK", headers: {}, config };
    };
    await getCharacterReferenceCatalog("p", undefined, controller.signal);
    expect(apiClient.defaults.timeout).toBe(4_000);
});

test("complete project asset reads have the same deadline without changing global requests", async () => {
    const controller = new AbortController();
    apiClient.defaults.adapter = async (config) => {
        expect(config.timeout).toBe(60_000);
        expect(config.signal).toBe(controller.signal);
        return { data: { code: 0, data: { assets: [] } }, status: 200, statusText: "OK", headers: {}, config };
    };
    expect(await listProjectAssets("p", undefined, controller.signal)).toEqual({ assets: [] });
    expect(apiClient.defaults.timeout).toBe(4_000);
});
