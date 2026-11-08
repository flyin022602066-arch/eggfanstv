import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { getAntThemeConfig } from "@/lib/app-theme";
import { setActiveUserScope } from "@/lib/user-scope";
import { configureApiRuntime } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";
import { useThemeStore } from "@/stores/use-theme-store";
import ProjectsPage from "@/pages/projects";
import "@/styles/globals.css";

setActiveUserScope("project-styles-offline-regression");
useUserStore.setState({ storageMode: "local", user: null });
configureApiRuntime("/api", "offline-desktop-test");
const dark = new URLSearchParams(window.location.search).get("theme") !== "light";
document.documentElement.classList.toggle("dark", dark);
useThemeStore.getState().setTheme(dark ? "dark" : "light");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Harness() {
    const location = useLocation();
    return <><output aria-label="当前项目路由">{location.pathname}</output><ProjectsPage /></>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter initialEntries={["/projects?create=1"]}><Harness /></MemoryRouter></App></ConfigProvider></QueryClientProvider>);
