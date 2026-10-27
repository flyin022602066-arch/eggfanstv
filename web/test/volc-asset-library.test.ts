import { expect, test } from "bun:test";
import { defaultConfig, normalizeConfigSnapshot, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import { volcLibraryAssetInput, type VolcLibraryAsset } from "../src/services/api/volc-asset-library";

test("model settings include a separate persistent Volc URI upload configuration", () => {
    const normalized = normalizeConfigSnapshot({ config: { ...defaultConfig } }).config as AiConfig & { volcAssetLibrary?: Record<string, unknown> };
    expect(normalized.volcAssetLibrary).toEqual({
        enabled: true,
        baseUrl: "https://20nbifxd.magine.work/v1",
        apiKey: "",
        groupName: "Eggfans TV 自动参考素材",
        projectName: "default",
    });
});

test("local image records restore original previews and the exact remote URI separately", () => {
    const record = { id: "binding-1", resourceId: "resource-1", name: "角色A", uri: "asset://remote-image", assetId: "remote-image", groupId: "local-group", baseUrl: "https://20nbifxd.magine.work/v1", imageFile: "binding-1.png", publicUrl: "https://h.uguu.se/expired.png", mimeType: "image/png", bytes: 100, width: 20, height: 30, createdAt: "2026-10-10T00:00:00Z" } satisfies VolcLibraryAsset;
    const asset = volcLibraryAssetInput(record);
    expect(asset.kind).toBe("image");
    expect(asset.arkAssetId).toBe("remote-image");
    expect(asset.metadata?.assetUri).toBe(record.uri);
    if (asset.kind === "image") {
        expect(asset.data.storageKey).toBe("resource:resource-1");
        expect(asset.data.dataUrl).toContain("/resources/resource-1/file");
        expect(asset.data.dataUrl).not.toBe(record.publicUrl);
    }
    expect(() => volcLibraryAssetInput({ ...record, assetId: "wrong-id" })).toThrow("有效 URI");
});

test("browser persistence redacts the upload credential while retaining settings", () => {
    const config = { ...defaultConfig, volcAssetLibrary: { enabled: true, baseUrl: "https://assets.example/v1", apiKey: "asset-private-key", groupName: "角色", projectName: "default" } } as AiConfig;
    const partialize = useConfigStore.persist.getOptions().partialize!;
    const snapshot = partialize({ ...useConfigStore.getState(), config }) as { config: AiConfig & { volcAssetLibrary: { apiKey: string; groupName: string } } };
    expect(snapshot.config.volcAssetLibrary.apiKey).toBe("__BEEFTV_REDACTED__");
    expect(snapshot.config.volcAssetLibrary.groupName).toBe("角色");
    expect(JSON.stringify(snapshot)).not.toContain("asset-private-key");
    expect((config as typeof snapshot.config).volcAssetLibrary.apiKey).toBe("asset-private-key");
});
