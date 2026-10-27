import { App, ConfigProvider } from "antd";
import { createRoot } from "react-dom/client";
import { ChannelSettingsPane } from "@/pages/settings/channel-settings-pane";
import { createModelChannel, defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { setActiveUserScope } from "@/lib/user-scope";

const storageKey = "packaged-settings-fixture";
setActiveUserScope("packaged-settings-fixture");
const channels = [
    createModelChannel({ id: "fixture-eggfans", name: "Eggfans TV", baseUrl: "https://api.eggfans.com", catalogUrl: "https://api.eggfans.com/pricing", apiKey: "fixture-key", models: ["gpt-image-2"] }),
    createModelChannel({ id: "fixture-jiasu", name: "佳速视频", baseUrl: "https://ai.jiasuapi.com", catalogUrl: "https://ai.jiasuapi.com/models", apiKey: "fixture-jiasu-key", models: ["dola-sd-2.5"] }),
];
const initial = new URLSearchParams(location.search).has("empty") ? { ...defaultConfig, channels: [] } : { ...defaultConfig, channels };
useConfigStore.setState({ config: JSON.parse(sessionStorage.getItem(storageKey) || "null") || initial });
useConfigStore.subscribe((state) => sessionStorage.setItem(storageKey, JSON.stringify(state.config)));
Object.assign(window, { settingsFixture: { snapshot: () => useConfigStore.getState().config } });
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<ConfigProvider><App><main className="p-6"><ChannelSettingsPane /></main></App></ConfigProvider>);
