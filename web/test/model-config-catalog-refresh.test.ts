import { expect, test } from "bun:test";

import { createModelChannel, defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { refreshEggfansModelCatalog } from "../src/services/model-config-catalog-refresh";

function makeConfig() {
    return {
        ...defaultConfig,
        channels: [
            createModelChannel({
                id: "beefapi",
                name: "Eggfans TV",
                baseUrl: "https://api.eggfans.com",
                catalogUrl: "https://api.eggfans.com/pricing",
                apiKey: "test-key",
                models: ["old-model"],
            }),
            createModelChannel({ id: "jiasu-video", baseUrl: "https://ai.jiasuapi.com", apiKey: "jiasu-key", models: ["jiasu-model"] }),
        ],
    } satisfies AiConfig;
}

test("startup catalog refresh replaces and persists the Eggfans model list", async () => {
    let config = makeConfig();
    const persisted: AiConfig[] = [];
    const fetchedChannels: string[] = [];

    const refreshed = await refreshEggfansModelCatalog({
        getConfig: () => config,
        replaceConfig: (next) => { config = next; },
        fetchModels: async (channel) => {
            fetchedChannels.push(channel.id);
            return { models: ["new-model"], catalog: [{ id: "new-model", modelType: "text" }] };
        },
        persist: async (next) => { persisted.push(next); },
    });

    expect(refreshed).toBe(true);
    expect(fetchedChannels).toEqual(["beefapi"]);
    expect(config.channels[0]?.models).toEqual(["new-model"]);
    expect(config.channels[0]?.modelProfiles?.[0]).toMatchObject({ model: "new-model", capability: "text" });
    expect(config.channels[1]?.models).toEqual(["jiasu-model"]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.channels[0]?.models).toEqual(["new-model"]);
});

test("empty catalog responses leave the saved Eggfans list unchanged", async () => {
    const config = makeConfig();
    let replacements = 0;
    let saves = 0;

    const refreshed = await refreshEggfansModelCatalog({
        getConfig: () => config,
        replaceConfig: () => { replacements += 1; },
        fetchModels: async () => ({ models: [], catalog: [] }),
        persist: async () => { saves += 1; },
    });

    expect(refreshed).toBe(false);
    expect(config.channels[0]?.models).toEqual(["old-model"]);
    expect(replacements).toBe(0);
    expect(saves).toBe(0);
});

test("a slow refresh cannot overwrite a manual model-list update", async () => {
    let config = makeConfig();
    let releaseFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    let saves = 0;
    const pending = refreshEggfansModelCatalog({
        getConfig: () => config,
        replaceConfig: (next) => { config = next; },
        fetchModels: async () => {
            await fetchGate;
            return { models: ["stale-fetch"], catalog: [{ id: "stale-fetch", modelType: "text" }] };
        },
        persist: async () => { saves += 1; },
    });

    config = {
        ...config,
        channels: config.channels.map((channel) => channel.id === "beefapi" ? { ...channel, models: ["manual-update"] } : channel),
    };
    releaseFetch?.();

    expect(await pending).toBe(false);
    expect(config.channels[0]?.models).toEqual(["manual-update"]);
    expect(saves).toBe(0);
});
