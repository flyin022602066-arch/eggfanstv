import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanvasStylePickerModal } from "@/components/canvas/canvas-style-picker-modal";
import { getAntThemeConfig } from "@/lib/app-theme";
import type { CanvasStylePreset } from "@/lib/canvas/canvas-style-system";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { useThemeStore } from "@/stores/use-theme-store";
import "@/styles/globals.css";

const dark = new URLSearchParams(window.location.search).get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);
setActiveUserScope("overseas-style-offline-test");
useUserStore.setState({ storageMode: "local", user: null });
useThemeStore.getState().setTheme(dark ? "dark" : "light");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Harness() {
    const [open, setOpen] = useState(true);
    const [preset, setPreset] = useState<CanvasStylePreset>();
    return <><Button onClick={() => setOpen(true)}>打开画风</Button><Button disabled={!preset} onClick={() => setPreset((current) => current?.profile ? { ...current, id: "user-overseas-fixture", profile: { ...current.profile, presetId: "user-overseas-fixture", source: "user" } } : current)}>模拟个人风格快照</Button><output aria-label="已应用画风">{preset ? JSON.stringify(preset) : ""}</output><CanvasStylePickerModal open={open} value={preset?.id} currentProfile={preset?.profile} onClose={() => setOpen(false)} onSelect={(selected) => { setPreset(selected); setOpen(false); }} /></>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><ConfigProvider theme={getAntThemeConfig(dark)}><App><Harness /></App></ConfigProvider></QueryClientProvider>);
