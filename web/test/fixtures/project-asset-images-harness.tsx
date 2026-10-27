import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { getAntThemeConfig } from "@/lib/app-theme";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { setActiveUserScope } from "@/lib/user-scope";
import { configureApiRuntime } from "@/services/api/request";
import { createModelChannel, defaultConfig, encodeChannelModel, normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";
import { hydrateModelConfig, commitModelConfig } from "@/services/model-config-repository";
import { useUserStore } from "@/stores/use-user-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { CanvasNodeType } from "@/types/canvas";
import { getProjectUnitWorkspace, type ProjectDetail } from "@/services/api/projects";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { backendProviderConfig } from "@/services/api/generation-task";
import ProjectAssetsView from "@/pages/projects/detail/assets";
import WorkflowProductionWorkbench from "@/pages/projects/detail/workflow-production-workbench";
import ProjectChaptersView from "@/pages/projects/detail/chapters";
import ProjectWorkflowView from "@/pages/projects/detail/workflow";
import "@/styles/globals.css";
import "@/pages/projects/detail/workflow.css";

setActiveUserScope("project-images-offline-regression");
useUserStore.setState({ storageMode: "local", user: null });
useAssetStore.setState({ assets: [] });
configureApiRuntime("/api", "offline-desktop-test");
const channel = createModelChannel({ id: "fixture", name: "离线图片模型", baseUrl: "https://example.invalid", apiKey: "offline-key", interfaceType: "openai-image", models: ["gpt-image-2", "gpt-image-1"], modelProfiles: [{ model: "gpt-image-2", capability: "image", displayName: "角色道具测试模型" }, { model: "gpt-image-1", capability: "image", displayName: "场景专用测试模型" }] });
const imageModel = encodeChannelModel(channel.id, "gpt-image-2");
const videoChannel = createModelChannel({ id: "mints-fixture", name: "离线视频模型", baseUrl: "https://example.invalid", apiKey: "offline-key", interfaceType: "mints-seedance-video", models: ["doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-260128"], modelProfiles: ["doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-260128"].map(model => ({ model, capability: "video", protocol: "mints-seedance-video", capabilityConfig: { version: 1 } })) });
const videoModel = encodeChannelModel(videoChannel.id, videoChannel.models[0]);
const jiasuProfile = defaultModelCapabilityConfig("jiasu-video", "sd-2.0-mini-J1");
jiasuProfile.video!.generateAudio = { supported: false, default: false };
jiasuProfile.video!.resolutions = [];
jiasuProfile.video!.defaultResolution = "";
const jiasuChannel = createModelChannel({ id: "jiasu-fixture", name: "离线佳速模型", baseUrl: "https://example.invalid", apiKey: "offline-key", interfaceType: "jiasu-video", models: ["sd-2.0-mini-J1", "sd-2.5-j2-V", "dola-sd-2.5", "sd-2.5-J3-doubao"], modelProfiles: [{ model: "sd-2.0-mini-J1", capability: "video", protocol: "jiasu-video", capabilityConfig: jiasuProfile }, { model: "sd-2.5-J3-doubao", capability: "video", protocol: "jiasu-video", capabilityConfig: structuredClone(jiasuProfile) }, ...["sd-2.5-j2-V", "dola-sd-2.5"].map(model => ({ model, capability: "video" as const, protocol: "jiasu-video" as const, capabilityConfig: defaultModelCapabilityConfig("jiasu-video", model) }))] });
const jiasuJ2Fixture = new URLSearchParams(window.location.search).get("provider") === "jiasu-j2";
const jiasuJ3Fixture = new URLSearchParams(window.location.search).get("provider") === "jiasu-j3";
const jiasuFixture = jiasuJ2Fixture || jiasuJ3Fixture || new URLSearchParams(window.location.search).get("provider") === "jiasu";
const bindingFixture = new URLSearchParams(window.location.search).has("bindings");
const sceneBindingFixture = new URLSearchParams(window.location.search).has("scene-binding");
const overwriteFixture = new URLSearchParams(window.location.search).has("chapter-overwrite");
const textChannel = createModelChannel({ id: "text-fixture", name: "离线文本模型", baseUrl: "https://example.invalid", apiKey: "offline-key", interfaceType: "chat-completion", models: ["offline-text", "offline-text-second", "gpt-image-2", "suno-v4"], modelProfiles: [{ model: "offline-text", capability: "text" }, { model: "offline-text-second", capability: "text" }, { model: "gpt-image-2", capability: "image", protocol: "openai-image" }, { model: "suno-v4", capability: "audio", protocol: "suno-audio" }] });
const textModel = encodeChannelModel(textChannel.id, "offline-text");
const eggfansChannel = createModelChannel({ id: "eggfans-fixture", name: "离线 Eggfans 模型", baseUrl: "https://example.invalid", apiKey: "offline-key", interfaceType: "eggfans-seedance-video", models: ["seedance-2.5"], modelProfiles: [{ model: "seedance-2.5", capability: "video", protocol: "eggfans-seedance-video" }] });
const fixtureVideoModel = jiasuFixture ? encodeChannelModel(jiasuChannel.id, jiasuJ3Fixture ? "sd-2.5-J3-doubao" : jiasuJ2Fixture ? "sd-2.5-j2-V" : "sd-2.0-mini-J1") : bindingFixture ? encodeChannelModel(eggfansChannel.id, "seedance-2.5") : videoModel;
useConfigStore.setState({ config: { ...defaultConfig, channels: [channel, videoChannel, jiasuChannel, eggfansChannel, textChannel], textModel, imageModel, videoModel: fixtureVideoModel, videoGenerateAudio: "true", videoEggfansReferenceMode: "uri", videoJiasuFaceMode: "off", videoJiasuFaceMask: "off", model: imageModel } });
void hydrateModelConfig().then(({ config }) => {
    if (config?.channels?.length) useConfigStore.getState().replaceConfig(normalizeConfigSnapshot({ config }).config);
    useConfigStore.subscribe((state) => { void commitModelConfig(state.config); });
});
const now = "2026-10-19T08:00:00Z";
const scene = { id: "scene", title: "古城场景", mediaType: "text", category: "environment", status: "confirmed", primaryVersionId: "scene-v1", versionCount: 1, usages: [], updatedAt: now, previewText: "石桥与城墙", definitionJson: '{"description":"石桥与城墙"}' };
const prop = { ...scene, id: "prop", title: "青铜宝剑", category: "prop", primaryVersionId: "prop-v1" };
const character = { ...scene, id: "character", title: "角色甲", category: "character", mediaType: "entity", primaryVersionId: "char-v1", character: { versionId: "char-v1", version: 1, definition: { appearance: "黑发青年" }, visualStatus: "missing", voiceStatus: "missing", representations: [] } };
const readyCharacter = { ...character, id: "character-ready", title: "角色原图甲", primaryVersionId: "char-ready-v1", character: { ...character.character, versionId: "char-ready-v1", visualStatus: "ready", representations: [{ role: "turnaround_sheet", resourceId: "character-original" }] } };
const portraitCharacter = { ...readyCharacter, id: "character-portrait", title: "角色原图乙", primaryVersionId: "char-portrait-v1", character: { ...readyCharacter.character, versionId: "char-portrait-v1", representations: [{ role: "turnaround_sheet", resourceId: "character-portrait" }] } };
const image = { ...scene, id: "image", title: "已有资产图", mediaType: "image", storageKey: "resource:asset-image" };
const detail = {
    project: { id: new URLSearchParams(window.location.search).get("project") || "fixture-project", name: "离线项目生图测试", status: "active", aspectRatio: "16:9", defaultImageModel: imageModel, defaultVideoModel: fixtureVideoModel },
    units: [{ id: "unit", title: "第一章", position: 0 }], assets: [scene, prop, character, image, readyCharacter, portraitCharacter], canvases: [], workflows: [],
    shots: [{ id: "shot", unitId: "unit", title: "镜头01", position: 0, durationMs: 5000, currentRevisionId: "revision" }],
    shotRevisions: [{ id: "revision", shotId: "shot", plotDescription: "古城远景", imagePrompt: "古城远景", durationMs: 5000 }],
    shotArtifacts: [{ id: "artifact", shotId: "shot", type: "storyboard", resourceId: "shot-image", version: 1, selected: true, status: "ready", createdAt: now }],
    shotReferences: [{ id: "reference", shotId: "shot", assetVersionId: "scene-v1", status: "linked", role: "reference", asset: image }], tasks: [],
} as unknown as ProjectDetail;
const videoDetail = { ...detail, ...(bindingFixture ? { assets: [], shotReferences: [] } : {}), shotRevisions: detail.shotRevisions.map(revision => ({ ...revision, ...(bindingFixture ? { plotDescription: "角色原图甲在古城场景挥手", imagePrompt: "角色原图甲在古城场景挥手" } : {}), videoPrompt: bindingFixture ? "角色原图甲在古城场景挥手，听到鸟鸣" : "古城远景，风吹树叶，听到鸟鸣" })), shotArtifacts: jiasuFixture ? [{ id: "old-video", shotId: "shot", type: "video", version: 1, selected: true, status: "ready", createdAt: now }] as ProjectDetail["shotArtifacts"] : detail.shotArtifacts };
const bindingAssets = [readyCharacter, { ...scene, mediaType: "image", storageKey: "resource:scene-original" }];
if (jiasuJ3Fixture) {
    videoDetail.shots = videoDetail.shots.map(shot => ({ ...shot, durationMs: 30000 }));
    videoDetail.shotRevisions = videoDetail.shotRevisions.map(revision => ({ ...revision, durationMs: 30000 }));
}
if (sceneBindingFixture) {
    bindingAssets.push({ ...prop, mediaType: "image", storageKey: "resource:prop-original" }, { ...scene, id: "garden", title: "庭院", primaryVersionId: "garden-v1", mediaType: "image", storageKey: "resource:garden-original" });
    videoDetail.assets = bindingAssets as ProjectDetail["assets"];
    videoDetail.shots = Array.from({ length: 3 }, (_, index) => ({ ...detail.shots[0]!, id: index ? `shot-${index + 1}` : "shot", position: index, title: `镜头0${index + 1}`, currentRevisionId: `revision-${index + 1}`, durationMs: 30000 }));
    videoDetail.shotRevisions = videoDetail.shots.map((shot, index) => ({ ...detail.shotRevisions[0]!, id: shot.currentRevisionId!, shotId: shot.id, version: 1, durationMs: 30000, plotDescription: index === 0 ? "角色原图甲在古城场景拔出青铜宝剑" : index === 1 ? "角色原图甲抬头，仍在原处" : "转场：庭院空镜", imagePrompt: index === 1 ? "青年抬头" : "", videoPrompt: "0–10s 抬头；10–20s 环顾；20–30s 停顿", dialogue: index === 1 ? "画外音：带上青铜宝剑" : "", actionBeatsJson: JSON.stringify([{ type: "asset_context", ...(index === 2 ? { sceneAssetId: "garden", sceneName: "庭院", sceneChange: true } : {}), ...(index === 1 ? { propNames: [] } : {}) }]) }));
    videoDetail.shotReferences = [{ id: "scene-pin", shotId: "shot", assetVersionId: "scene-v1", role: "reference", status: "linked", asset: bindingAssets[1] }, { id: "character-pin", shotId: "shot-2", assetVersionId: "char-ready-old", role: "reference", status: "linked", asset: readyCharacter }] as ProjectDetail["shotReferences"];
}
const chapterDetail = { ...detail, project: { ...detail.project, stylePresetId: "urban-live-action" }, units: [{ ...detail.units[0]!, sourceText: "角色原图甲在古城场景拔出青铜宝剑，随后抬头。片刻后转到庭院。", sourceFormat: "text", updatedAt: now, wordCount: 40 }], assets: bindingAssets, shots: [], shotRevisions: [], shotReferences: [], shotArtifacts: [], assetCandidates: [] } as unknown as ProjectDetail;
if (new URLSearchParams(window.location.search).has("asset-episodes")) {
    detail.units = [{ ...detail.units[0]!, title: "古城初遇", sourceText: "角色甲来到古城。", updatedAt: now }, { ...detail.units[0]!, id: "unit-2", title: "庭院重逢", position: 1, sourceText: "角色甲回到庭院。", updatedAt: now }];
    detail.assets = [
        ...detail.assets.map(asset => ({ ...asset, unitIds: asset.id === "image" ? [] : asset.id === "character-ready" ? ["unit", "unit-2"] : ["unit"] })),
        { ...scene, id: "scene-2", title: "重逢庭院", unitIds: ["unit-2"] },
        { ...prop, id: "prop-2", title: "青玉发簪", unitIds: ["unit-2"] },
    ];
    chapterDetail.units = detail.units;
}
if (overwriteFixture) {
    chapterDetail.assets = [scene, ...Array.from({ length: 6 }, (_, index) => ({ ...prop, id: `prop-${index}`, title: `道具${index}`, primaryVersionId: `prop-${index}-v1` }))] as ProjectDetail["assets"];
    chapterDetail.shots = Array.from({ length: 13 }, (_, index) => ({ ...detail.shots[0]!, id: `old-shot-${index}`, position: index, durationMs: 5000, updatedAt: now }));
}
Object.assign(window, { setWorkflowVideoModel: (model: string) => useConfigStore.getState().updateConfig("projectWorkflowModels", { [detail.project.id]: { video: model } }) });
Object.assign(window, { projectImageFixture: { assets: detail.assets, videoDetail, chapterDetail, bindingAssets, model: imageModel, sceneModel: encodeChannelModel(channel.id, "gpt-image-1"), readConfig: () => useConfigStore.getState().config, canvasVideoRequest: (model: string, seconds: string, size: string, vquality: string) => {
    const config = useConfigStore.getState().config;
    const node = { id: "fixture-video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { model, seconds, size, vquality } };
    return backendProviderConfig(buildGenerationConfig({ ...config, videoModel: model, videoSeconds: seconds, size, vquality }, node, "video"), "video");
}, setDefaultTextModel: (model: string) => useConfigStore.getState().updateConfig("textModel", model), setDefaultVideoModel: (model: string) => useConfigStore.getState().updateConfig("videoModel", model), removeChannel: (id: string) => useConfigStore.getState().updateConfig("channels", useConfigStore.getState().config.channels.filter(channel => channel.id !== id)), seedStalePersonalImage: () => useAssetStore.setState({ assets: [{ id: "scene", kind: "image", title: "旧资产图缓存", coverUrl: "", tags: [], category: "environment", status: "confirmed", createdAt: now, updatedAt: now, data: { dataUrl: "/api/resources/stale-image/file", storageKey: "resource:stale-image", mimeType: "image/png", width: 640, height: 360, bytes: 100 } }] }) } });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Harness() {
    const [view, setView] = useState("assets");
    const dark = useThemeStore((state) => state.theme) === "dark";
    const setDark = (value: boolean) => useThemeStore.getState().setTheme(value ? "dark" : "light");
    const [currentVideoDetail, setCurrentVideoDetail] = useState(videoDetail);
    const [selectedShotId, setSelectedShotId] = useState(sceneBindingFixture ? "shot-2" : "shot");
    const chapterWorkspace = useQuery({ queryKey: ["project", detail.project.id, "chapter-overwrite"], queryFn: () => getProjectUnitWorkspace(detail.project.id, "unit"), enabled: overwriteFixture });
    const currentChapterDetail = overwriteFixture && chapterWorkspace.data ? { ...chapterDetail, ...chapterWorkspace.data } : chapterDetail;
    const storyboardDetail = overwriteFixture ? currentChapterDetail : detail;
    Object.assign(window.projectImageFixture, { currentChapterDetail });
    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["project", detail.project.id] });
        if (bindingFixture) {
            const workspace = await getProjectUnitWorkspace(detail.project.id, "unit");
            setCurrentVideoDetail((current) => ({ ...current, ...workspace }));
        }
    };
    Object.assign(window.projectImageFixture, { refreshVideoWorkspace: refresh });
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter><nav className="flex gap-4 p-4"><button onClick={() => setView("assets")}>测试资产页</button><button onClick={() => setView("chapters")}>测试章节页</button><button onClick={() => setView("workflow")}>测试分镜页</button><button onClick={() => setView("video")}>测试视频页</button><button onClick={() => { document.documentElement.classList.toggle("dark", !dark); setDark(!dark); }}>切换主题</button></nav><WorkflowRouteRegression detail={currentChapterDetail}>{view === "assets" ? <ProjectAssetsView detail={detail} refreshProject={refresh} onCreateCanvas={() => undefined} /> : view === "chapters" ? <ProjectChaptersView detail={currentChapterDetail} refreshProject={refresh} onCreateCanvas={() => undefined} /> : <WorkflowProductionWorkbench key={view} activeStage={view === "video" ? "video" : "storyboard"} detail={view === "video" ? currentVideoDetail : storyboardDetail} projectId={detail.project.id} unitId="unit" workflowStep={{ id: "fixture-step", stepKey: view === "video" ? "video" : "storyboard", status: jiasuFixture ? "failed" : "pending" } as never} selectedShot={view === "video" ? currentVideoDetail.shots.find(shot => shot.id === selectedShotId) : storyboardDetail.shots[0]} onSelectShot={setSelectedShotId} onRefresh={refresh} onAddShot={() => undefined} addingShot={false} />}</WorkflowRouteRegression></MemoryRouter></App></ConfigProvider>;
}
function WorkflowRouteRegression({ detail: currentDetail, children }: { detail: ProjectDetail; children: ReactNode }) {
    const location = useLocation();
    const stage = location.pathname.match(/\/workflow\/unit\/([^/]+)$/)?.[1];
    return new URLSearchParams(window.location.search).has("workflow-regression") && stage
        ? <><output aria-label="工作流路由">{location.pathname}</output><ProjectWorkflowView detail={currentDetail} projectId={currentDetail.project.id} unitId="unit" stage={stage} /></>
        : children;
}
document.documentElement.classList.add("dark");
useThemeStore.getState().setTheme("dark");
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
