import { App, Form } from "antd";
import { createRoot } from "react-dom/client";
import { VolcAssetLibrarySettings } from "@/pages/settings/volc-asset-library-settings";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { hydrateModelConfig, commitModelConfig, flushModelConfig } from "@/services/model-config-repository";
import { restoreVolcLibraryAssets } from "@/services/api/volc-asset-library";

export async function mountVolcLibraryHarness(element: HTMLElement) {
    const payload = await hydrateModelConfig();
    useConfigStore.setState({ config: { ...defaultConfig, ...payload.config } });
    useAssetStore.setState({ hydrated: true, assets: [] });
    await restoreVolcLibraryAssets();
    const unsubscribe = useConfigStore.subscribe((state) => { void commitModelConfig(state.config); });
    window.addEventListener("pagehide", () => { unsubscribe(); void flushModelConfig(); });
    Object.assign(window, { volcHarnessAssets: () => useAssetStore.getState().assets });
    createRoot(element).render(<App><Form layout="vertical"><VolcAssetLibrarySettings /></Form></App>);
}
