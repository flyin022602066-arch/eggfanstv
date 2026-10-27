import { expect, mock, test } from "bun:test";

let scope = "playback-test";
mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => scope }));
mock.module("localforage", () => ({
    default: {
        createInstance: () => {
            const values = new Map();
            return {
                getItem: async (key: string) => values.get(key) ?? null,
                setItem: async (key: string, value: unknown) => { values.set(key, value); return value; },
                removeItem: async (key: string) => { values.delete(key); },
                length: async () => values.size,
                iterate: async (callback: (value: unknown) => void) => { values.forEach(callback); },
            };
        },
    },
}));

const { apiClient, configureApiRuntime } = await import("@/services/api/request");
const { cacheResourceObjectUrl, getCachedResourceBlob, primeResourceBlobCache } = await import("@/services/resource-blob-cache");
const { getResourcePlaybackBlob } = await import("@/services/api/resources");

test("playback cache remains separate from originals and user scopes, with desktop authentication", async () => {
    const previousAdapter = apiClient.defaults.adapter;
    const previousBase = apiClient.defaults.baseURL;
    const previousToken = apiClient.defaults.headers.common["X-Desktop-Token"];
    const requests: string[] = [];
    configureApiRuntime("http://127.0.0.1:12345/api", "synthetic-desktop-token");
    apiClient.defaults.adapter = async (config) => {
        expect(config.headers.get("X-Desktop-Token")).toBe("synthetic-desktop-token");
        expect(config.timeout).toBe(120_000);
        requests.push(config.url || "");
        return { status: 200, statusText: "OK", config, headers: {}, data: new Blob(["H264"], { type: "video/mp4" }) };
    };
    try {
        await primeResourceBlobCache("resource:video", new Blob(["HEVC"]));
        const compatible = await cacheResourceObjectUrl("resource:video", "playback");
        expect(await (await fetch(compatible)).text()).toBe("H264");
        expect(await (await getCachedResourceBlob("resource:video"))?.text()).toBe("HEVC");
        expect(await cacheResourceObjectUrl("resource:video", "playback")).toBe(compatible);
        expect(requests).toEqual(["/resources/video/file?variant=playback&proxy=1"]);
        scope = "another-user";
        expect(await cacheResourceObjectUrl("resource:video", "playback")).not.toBe(compatible);
        expect(requests.length).toBe(2);
        apiClient.defaults.adapter = async () => { throw new Error("offline"); };
        await expect(getResourcePlaybackBlob("resource:uncached")).rejects.toThrow("offline");
    } finally {
        apiClient.defaults.adapter = previousAdapter;
        apiClient.defaults.baseURL = previousBase;
        apiClient.defaults.headers.common["X-Desktop-Token"] = previousToken;
    }
});
