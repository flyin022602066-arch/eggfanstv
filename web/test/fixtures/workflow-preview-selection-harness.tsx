import { useEffect, useState } from "react";
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
import { ProjectPropMergeModal } from "@/pages/projects/detail/project-prop-merge-modal";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";

setActiveUserScope("preview-selection-offline-regression");
useUserStore.setState({ hydrated: true, storageMode: "local", user: null });
const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);
const timestamp = "2026-11-01T00:00:00Z";
const assetCase = new URLSearchParams(location.search).get("assetCase");
const removalCase = assetCase === "removal";
const propMergeCase = assetCase === "prop-merge";
const promptCase = new URLSearchParams(location.search).has("promptCase");
const submissionCase = removalCase || propMergeCase || promptCase;
        if (submissionCase) {
    const model = "按条seedance-2.5-720P 只支持参考图";
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [createModelChannel({ id: "nono", name: "离线测试", interfaceType: "nono-video", baseUrl: "https://fixture.invalid", apiKey: "synthetic-test-key", models: [model], modelProfiles: [{ model, capability: "video", protocol: "nono-video" }] })], model: `nono::${model}`, videoModel: `nono::${model}`, videoSeconds: "30", size: "16:9", vquality: "720p" } }).config;
    useConfigStore.setState({ config });
}
const videoCase = new URLSearchParams(location.search).get("videoCase");
const queryCase = new URLSearchParams(location.search).has("queryCase");
const ratioCase = new URLSearchParams(location.search).has("ratioCase");
const cameraCase = new URLSearchParams(location.search).has("cameraCase");
if (ratioCase) {
    await useConfigStore.persist.rehydrate();
    useConfigStore.getState().replaceConfig(normalizeConfigSnapshot({ config: { ...useConfigStore.getState().config, videoModel: "hanbao::seedance_v2.0" } }).config);
}
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

if (videoCase) {
    detail.shotArtifacts = artifacts.map((artifact) => ({ ...artifact, resourceId: artifact.shotId === "shot-b" ? "landscape-video" : "portrait-video" }));
    detail.project.aspectRatio = "9:16";
}

if (cameraCase) {
    detail.shotArtifacts = [];
    detail.shotRevisions = shots.slice(0, 3).map((shot, index) => {
        shot.currentRevisionId = "camera-revision-" + index;
        return {
            id: shot.currentRevisionId, shotId: shot.id, version: 1, plotDescription: "离线镜头语言回归", action: "", dialogue: "",
            shotSize: index === 0 ? "大特写" : "", cameraAngle: index === 0 ? "过肩" : "", cameraMovement: index === 0 ? "跟拍" : "",
            durationMs: 30000, imagePrompt: "", videoPrompt: index === 1 ? "整体设定：屋内。\n镜头1：平视中景，缓慢推进。\n起幅：角色递信。\n镜头2：俯拍手部特写，固定机位。\n过程：角色接信。" : "角色递信，保持动作接续。",
            negativePrompt: "", continuityNotes: "", actionBeatsJson: "[]", createdAt: timestamp,
        };
    });
}

if (queryCase) {
    detail.shotArtifacts = [];
    for (const task of tasks) {
        task.status = "failed";
        task.error = "提交结果未确认";
        if (task.id.startsWith("shot-a-")) task.providerRequestId = "";
    }
}

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
    if (submissionCase) {
        detail.assets.push({ ...detail.assets[1]!, id: "duplicate-prop", title: "备用护具", primaryVersionId: "version-duplicate", storageKey: "resource:picture-duplicate" });
        detail.shotRevisions[0]!.videoPrompt += "\n备用护具：@[asset:duplicate-prop]";
        detail.shotRevisions[0]!.plotDescription += "备用护具放在训练区门口。";
        detail.shotRevisions[0]!.actionBeatsJson = JSON.stringify([{ type: "asset_context", sceneAssetId: "fixture-scene", propNames: ["训练护具", "备用护具"] }]);
        if (propMergeCase) detail.shotReferences.push({ id: "reference-duplicate", shotId: shots[0]!.id, assetVersionId: "version-duplicate", role: "reference", status: "linked", createdAt: timestamp });
    }
    if (new URLSearchParams(location.search).get("layout") === "long") {
        const revision = detail.shotRevisions[0]!;
        revision.videoPrompt = Array.from({ length: 12 }, (_, index) => `镜头${index + 1}：缓慢跟拍。起幅：纪星走入基地训练区，目光落在训练护具上。→ 落幅：纪星停下脚步，收起护具并回望门口，保留自然呼吸和表情变化。`).join("\n\n");
        revision.action = "纪星整理护具，抬头观察训练场，听到脚步声后转身确认。\n手掌松开，肩膀放松，眼神从警觉转为平静。".repeat(5);
        revision.dialogue = "纪星：今天的训练结束了。\n同伴：把护具放好，明天继续。\n纪星：知道了，我稍后就来。".repeat(4);
    }
}

function Harness() {
    const [mergeOpen, setMergeOpen] = useState(false);
    const [shotId, setShotId] = useState(shots[0]!.id);
    const [activeStage, setActiveStage] = useState<"video" | "storyboard">("video");
    const [savedTasks, setSavedTasks] = useState(assetCase ? [] : tasks);
    const [savedArtifacts, setSavedArtifacts] = useState(detail.shotArtifacts);
    const [savedDetail, setSavedDetail] = useState(detail);
    const refresh = async () => {
        if (!queryCase && !submissionCase) return;
        const response = await fetch(`/api/projects/${projectId}/units/${unitId}/workspace`);
        if (!response.ok) throw new Error("workspace refresh failed");
        const { data } = await response.json();
        setSavedTasks(data.tasks);
        setSavedArtifacts(data.shotArtifacts);
        if (submissionCase) setSavedDetail({ ...detail, ...data });
    };
    useEffect(() => { if (submissionCase) void refresh(); }, []);
    return <>
        <nav>{shots.map((shot) => <button key={shot.id} onClick={() => setShotId(shot.id)}>{shot.id}</button>)}
            <button onClick={() => setActiveStage(activeStage === "video" ? "storyboard" : "video")}>切换产物类型</button>
            <button onClick={() => setSavedTasks((current) => current.map((task) => ({ ...task, status: "succeeded" })))}>模拟任务完成</button>
        </nav>
        {propMergeCase ? <button onClick={() => setMergeOpen(true)}>合并重复道具</button> : null}
        {mergeOpen ? <ProjectPropMergeModal projectId={projectId} source={detail.assets.find((asset) => asset.id === "duplicate-prop")!} onClose={() => setMergeOpen(false)} onSaved={() => void refresh()} /> : null}
        <WorkflowProductionWorkbench activeStage={activeStage} detail={{ ...savedDetail, tasks: savedTasks, shotArtifacts: savedArtifacts }} projectId={projectId} unitId={unitId}
            workflowStep={submissionCase ? { id: "fixture-video-step", stepKey: "video", status: "ready" } as never : undefined}
            selectedShot={savedDetail.shots.find((shot) => shot.id === shotId)} onSelectShot={setShotId} onRefresh={refresh} onAddShot={() => {}} addingShot={false} />
    </>;
}

function RatioHarness() {
    const [currentProjectId, setCurrentProjectId] = useState(projectId);
    const [currentUnitId, setCurrentUnitId] = useState(unitId);
    const [shotId, setShotId] = useState(shots[0]!.id);
    const [activeStage, setActiveStage] = useState<"video" | "storyboard">("video");
    const currentShots = shots.map((shot) => ({ ...shot, projectId: currentProjectId, unitId: currentUnitId, durationMs: 11000 }));
    const currentDetail = { ...detail, project: { ...detail.project, id: currentProjectId, aspectRatio: "9:16" }, shots: currentShots, shotArtifacts: [], tasks: [] };
    return <>
        <nav>
            <button onClick={() => setShotId("shot-b")}>下个镜头</button>
            <button onClick={() => setCurrentUnitId("next-chapter")}>下一章</button>
            <button onClick={() => setCurrentProjectId(currentProjectId === projectId ? "other-project" : projectId)}>切换项目</button>
            <button onClick={() => setActiveStage(activeStage === "video" ? "storyboard" : "video")}>切换产物类型</button>
        </nav>
        <WorkflowProductionWorkbench key={`${currentProjectId}:${currentUnitId}`} activeStage={activeStage} detail={currentDetail} projectId={currentProjectId} unitId={currentUnitId}
            selectedShot={currentShots.find((shot) => shot.id === shotId)} onSelectShot={setShotId} onRefresh={async () => {}} onAddShot={() => {}} addingShot={false} />
    </>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter>{ratioCase ? <RatioHarness /> : <Harness />}</MemoryRouter></App></ConfigProvider>
</QueryClientProvider>);
