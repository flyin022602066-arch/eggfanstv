import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";
import type { GenerationTask } from "@/services/api/task-center";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { getAntThemeConfig } from "@/lib/app-theme";
import WorkflowProductionWorkbench from "@/pages/projects/detail/workflow-production-workbench";

setActiveUserScope("preview-selection-offline-regression");
useUserStore.setState({ hydrated: true, storageMode: "local", user: null });
const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);
const timestamp = "2026-11-01T00:00:00Z";
const assetCase = new URLSearchParams(location.search).get("assetCase");
const projectId = "preview-project";
const unitId = "preview-chapter";
const shots: ProjectShot[] = ["a", "b", "c", "empty"].map((name, position) => ({
    id: "shot-" + name, projectId, unitId, title: "镜头" + (position + 1), description: "", position,
    durationMs: 30000, status: "active", createdAt: timestamp, updatedAt: timestamp,
}));
const tasks = shots.slice(0, 3).flatMap((shot) => ["old", "latest"].map((version, position) => ({
    id: shot.id + "-" + version, projectId, type: "canvas_video", status: "running", prompt: "", attempts: 1,
    providerRequestId: "api-" + shot.id + "-" + version, createdAt: timestamp.replace("00:00:00", "0" + position + ":00:00"),
    updatedAt: timestamp, clientContext: { shotId: shot.id, artifactType: "video" },
} as GenerationTask)));
const artifacts: ShotArtifact[] = tasks.map((task, position) => ({
    id: "artifact-" + task.id, projectId, unitId, shotId: task.clientContext!.shotId!, taskId: task.id, type: "video",
    version: position % 2 + 1, status: "ready", selected: position % 2 === 1, metadataJson: "{}", createdAt: timestamp, updatedAt: timestamp,
}));
const detail: ProjectDetail = {
    project: { id: projectId, userId: "local", name: "预览测试", type: "short-drama", aspectRatio: "16:9", sourceType: "blank", description: "", stylePresetId: "", status: "active", revision: 1, createdAt: timestamp, updatedAt: timestamp },
    units: [], canvases: [], canvasUnitLinks: [], assets: [], assetFolders: [], workflows: [], shots, shotRevisions: [],
    shotArtifacts: artifacts, shotReferences: [], assetCandidates: [], tasks,
};

if (assetCase) {
    shots[0]!.currentRevisionId = "asset-case-revision";
    detail.shotArtifacts = [];
    detail.assets = ["scene", "prop"].map((name, index) => ({
        id: "fixture-" + name, title: index ? "训练护具" : "基地训练区", category: index ? "prop" : "environment", mediaType: "image",
        status: "confirmed", primaryVersionId: "version-" + name, versionCount: 1, usages: [], position: index,
        storageKey: assetCase === "missing" ? "" : "resource:picture-" + name, updatedAt: timestamp,
    }));
    detail.shotReferences = detail.assets.filter((asset) => assetCase !== "unbound" || asset.category === "environment").map((asset) => ({
        id: "reference-" + asset.id, shotId: shots[0]!.id, assetVersionId: asset.primaryVersionId!, role: "reference", status: "linked", createdAt: timestamp,
    }));
    detail.shotRevisions = [{
        id: "asset-case-revision", shotId: shots[0]!.id, videoPrompt: "镜头1：固定机位。起幅：纪星站在训练区。→ 落幅：纪星收起护具。\n【场景与道具参考】\n基地训练区：@[asset:fixture-scene]\n训练护具：@[asset:fixture-prop]", plotDescription: "训练结束，收好护具。", durationMs: 30000, actionBeatsJson: "[]",
    }] as ProjectDetail["shotRevisions"];
    if (new URLSearchParams(location.search).get("layout") === "long") {
        const revision = detail.shotRevisions[0]!;
        revision.videoPrompt = Array.from({ length: 12 }, (_, index) => `镜头${index + 1}：缓慢跟拍。起幅：纪星走入基地训练区，目光落在训练护具上。→ 落幅：纪星停下脚步，收起护具并回望门口，保留自然呼吸和表情变化。`).join("\n\n");
        revision.action = "纪星整理护具，抬头观察训练场，听到脚步声后转身确认。\n手掌松开，肩膀放松，眼神从警觉转为平静。".repeat(5);
        revision.dialogue = "纪星：今天的训练结束了。\n同伴：把护具放好，明天继续。\n纪星：知道了，我稍后就来。".repeat(4);
    }
}

function Harness() {
    const [shotId, setShotId] = useState(shots[0]!.id);
    const [activeStage, setActiveStage] = useState<"video" | "storyboard">("video");
    const [savedTasks, setSavedTasks] = useState(assetCase ? [] : tasks);
    return <>
        <nav>{shots.map((shot) => <button key={shot.id} onClick={() => setShotId(shot.id)}>{shot.id}</button>)}
            <button onClick={() => setActiveStage(activeStage === "video" ? "storyboard" : "video")}>切换产物类型</button>
            <button onClick={() => setSavedTasks((current) => current.map((task) => ({ ...task, status: "succeeded" })))}>模拟任务完成</button>
        </nav>
        <WorkflowProductionWorkbench activeStage={activeStage} detail={{ ...detail, tasks: savedTasks }} projectId={projectId} unitId={unitId}
            selectedShot={shots.find((shot) => shot.id === shotId)} onSelectShot={setShotId} onRefresh={async () => {}} onAddShot={() => {}} addingShot={false} />
    </>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter><Harness /></MemoryRouter></App></ConfigProvider>
</QueryClientProvider>);
