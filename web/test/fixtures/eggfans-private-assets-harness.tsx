import { App } from "antd";
import { createRoot } from "react-dom/client";
import { EggfansPrivateAssetsButton } from "@/components/eggfans-private-assets-modal";
import { createModelChannel, defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";

export function mountEggfansPrivateAssetsHarness(element: HTMLElement) {
    const model = "doubao-seedance-2-5-260628";
    const channel = createModelChannel({ id: "eggfans-test", name: "Eggfans mock", baseUrl: "https://api.eggfans.com", apiKey: "mock-key", models: [model], modelProfiles: [{ model, protocol: "eggfans-seedance-video", capability: "video" }] });
    useConfigStore.setState({ config: { ...defaultConfig, channels: [channel] } });
    useAssetStore.setState({ hydrated: true, assets: [{ id: "mock-local", kind: "image", title: "测试角色", coverUrl: "", tags: [], status: "confirmed", category: "character", data: { dataUrl: "", storageKey: "resource:mock-image", width: 512, height: 512, bytes: 100, mimeType: "image/png" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
    createRoot(element).render(<App><EggfansPrivateAssetsButton channel={channel} /></App>);
}
