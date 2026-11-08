import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider, Input } from "antd";
import { MemoryRouter } from "react-router";
import { getAntThemeConfig } from "@/lib/app-theme";
import { setActiveUserScope } from "@/lib/user-scope";
import { StudioMvLayout } from "@/pages/music/studio-mv-layout";
import { StudioMusicVideo } from "@/pages/music/studio-music-video";
import { addSunoStudioJob, flushSunoStudioPersistence, useSunoStudioStore } from "@/stores/use-suno-studio-store";
import { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } from "@/stores/use-config-store";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";

const parameters = new URLSearchParams(location.search);
const dark = parameters.get("theme") !== "light";
const scope = parameters.get("scope") || "mv-layout-offline-test";
setActiveUserScope(scope);
document.documentElement.classList.toggle("dark", dark);
let panelRenders = 0;

function Panels() {
    panelRenders += 1;
    return <>
        <div className="suno-studio-mv-reference">
            <div className="suno-studio-section-heading"><h3>统一视觉与资产</h3></div>
            <div className="suno-studio-mv-assets">{Array.from({ length: 12 }, (_, index) => <article className="suno-studio-mv-asset" key={index}>
                <div className="suno-studio-mv-asset-heading"><strong>角色与场景资产 {index + 1}</strong><span>角色</span><Button size="small">生成图片</Button></div>
                <p>歌曲叙事中的关键角色与视觉意象，保持造型统一。</p>
                <Input.TextArea aria-label={`资产 ${index + 1} 提示词`} defaultValue={"电影质感，清晨的街道与灯光，角色望向远方。".repeat(index % 3 + 2)} autoSize={{ minRows: 2, maxRows: 5 }} />
            </article>)}</div>
        </div>
        <div className="suno-studio-mv-reference">
            <div className="suno-studio-section-heading"><h3>30 秒分镜段落</h3></div>
            <div className="suno-studio-mv-segments">{Array.from({ length: 10 }, (_, index) => <article className="suno-studio-mv-segment" key={index}>
                <div className="suno-studio-mv-segment-heading"><strong>第 {index + 1} 段</strong><span>{index * 30}–{index * 30 + 30} 秒</span></div>
                <p>沿着旋律的情绪，逐步展开人物故事。</p>
                <Input.TextArea aria-label={`第 ${index + 1} 段提示词`} defaultValue={"镜头1：缓慢推进。起幅：清晨街道。→ 落幅：人物抬头望向光线。".repeat(3)} autoSize={{ minRows: 5, maxRows: 12 }} />
                <Button>生成本段 MV</Button>
            </article>)}</div>
        </div>
    </>;
}

function Harness() {
    const [activeScope, setScope] = useState(scope);
    const [mounted, setMounted] = useState(true);
    Object.assign(window, { mvFixture: { renders: () => panelRenders, setScope, setMounted } });
    return <section className="suno-studio-mv">
        <header className="suno-studio-mv-header"><h2>MV 制作</h2><span>30 秒分段</span></header>
        {mounted && <StudioMvLayout scope={activeScope}>
            <div className="suno-studio-mv-controls">
                <label className="suno-studio-label">视频模型与歌词</label>
                <Input.TextArea aria-label="歌曲歌词" defaultValue="把日常写进歌里，让故事随着旋律慢慢展开。" autoSize={{ minRows: 3, maxRows: 8 }} />
                <Panels />
            </div>
            <div className="suno-studio-mv-output">
                <div className="suno-studio-section-heading"><h3>MV 预览与任务</h3><span className="suno-studio-count">0 个任务</span></div>
                <div className="suno-studio-empty"><h3>MV 结果会显示在这里</h3><span>分析歌词并提交分段视频任务</span></div>
            </div>
        </StudioMvLayout>}
    </section>;
}

const timestamp = "2026-10-31T00:00:00.000Z";
const lyrics = "把日常写进歌里，让故事随着旋律慢慢展开。";
const videoName = "seedance-2.5";
const capabilityConfig = defaultModelCapabilityConfig("towo-sd25-video", videoName);
const channel = createModelChannel({ id: "fixture-video", name: "离线视频模型", interfaceType: "towo-sd25-video", baseUrl: "https://example.invalid", apiKey: "fixture-only", models: [videoName], modelProfiles: [{ model: videoName, capability: "video", protocol: "towo-sd25-video", capabilityConfig: { ...capabilityConfig, video: { ...capabilityConfig.video!, watermark: { supported: true, default: false } } } }] });
const model = encodeChannelModel(channel.id, videoName);
const imageChannel = createModelChannel({ id: "fixture-image", name: "离线图片模型", interfaceType: "openai-image", baseUrl: "https://example.invalid", apiKey: "fixture-only", models: ["gpt-image-2"] });
const imageModel = encodeChannelModel(imageChannel.id, "gpt-image-2");
useConfigStore.setState({ config: { ...defaultConfig, channels: [channel, imageChannel], model, videoModel: model, imageModel, videoWatermark: "false", videoSd2FaceMask: "off" } });
await useSunoStudioStore.getState().hydrate(scope);
if (!useSunoStudioStore.getState().jobs.length) {
    await addSunoStudioJob(scope, { id: "fixture-job", channelId: "fixture-channel", baseUrl: "", operationId: "post-suno-submit-music", label: "测试歌曲", status: "succeeded", values: {}, createdAt: timestamp, updatedAt: timestamp, clips: [{ id: "fixture-clip", title: "清晨的歌", audioUrl: "/fixture.mp3", lyrics, duration: 180 }] });
    useSunoStudioStore.getState().setMusicVideoDraft({
        model, prompt: "", duration: "30", ratio: "16:9", resolution: "720p", audioStart: "0", lyrics, source: { jobId: "fixture-job", clipId: "fixture-clip" },
        plan: { songJobId: "fixture-job", songClipId: "fixture-clip", lyrics, createdAt: timestamp, visualStyle: "电影级真人实拍，晨光与城市街道，冷暖分离。",
            assets: Array.from({ length: 8 }, (_, index) => ({ id: `asset-${index}`, name: `MV 资产 ${index + 1}`, category: index % 2 ? "scene" : "character", description: "清晨的街道，带着故事走向远方。", imagePrompt: "电影质感，晨光，统一角色形象与空间关系。".repeat(3) })),
            segments: Array.from({ length: 6 }, (_, index) => ({ id: `segment-${index}`, index: index + 1, startSeconds: index * 30, durationSeconds: 30, lyricExcerpt: lyrics, visualSummary: "人物沿着晨光中的街道前行。", prompt: "镜头1：缓慢推进。起幅：街道远景。→ 落幅：人物近景。".repeat(5), assetIds: ["asset-0", "asset-1"] })),
        },
    });
}

Object.assign(window, { mvAssetFixture: { draft: () => useSunoStudioStore.getState().musicVideoDraft, patch: useSunoStudioStore.getState().setMusicVideoDraft, flush: flushSunoStudioPersistence } });
createRoot(document.getElementById("root")!).render(<ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter><div className="fixture-shell"><main className="suno-studio" data-view="mv">{parameters.has("real") ? <StudioMusicVideo onBack={() => {}} /> : <Harness />}</main></div></MemoryRouter></App></ConfigProvider>);
