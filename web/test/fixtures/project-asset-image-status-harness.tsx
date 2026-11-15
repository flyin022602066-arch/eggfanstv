import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { getAntThemeConfig } from "@/lib/app-theme";
import { configureApiRuntime } from "@/services/api/request";
import { setActiveUserScope } from "@/lib/user-scope";
import type { GenerationTask } from "@/services/api/task-center";
import { ProjectAssetImageTasks } from "@/pages/projects/detail/project-asset-image-tasks";

setActiveUserScope("image-status-offline-test");
configureApiRuntime("/api", "offline");
const theme = new URLSearchParams(location.search).get("theme") || "light";
document.documentElement.classList.toggle("dark", theme === "dark");
const original: GenerationTask[] = [
    { id: "interrupted", projectId: "project", type: "canvas_image", status: "failed", stage: "submission_unknown", prompt: "", error: "response interrupted", errorCode: "submission_uncertain", attempts: 1, createdAt: "2026-11-10T13:00:00Z", updatedAt: "2026-11-10T13:01:00Z", clientContext: { nodeId: "project-asset-image:scene" } },
    { id: "waiting", projectId: "project", type: "canvas_image", status: "running", stage: "正在发送图片请求，等待上游响应", prompt: "", attempts: 1, createdAt: "2026-11-10T13:02:00Z", updatedAt: "2026-11-10T13:03:00Z", clientContext: { nodeId: "character-turnaround:hero", characterVersionId: "look-winter" } },
];
function Harness() {
    const [tasks, setTasks] = useState(original);
    const [fetching, setFetching] = useState(true);
    const [updatedAt, setUpdatedAt] = useState(0);
    const [error, setError] = useState<string>();
    useEffect(() => { const timer = setTimeout(() => { setFetching(false); setUpdatedAt(Date.now()); }, 500); return () => clearTimeout(timer); }, []);
    Object.assign(window, { imageStatus: { disconnect: () => setError("连接中断"), transfer: () => setTasks(current => current.map(task => task.id === "waiting" ? { ...task, stage: "正在接收图片结果（已接收 1.25 MB）" } : task)) } });
    return <ConfigProvider theme={getAntThemeConfig(theme === "dark")}><App><main className="min-h-screen bg-background p-3 text-foreground"><ProjectAssetImageTasks projectId="project" tasks={tasks} assets={[]} fetching={fetching} updatedAt={updatedAt} error={error} onRefresh={async () => { setError(undefined); setUpdatedAt(Date.now()); }} onRecovered={async () => { setUpdatedAt(Date.now()); }} /></main></App></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
