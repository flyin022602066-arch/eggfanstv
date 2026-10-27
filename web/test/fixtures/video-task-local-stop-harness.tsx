import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { VideoTaskLocalStop } from "../../src/components/generation/video-task-local-stop";
import type { GenerationTask } from "../../src/services/api/task-center";

function Harness() {
    const query = new URLSearchParams(window.location.search);
    const [task, setTask] = useState<GenerationTask>({
        id: "local-video", type: query.get("type") || "canvas_video",
        status: query.get("status") as GenerationTask["status"] || "running",
        progress: 30, stage: "上游生成中", prompt: "test", model: "seedance-2.5",
        providerRequestId: "upstream-video", attempts: 1,
        createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:01Z",
    });
    return <>
        <button disabled={task.status === "running" || task.status === "queued"}>重新生成</button>
        <VideoTaskLocalStop task={task} onStopped={setTask} />
        <pre id="receipt">{JSON.stringify(task)}</pre>
    </>;
}

window.addEventListener("canvas:task-cancelled", () => { document.documentElement.dataset.cancelled = "true"; });
window.addEventListener("canvas:task-updated", () => { document.documentElement.dataset.updated = "true"; });
createRoot(document.getElementById("root")!).render(<ConfigProvider theme={{ token: { motion: false } }}><App><Harness /></App></ConfigProvider>);
