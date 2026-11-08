import { Alert, Button, Input, Select, Tooltip } from "antd";
import { ArrowLeft, Check, Clapperboard, ImagePlus, LoaderCircle, RefreshCw, Upload, UserRound, Video, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { CharacterFacePresetFields } from "@/components/assets/character-face-preset-fields";
import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { Switch } from "@/components/ui/base/switch";
import { JiasuVideoReferenceSettings, TowoVideoReferenceSettings } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { hasAutomaticVideoAudio, modelCapabilityConfigFor, normalizeVideoValue, videoDurationOptions } from "@/lib/model-capabilities";
import { formatVideoResolutionLabel } from "@/lib/video-generation-options";
import { workflowVideoGenerationConfig } from "@/lib/workflow-video-generation";
import { characterFacePresetForAsset, characterFaceRoleLabels, parseCharacterFacePresets, type CharacterFacePreset, type CharacterFacePresets, type CharacterFaceRole } from "@/lib/project-character-face-presets";
import { assertUserScope, captureUserScope, isUserScopeAbandonedError } from "@/lib/user-scope-guard";
import { uploadCharacterFaceReference } from "@/services/project-character-face-presets";
import { readImageMeta } from "@/lib/image-utils";
import { getActiveUserScope } from "@/lib/user-scope";
import { musicVideoAudioSegmentSeconds, musicVideoEffectiveDuration, musicVideoMinimumImages } from "@/lib/suno-music-video";
import { rebindSunoMusicVideoFacePresets, updateSunoMusicVideoAssetPrompt, updateSunoMusicVideoFacePresets, updateSunoMusicVideoVisualStyle, type SunoMusicVideoAsset, type SunoMusicVideoPlan, type SunoMusicVideoSegment } from "@/lib/suno-music-video-plan";
import { resolveSunoMusicVideoImageConfig, type SunoMusicVideoImageSettings } from "@/lib/suno-music-video-generation";
import { useStudioMedia } from "./use-studio-media";
import { compatibleMusicVideoModels } from "./studio-mv-helpers";
import { StudioMvLayout } from "./studio-mv-layout";
import { useMvAssetGeneration } from "./use-mv-asset-generation";
import { studioLibraryTracks } from "./studio-helpers";
import { analyzeSunoMusicVideoLyrics, refreshSunoMusicVideo, submitSunoMusicVideo } from "@/services/suno-music-video";
import { configuredModelMatchesCapability, modelOptionLabel, resolveModelRequestConfig, useConfigStore } from "@/stores/use-config-store";
import { useSunoStudioStore, type SunoMusicVideoTask } from "@/stores/use-suno-studio-store";
import type { ReferenceImage } from "@/types/image";

type Props = { onBack: () => void };
type ReferenceFile = { id: string; file: File; previewUrl: string };

const statusLabels: Record<SunoMusicVideoTask["status"], string> = {
    submitting: "提交中",
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    unknown: "提交待核对",
};

const categoryLabels = { character: "角色", scene: "场景", prop: "道具" } as const;

export function StudioMusicVideo({ onBack }: Props) {
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const theme = canvasThemes[useActiveTheme()];
    const configReady = useConfigStore((state) => state.isAiConfigReady);
    const jobs = useSunoStudioStore((state) => state.jobs);
    const tasks = useSunoStudioStore((state) => state.musicVideos);
    const draft = useSunoStudioStore((state) => state.musicVideoDraft);
    const setDraft = useSunoStudioStore((state) => state.setMusicVideoDraft);
    const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState("");
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    const [facePresetsOpen, setFacePresetsOpen] = useState(false);
    const [imageCategory, setImageCategory] = useState<SunoMusicVideoAsset["category"]>("character");
    const [uploadingFace, setUploadingFace] = useState<CharacterFaceRole | null>(null);
    const faceUploadBusyRef = useRef(false);
    const picker = useRef<HTMLInputElement>(null);
    const referenceFilesRef = useRef(referenceFiles);
    const scopeRef = useRef(getActiveUserScope());
    referenceFilesRef.current = referenceFiles;
    const scope = getActiveUserScope();

    const tracks = useMemo(() => studioLibraryTracks(jobs), [jobs]);
    const models = useMemo(() => compatibleMusicVideoModels(config), [config]);
    const model = models.includes(draft.model) ? draft.model : models.includes(config.videoModel) ? config.videoModel : models[0] || "";
    const selectedTrackKey = draft.source ? `${draft.source.jobId}:${draft.source.clipId}` : "";
    const selectedTrack = tracks.find(({ job, clip }) => `${job.id}:${clip.id}` === selectedTrackKey) || tracks[0];
    const profile = model ? modelCapabilityConfigFor(config, model).video : undefined;
    const durationOptions = profile ? videoDurationOptions(profile) : [];
    const canRenderThirtySeconds = durationOptions.includes(30);
    const duration = canRenderThirtySeconds ? 30 : durationOptions.includes(Number(draft.duration)) ? Number(draft.duration) : profile?.duration.default || durationOptions[0] || 5;
    const normalizedVideo = profile ? normalizeVideoValue(profile, { seconds: String(duration), ratio: draft.ratio, resolution: draft.resolution }) : undefined;
    const ratio = normalizedVideo?.ratio || "16:9";
    const resolution = normalizedVideo?.resolution || "720p";
    const generationConfig = model && profile ? workflowVideoGenerationConfig(config, { model, seconds: String(duration), ratio, resolution }) : undefined;
    const automaticAudio = Boolean(generationConfig && hasAutomaticVideoAudio(resolveModelRequestConfig(generationConfig, model).interfaceType));
    const effectiveVideoSeconds = profile ? musicVideoEffectiveDuration(duration, profile) : duration || 5;
    const audioSegmentSeconds = profile ? musicVideoAudioSegmentSeconds(effectiveVideoSeconds, profile.references) : effectiveVideoSeconds;
    const minimumImages = profile ? musicVideoMinimumImages(profile) : 0;
    const currentTask = tasks.find((task) => task.id === selectedTaskId) || tasks[0];
    const video = useStudioMedia(currentTask?.storageKey, currentTask?.resultUrl);
    const ready = Boolean(model && profile && configReady({ ...config, model, videoModel: model }, model));
    const textModel = config.textModel || config.model;
    const textReady = Boolean(textModel && configReady({ ...config, model: textModel, textModel }, textModel));
    const lyrics = draft.lyrics ?? selectedTrack?.clip.lyrics ?? "";
    const plan = draft.plan && draft.plan.songJobId === selectedTrack?.job.id && draft.plan.songClipId === selectedTrack?.clip.id ? draft.plan : undefined;
    const planCurrent = Boolean(plan && plan.lyrics === lyrics.trim());
    const facePresets = draft.characterFacePresets || {};
    const controlsBusy = busy || uploadingFace !== null;
    const assetGeneration = useMvAssetGeneration(plan, scope);
    const imageConfigFor = (category: SunoMusicVideoAsset["category"]) => resolveSunoMusicVideoImageConfig(config, category, draft.assetImagePresets?.[category], ratio);
    const imageReadyFor = (category: SunoMusicVideoAsset["category"]) => {
        const selection = imageConfigFor(category);
        return configuredModelMatchesCapability(selection, selection.model, "image") && configReady(selection, selection.model);
    };
    const imageReady = Boolean(plan?.assets.every((asset) => imageReadyFor(asset.category)));
    const imageConfig = imageConfigFor(imageCategory);
    const unboundFaces = Object.values(facePresets).some((preset) => preset && !preset.assetIds.length);

    const changeImageSettings = (patch: SunoMusicVideoImageSettings) => {
        const current = useSunoStudioStore.getState().musicVideoDraft.assetImagePresets || {};
        const next = resolveSunoMusicVideoImageConfig(config, imageCategory, { ...current[imageCategory], ...patch }, ratio);
        setDraft({ assetImagePresets: { ...current, [imageCategory]: { model: next.model, size: next.size, quality: next.quality, transparentBackground: next.transparentBackground, imageThinkingLevel: next.imageThinkingLevel } } });
    };

    useEffect(() => {
        if (model !== draft.model) setDraft({ model });
    }, [model, draft.model, setDraft]);
    useEffect(() => {
        const nextSource = selectedTrack ? { jobId: selectedTrack.job.id, clipId: selectedTrack.clip.id } : undefined;
        if (nextSource?.jobId !== draft.source?.jobId || nextSource?.clipId !== draft.source?.clipId) {
            setDraft({ source: nextSource, lyrics: selectedTrack?.clip.lyrics || "", plan: undefined, prompt: "", audioStart: "0", characterFacePresets: unbindFacePresets(draft.characterFacePresets) });
        }
    }, [selectedTrack?.job.id, selectedTrack?.clip.id, draft.source?.jobId, draft.source?.clipId, setDraft]);
    useEffect(() => {
        const next = { duration: String(duration), ratio, resolution };
        if (next.duration !== draft.duration || next.ratio !== draft.ratio || next.resolution !== draft.resolution) setDraft(next);
    }, [duration, ratio, resolution, draft.duration, draft.ratio, draft.resolution, setDraft]);
    useEffect(() => () => referenceFilesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl)), []);
    useEffect(() => {
        if (scopeRef.current === scope) return;
        referenceFilesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
        scopeRef.current = scope;
        setReferenceFiles([]);
        setSelectedTaskId("");
        setError("");
        setFacePresetsOpen(false);
    }, [scope]);
    useEffect(() => {
        if (currentTask?.resultUrl) void video.load();
    }, [currentTask?.id, currentTask?.resultUrl, currentTask?.storageKey]);

    const updatePlan = (update: (current: SunoMusicVideoPlan) => SunoMusicVideoPlan) => {
        const current = useSunoStudioStore.getState().musicVideoDraft.plan;
        if (current) setDraft({ plan: update(current) });
    };

    const changeFacePreset = (role: CharacterFaceRole, value: CharacterFacePreset | undefined) => {
        const current = useSunoStudioStore.getState().musicVideoDraft;
        const previous = current.characterFacePresets || {};
        const next = { ...previous };
        if (value) next[role] = value;
        else delete next[role];
        parseCharacterFacePresets(JSON.stringify(next));
        setDraft({ characterFacePresets: next, ...(current.plan ? { plan: updateSunoMusicVideoFacePresets(current.plan, previous, next) } : {}) });
    };

    const bindAssetFace = (assetId: string, role: CharacterFaceRole | "") => {
        const current = useSunoStudioStore.getState().musicVideoDraft;
        const previous = current.characterFacePresets || {};
        const next: CharacterFacePresets = Object.fromEntries(Object.entries(previous).map(([key, preset]) => [key, { ...preset, assetIds: preset.assetIds.filter((id) => id !== assetId) }]));
        if (role && next[role]) next[role] = { ...next[role]!, assetIds: [...next[role]!.assetIds, assetId] };
        parseCharacterFacePresets(JSON.stringify(next));
        setDraft({ characterFacePresets: next, ...(current.plan ? { plan: updateSunoMusicVideoFacePresets(current.plan, previous, next) } : {}) });
    };

    const uploadFace = async (role: CharacterFaceRole, file: File) => {
        if (busy || faceUploadBusyRef.current) return;
        const expectedScope = captureUserScope();
        faceUploadBusyRef.current = true;
        setUploadingFace(role);
        setError("");
        try {
            const uploaded = await uploadCharacterFaceReference(file);
            assertUserScope(expectedScope);
            const current = useSunoStudioStore.getState().musicVideoDraft;
            changeFacePreset(role, { ...uploaded, assetIds: current.characterFacePresets?.[role]?.assetIds || [] });
        } catch (cause) {
            if (!isUserScopeAbandonedError(cause)) setError(cause instanceof Error ? cause.message : "人脸参考图上传失败");
        } finally { faceUploadBusyRef.current = false; setUploadingFace(null); }
    };

    const selectReferences = (files: FileList | null) => {
        if (!files || !profile) return;
        const max = profile.references.maxImages;
        const remaining = Math.max(0, max - referenceFiles.length);
        const next = Array.from(files)
            .filter((file) => file.type.startsWith("image/"))
            .slice(0, remaining)
            .map((file) => ({ id: nanoid(), file, previewUrl: URL.createObjectURL(file) }));
        setReferenceFiles((current) => [...current, ...next]);
        setError(files.length > remaining ? `当前模型最多参考 ${max} 张图片，超出部分未添加` : "");
    };

    const analyzeLyrics = async () => {
        if (controlsBusy || !selectedTrack || !profile || !textReady) return;
        setBusy(true);
        setProgress("大模型正在提取 MV 资产并拆解歌词");
        setError("");
        try {
            const next = await analyzeSunoMusicVideoLyrics({
                songJobId: selectedTrack.job.id,
                songClipId: selectedTrack.clip.id,
                songTitle: selectedTrack.clip.title || selectedTrack.job.label,
                songDuration: selectedTrack.clip.duration || 0,
                lyrics,
                model: textModel,
                maxImagesPerSegment: profile.references.maxImages,
            });
            setDraft({ lyrics: lyrics.trim(), plan: next, prompt: next.segments[0]?.prompt || "", characterFacePresets: rebindSunoMusicVideoFacePresets(useSunoStudioStore.getState().musicVideoDraft.characterFacePresets || {}, plan, next) });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "MV 歌词拆解失败");
        } finally {
            setBusy(false);
            setProgress("");
        }
    };

    const createSegmentReferences = async (segment: SunoMusicVideoSegment): Promise<ReferenceImage[]> => {
        if (!plan) return [];
        const assets = segment.assetIds.map((id) => plan.assets.find((asset) => asset.id === id)).filter((asset): asset is SunoMusicVideoAsset => Boolean(asset));
        const missing = assets.filter((asset) => !asset.reference?.storageKey && !asset.reference?.url);
        if (missing.length) throw new Error(`第 ${segment.index} 段缺少資產图片：${missing.map((asset) => asset.name).join("、")}`);
        const generated = assets.flatMap((asset) => (asset.reference ? [asset.reference] : []));
        const uploaded: ReferenceImage[] = await Promise.all(
            referenceFiles.map(async ({ id, file }) => {
                const dataUrl = await readFileDataUrl(file);
                const meta = await readImageMeta(dataUrl);
                return { id, name: file.name, type: file.type || "image/png", dataUrl, url: dataUrl, bytes: file.size, width: meta.width, height: meta.height };
            }),
        );
        const references = [...generated, ...uploaded];
        if (references.length < minimumImages) throw new Error(`第 ${segment.index} 段至少需要 ${minimumImages} 张参考图；请补充资产图或上传参考图`);
        if (references.length > (profile?.references.maxImages || 0)) throw new Error(`第 ${segment.index} 段共 ${references.length} 张参考图，超过模型上限 ${profile?.references.maxImages || 0} 张`);
        return references;
    };

    const generateSegment = async (segment: SunoMusicVideoSegment) => {
        if (controlsBusy || !selectedTrack || !profile || !ready || !planCurrent || !plan) return;
        if (!canRenderThirtySeconds) {
            setError("当前视频模型不支持 30 秒输出，请切换到支持 30 秒的视频模型");
            return;
        }
        if (!segment.prompt.trim()) {
            setError(`请先填写第 ${segment.index} 段的视频提示词`);
            return;
        }
        setBusy(true);
        setProgress(`正在提交第 ${segment.index}/${plan.segments.length} 段 MV`);
        setError("");
        try {
            const references = await createSegmentReferences(segment);
            const id = await submitSunoMusicVideo({
                songJobId: selectedTrack.job.id,
                songClipId: selectedTrack.clip.id,
                model,
                duration: 30,
                audioStart: segment.startSeconds,
                ratio,
                resolution,
                prompt: segment.prompt,
                references,
                segmentIndex: segment.index,
                segmentCount: plan.segments.length,
            });
            setSelectedTaskId(id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : `第 ${segment.index} 段提交失败`);
        } finally {
            setBusy(false);
            setProgress("");
        }
    };

    const generateAllSegments = async () => {
        if (controlsBusy || !plan || !planCurrent || !ready || !canRenderThirtySeconds) return;
        setBusy(true);
        setError("");
        try {
            for (const segment of plan.segments) {
                if (
                    tasks.some(
                        (task) =>
                            task.songJobId === plan.songJobId &&
                            task.songClipId === plan.songClipId &&
                            task.segmentIndex === segment.index &&
                            task.prompt === segment.prompt &&
                            task.model === model &&
                            ["submitting", "queued", "running", "succeeded", "unknown"].includes(task.status),
                    )
                )
                    continue;
                setProgress(`正在提交第 ${segment.index}/${plan.segments.length} 段 MV`);
                const references = await createSegmentReferences(segment);
                const id = await submitSunoMusicVideo({
                    songJobId: plan.songJobId,
                    songClipId: plan.songClipId,
                    model,
                    duration: 30,
                    audioStart: segment.startSeconds,
                    ratio,
                    resolution,
                    prompt: segment.prompt,
                    references,
                    segmentIndex: segment.index,
                    segmentCount: plan.segments.length,
                });
                setSelectedTaskId(id);
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "批量提交中断；已提交任务会继续查询，可再次提交未完成片段");
        } finally {
            setBusy(false);
            setProgress("");
        }
    };

    const chooseTrack = (key: string) => {
        const track = tracks.find(({ job, clip }) => `${job.id}:${clip.id}` === key);
        setDraft({ source: track ? { jobId: track.job.id, clipId: track.clip.id } : undefined, lyrics: track?.clip.lyrics || "", plan: undefined, prompt: "", audioStart: "0", characterFacePresets: unbindFacePresets(facePresets) });
    };

    const generatedAssetCount = plan?.assets.filter((asset) => asset.reference?.storageKey || asset.reference?.url).length || 0;
    const submittedSegmentCount =
        plan?.segments.filter((segment) =>
            tasks.some(
                (task) =>
                    task.songJobId === plan.songJobId &&
                    task.songClipId === plan.songClipId &&
                    task.segmentIndex === segment.index &&
                    task.prompt === segment.prompt &&
                    task.model === model &&
                    ["submitting", "queued", "running", "succeeded", "unknown"].includes(task.status),
            ),
        ).length || 0;

    return (
        <section className="suno-studio-mv" aria-label="MV 制作">
            <header className="suno-studio-mv-header">
                <div className="suno-studio-section-heading">
                    <Clapperboard size={18} />
                    <h2>MV 制作</h2>
                    <span className="suno-studio-count">歌词拆解 · 30 秒分段</span>
                </div>
                <Button icon={<ArrowLeft size={15} />} onClick={onBack}>
                    返回音乐导演台
                </Button>
            </header>
            <StudioMvLayout scope={scope}>
                <div className="suno-studio-mv-controls">
                    <label className="suno-studio-label" htmlFor="suno-mv-song">
                        曲库歌曲
                    </label>
                    <Select
                        id="suno-mv-song"
                        aria-label="选择曲库歌曲"
                        value={selectedTrack ? `${selectedTrack.job.id}:${selectedTrack.clip.id}` : undefined}
                        placeholder="先生成或取回一首歌曲"
                        options={tracks.map(({ job, clip }) => ({ value: `${job.id}:${clip.id}`, label: `${clip.title || "未命名歌曲"} · ${job.label}` }))}
                        onChange={chooseTrack}
                        disabled={controlsBusy || !tracks.length}
                    />
                    {!tracks.length && (
                        <Alert
                            type="info"
                            showIcon
                            title={
                                <>
                                    曲库暂无可用歌曲。
                                    <Button type="link" size="small" onClick={onBack}>
                                        返回音乐创作
                                    </Button>
                                </>
                            }
                        />
                    )}

                    <label className="suno-studio-label" htmlFor="suno-mv-model">
                        视频模型
                    </label>
                    <Select
                        id="suno-mv-model"
                        aria-label="MV 视频模型"
                        value={model || undefined}
                        placeholder="选择支持音频和图片参考的视频模型"
                        options={models.map((item) => ({ value: item, label: modelOptionLabel(config, item) }))}
                        onChange={(value) => {
                            setReferenceFiles((current) => current.slice(0, modelCapabilityConfigFor(config, value).video?.references.maxImages || 0));
                            setDraft({ model: value, duration: "30", ratio: "", resolution: "" });
                        }}
                        disabled={controlsBusy || !models.length}
                    />
                    {!models.length && (
                        <Alert
                            type="warning"
                            showIcon
                            title={
                                <>
                                    当前没有可用于 MV 的视频模型。<Link to="/settings">前往模型配置</Link>
                                </>
                            }
                        />
                    )}
                    {model && profile && profile.references.maxImages < 1 && <Alert type="warning" showIcon title="所选模型不接收图片参考，无法使用资产绑定式 MV 流程" />}
                    {profile && (
                        <div className="suno-studio-mv-settings">
                            <div>
                                <label className="suno-studio-label">每段时长</label>
                                <Select
                                    aria-label="MV 单段时长"
                                    value={canRenderThirtySeconds ? 30 : duration}
                                    options={canRenderThirtySeconds ? [{ value: 30, label: "30 秒" }] : durationOptions.map((value) => ({ value, label: value === -1 ? "自动" : `${value} 秒` }))}
                                    disabled
                                />
                            </div>
                            <div>
                                <label className="suno-studio-label" htmlFor="suno-mv-ratio">
                                    画面比例
                                </label>
                                <Select id="suno-mv-ratio" aria-label="MV 画面比例" value={ratio} options={profile.ratios.map((value) => ({ value, label: value }))} onChange={(value) => setDraft({ ratio: value })} disabled={controlsBusy} />
                            </div>
                            <div>
                                <label className="suno-studio-label" htmlFor="suno-mv-resolution">
                                    分辨率
                                </label>
                                <Select id="suno-mv-resolution" aria-label="MV 分辨率" value={resolution} options={profile.resolutions.map((value) => ({ value, label: formatVideoResolutionLabel(value) }))} onChange={(value) => setDraft({ resolution: value })} disabled={controlsBusy} />
                            </div>
                        </div>
                    )}
                    {generationConfig && profile ? <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0" disabled={controlsBusy} aria-label="MV 视频渠道参数">
                        <div className="flex items-center justify-between gap-3"><span className="suno-studio-label">生成声音</span>{automaticAudio ? <span className="suno-studio-muted">同步声音已开启（渠道默认）</span> : <Switch aria-label="MV 生成声音" checked={generationConfig.videoGenerateAudio === "true"} disabled={controlsBusy || !profile.generateAudio.supported} onChange={(checked) => updateConfig("videoGenerateAudio", String(checked))} />}</div>
                        {profile.watermark.supported ? <div className="flex items-center justify-between gap-3"><span className="suno-studio-label">添加水印</span><Switch aria-label="MV 添加水印" checked={generationConfig.videoWatermark === "true"} disabled={controlsBusy} onChange={(checked) => updateConfig("videoWatermark", String(checked))} /></div> : null}
                        <JiasuVideoReferenceSettings config={generationConfig} theme={theme} onConfigChange={(key, value) => updateConfig(key, value)} />
                        <TowoVideoReferenceSettings config={generationConfig} theme={theme} onConfigChange={(key, value) => updateConfig(key, value)} />
                        <p className="suno-studio-muted">沿用项目镜头的全模态参考模式、声音和渠道人脸处理设置；参数按当前模型能力校验。</p>
                    </fieldset> : null}
                    {profile && <p className="suno-studio-muted">每段固定按 30 秒生成；模型音频参考上限为 {audioSegmentSeconds} 秒，系统按每段起点自动裁取。</p>}
                    {profile && !canRenderThirtySeconds && <Alert type="warning" showIcon title="当前模型不支持 30 秒视频输出，请切换到支持 30 秒的模型" />}

                    <div className="suno-studio-mv-audio-range">
                        <div className="suno-studio-section-heading">
                            <ImagePlus size={15} />
                            <h3>大模型拆解</h3>
                            <span>{textModel ? modelOptionLabel(config, textModel) : "未配置文本模型"}</span>
                        </div>
                        <label className="suno-studio-label" htmlFor="suno-mv-lyrics">
                            歌曲歌词
                        </label>
                        <Input.TextArea
                            id="suno-mv-lyrics"
                            aria-label="MV 歌词"
                            value={lyrics}
                            onChange={(event) => setDraft({ lyrics: event.target.value })}
                            placeholder="优先使用歌曲自带歌词，也可在这里补充或修正"
                            autoSize={{ minRows: 5, maxRows: 12 }}
                            disabled={controlsBusy}
                        />
                        <Button
                            type="primary"
                            icon={busy ? <LoaderCircle size={15} /> : <Clapperboard size={15} />}
                            loading={busy && progress.includes("拆解")}
                            disabled={controlsBusy || !selectedTrack || !lyrics.trim() || !textReady || !profile || profile.references.maxImages < 1}
                            onClick={() => void analyzeLyrics()}
                        >
                            {plan ? "重新分析歌词并拆解" : "分析歌词并拆解 MV"}
                        </Button>
                        {!textReady && (
                            <Alert
                                type="warning"
                                showIcon
                                title={
                                    <>
                                        请在模型配置中选择可用的文本模型。<Link to="/settings">前往模型配置</Link>
                                    </>
                                }
                            />
                        )}
                        {!lyrics.trim() && selectedTrack && <p className="suno-studio-muted">这首歌曲没有取回歌词，请粘贴歌词后再拆解。</p>}
                    </div>

                    <div className="suno-studio-mv-reference">
                        <div className="suno-studio-section-heading"><UserRound size={15} /><h3>主角人脸预设</h3><Button size="small" disabled={controlsBusy} onClick={() => setFacePresetsOpen(true)}>设置男女主角</Button></div>
                        <p className="suno-studio-muted">与项目角色资产共用人脸绑定和三视图规则。上传男主、女主参考图，绑定本 MV 对应角色；单张、批量生图自动保留面孔，服装与造型按 MV 设定设计。</p>
                        <p className="suno-studio-muted">男主：{facePresets.male ? `${facePresets.male.assetIds.length} 个绑定角色` : "未设置"} · 女主：{facePresets.female ? `${facePresets.female.assetIds.length} 个绑定角色` : "未设置"}</p>
                        {unboundFaces ? <Alert type="warning" showIcon title="人脸已上传，尚未绑定角色" description="请在下方角色卡片选择对应男主或女主人脸。绑定后会携带原参考图进行图片编辑；未绑定时不会提交角色生图。" /> : null}
                    </div>
                    {facePresetsOpen ? <AppModal open title="MV 主角人脸预设" width={820} onCancel={() => { if (!uploadingFace) setFacePresetsOpen(false); }} footer={<Button type="primary" disabled={uploadingFace !== null} onClick={() => setFacePresetsOpen(false)}>完成</Button>}>
                        <p className="mb-4 text-sm text-foreground/65">上传参考图后，请选择应用到的角色。修改即时保存；重新分析同一歌曲保留可唯一匹配的同名角色绑定，切换歌曲后需要重新绑定。</p>
                        <CharacterFacePresetFields presets={facePresets} characters={(plan?.assets || []).filter((asset) => asset.category === "character").map((asset) => ({ id: asset.id, title: asset.name }))} disabled={controlsBusy} uploading={uploadingFace} onChange={changeFacePreset} onUpload={(role, file) => void uploadFace(role, file)} />
                        {error ? <Alert className="mt-4" type="error" showIcon title={error} /> : null}
                    </AppModal> : null}
                    {plan && (
                        <>
                            {!planCurrent && <Alert type="warning" showIcon title="歌词已修改，请重新分析后再生成资产和视频" />}
                            <div className="suno-studio-mv-reference">
                                <div className="suno-studio-section-heading">
                                    <ImagePlus size={15} />
                                    <h3>统一视觉与资产</h3>
                                    <span>
                                        {generatedAssetCount}/{plan.assets.length}
                                    </span>
                                </div>
                                <label className="suno-studio-label" htmlFor="suno-mv-style">
                                    整体视觉风格
                                </label>
                                <Input.TextArea
                                    id="suno-mv-style"
                                    aria-label="MV 整体视觉风格"
                                    value={plan.visualStyle}
                                    onChange={(event) => updatePlan((current) => updateSunoMusicVideoVisualStyle(current, event.target.value))}
                                    autoSize={{ minRows: 2, maxRows: 5 }}
                                    disabled={controlsBusy || !planCurrent}
                                />
                                <details className="suno-studio-details" open>
                                    <summary>资产图片生成设置</summary>
                                    <p className="suno-studio-muted">角色、场景、道具分别记住设置；每次生成使用当前设置，单项任务互不阻塞。</p>
                                    <div className="flex flex-wrap gap-2" role="group" aria-label="MV 资产图片设置分类">
                                        {(Object.keys(categoryLabels) as SunoMusicVideoAsset["category"][]).map((category) => <Button key={category} aria-pressed={imageCategory === category} disabled={controlsBusy} onClick={() => setImageCategory(category)}>{categoryLabels[category]}</Button>)}
                                    </div>
                                    <div className="mt-3 space-y-3" inert={controlsBusy}>
                                        <label className="suno-studio-label">{categoryLabels[imageCategory]}图片模型</label>
                                        <ModelPicker config={config} value={imageConfig.model} capability="image" fullWidth onChange={(model) => changeImageSettings({ model })} />
                                        <ImageSettingsPanel config={imageConfig} theme={theme} showTitle={false} showCount={false} className="w-full space-y-3" onConfigChange={(key, value) => { if (key !== "count") changeImageSettings({ [key]: value }); }} />
                                    </div>
                                </details>
                                <div className="suno-studio-mv-assets">
                                    {plan.assets.map((asset) => (
                                        <article className="suno-studio-mv-asset" key={asset.id}>
                                            <div className="suno-studio-mv-asset-heading">
                                                <strong>{asset.name}</strong>
                                                <span>{categoryLabels[asset.category]}</span>
                                                {asset.reference && <Check size={14} aria-label="已生成" />}
                                                <Button size="small" icon={<ImagePlus size={14} />} loading={assetGeneration.pending(asset.id)} disabled={controlsBusy || assetGeneration.pending(asset.id) || !planCurrent || !imageReadyFor(asset.category)} onClick={() => void assetGeneration.generate(asset.id)}>
                                                    {asset.reference ? "重新生成" : "生成图片"}
                                                </Button>
                                            </div>
                                            <p>{asset.description}</p>
                                            <p className="suno-studio-muted">{modelOptionLabel(config, imageConfigFor(asset.category).model)} · {imageSizeLabel(imageConfigFor(asset.category).size)} · {imageQualityLabel(imageConfigFor(asset.category).quality)}</p>
                                            {asset.category === "character" ? <p className="suno-studio-muted">{(() => { const preset = characterFacePresetForAsset(JSON.stringify(facePresets), asset.id); return preset ? `已绑定${characterFaceRoleLabels[preset.role]}人脸 · 保留面孔，按 MV 设定设计造型` : "未绑定主角人脸 · 按角色设定生成三视图"; })()}</p> : null}
                                            {asset.category === "character" ? <Select<CharacterFaceRole | ""> aria-label={`${asset.name}人脸参考`} value={characterFacePresetForAsset(JSON.stringify(facePresets), asset.id)?.role || ""} disabled={controlsBusy || assetGeneration.pending(asset.id) || !planCurrent} options={[{ value: "", label: "按角色设定生成（不参考人脸）" }, ...(["male", "female"] as const).map((role) => ({ value: role, label: `${characterFaceRoleLabels[role]}人脸 · 图片编辑`, disabled: !facePresets[role] }))]} onChange={(role) => bindAssetFace(asset.id, role)} /> : null}
                                            <Input.TextArea
                                                aria-label={`${asset.name}资产生图提示词`}
                                                value={asset.imagePrompt}
                                                onChange={(event) => updatePlan((current) => updateSunoMusicVideoAssetPrompt(current, asset.id, event.target.value))}
                                                autoSize={{ minRows: 2, maxRows: 5 }}
                                                disabled={controlsBusy || assetGeneration.pending(asset.id) || !planCurrent}
                                            />
                                            {assetGeneration.error(asset.id) ? <Alert type="error" showIcon title={assetGeneration.error(asset.id)} /> : null}
                                            {asset.reference && (
                                                <div className="suno-studio-mv-asset-preview">
                                                    <CachedResourceImage storageKey={asset.reference.storageKey} src={asset.reference.url} alt={`${asset.name}参考图`} />
                                                </div>
                                            )}
                                        </article>
                                    ))}
                                </div>
                                <Button
                                    icon={<ImagePlus size={15} />}
                                    loading={assetGeneration.batchGenerating}
                                    disabled={controlsBusy || assetGeneration.batchGenerating || !planCurrent || !imageReady || generatedAssetCount === plan.assets.length}
                                    onClick={() => void assetGeneration.generateMissing()}
                                >
                                    {generatedAssetCount ? "继续补齐资产参考图" : "生成全部资产参考图"}
                                </Button>
                                {!imageReady && (
                                    <Alert
                                        type="warning"
                                        showIcon
                                        title={
                                            <>
                                                请在模型配置中选择可用的图片模型。<Link to="/settings">前往模型配置</Link>
                                            </>
                                        }
                                    />
                                )}
                            </div>

                            <div className="suno-studio-mv-reference">
                                <div className="suno-studio-section-heading">
                                    <Video size={15} />
                                    <h3>30 秒分镜段落</h3>
                                    <span>
                                        {submittedSegmentCount}/{plan.segments.length} 已提交
                                    </span>
                                </div>
                                <div className="suno-studio-mv-extra-reference">
                                    <div className="suno-studio-section-heading">
                                        <Upload size={15} />
                                        <h3>额外参考图</h3>
                                        <span>
                                            {referenceFiles.length} / {profile?.references.maxImages || 0}
                                        </span>
                                        <Tooltip title="添加补充参考图">
                                            <Button type="text" aria-label="添加 MV 补充参考图" icon={<Upload size={15} />} onClick={() => picker.current?.click()} disabled={busy || !profile || referenceFiles.length >= profile.references.maxImages} />
                                        </Tooltip>
                                        <input
                                            ref={picker}
                                            className="suno-studio-hidden-input"
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onChange={(event) => {
                                                selectReferences(event.target.files);
                                                event.currentTarget.value = "";
                                            }}
                                        />
                                    </div>
                                    {minimumImages > 0 && (
                                        <p className="suno-studio-muted">
                                            每段合并本段绑定资产图和补充图，至少 {minimumImages} 张、最多 {profile?.references.maxImages || 0} 张。
                                        </p>
                                    )}
                                    {referenceFiles.map((item) => (
                                        <div className="suno-studio-mv-reference-item" key={item.id}>
                                            <img src={item.previewUrl} alt="" />
                                            <span title={item.file.name}>{item.file.name}</span>
                                            <Tooltip title="移除图片">
                                                <Button type="text" aria-label={`移除 ${item.file.name}`} icon={<X size={14} />} onClick={() => setReferenceFiles((current) => current.filter((file) => file.id !== item.id))} disabled={busy} />
                                            </Tooltip>
                                        </div>
                                    ))}
                                </div>
                                <div className="suno-studio-mv-segments">
                                    {plan.segments.map((segment) => {
                                        const boundAssets = segment.assetIds.map((id) => plan.assets.find((asset) => asset.id === id)).filter((asset): asset is SunoMusicVideoAsset => Boolean(asset));
                                        const hasAllImages = boundAssets.every((asset) => Boolean(asset.reference?.storageKey || asset.reference?.url));
                                        const existingTask = tasks.find(
                                            (task) =>
                                                task.songJobId === plan.songJobId &&
                                                task.songClipId === plan.songClipId &&
                                                task.segmentIndex === segment.index &&
                                                task.prompt === segment.prompt &&
                                                task.model === model &&
                                                ["submitting", "queued", "running", "succeeded", "unknown"].includes(task.status),
                                        );
                                        return (
                                            <article className="suno-studio-mv-segment" key={segment.id}>
                                                <div className="suno-studio-mv-segment-heading">
                                                    <strong>第 {segment.index} 段</strong>
                                                    <span>
                                                        {segment.startSeconds}–{segment.startSeconds + segment.durationSeconds} 秒
                                                    </span>
                                                </div>
                                                {segment.lyricExcerpt && <p className="suno-studio-muted">{segment.lyricExcerpt}</p>}
                                                <p>{segment.visualSummary}</p>
                                                <Input.TextArea
                                                    aria-label={`第 ${segment.index} 段 MV 视频提示词`}
                                                    value={segment.prompt}
                                                    onChange={(event) => updatePlan((current) => ({ ...current, segments: current.segments.map((item) => (item.id === segment.id ? { ...item, prompt: event.target.value } : item)) }))}
                                                    autoSize={{ minRows: 5, maxRows: 12 }}
                                                    disabled={busy || !planCurrent}
                                                />
                                                <div className="suno-studio-mv-segment-assets">
                                                    资产：
                                                    {boundAssets.map((asset) => (
                                                        <span key={asset.id} className={asset.reference ? "is-ready" : ""}>
                                                            {asset.name}
                                                        </span>
                                                    ))}
                                                </div>
                                                {existingTask && <span className={`suno-studio-mv-task-status suno-studio-status-${existingTask.status}`}>{statusLabels[existingTask.status]}</span>}
                                                <Button
                                                    icon={<Clapperboard size={14} />}
                                                     disabled={controlsBusy || Boolean(existingTask) || !planCurrent || !ready || !canRenderThirtySeconds || !hasAllImages || !segment.prompt.trim()}
                                                    onClick={() => void generateSegment(segment)}
                                                >
                                                    {existingTask?.status === "unknown" ? "提交结果待核对" : existingTask ? statusLabels[existingTask.status] : "生成本段视频"}
                                                </Button>
                                            </article>
                                        );
                                    })}
                                </div>
                                <Button
                                    className="suno-studio-mv-submit"
                                    type="primary"
                                    icon={busy ? <LoaderCircle size={15} /> : <Clapperboard size={15} />}
                                    loading={busy && progress.includes("提交第")}
                                    disabled={controlsBusy || !planCurrent || !ready || !canRenderThirtySeconds || !plan.segments.length || submittedSegmentCount === plan.segments.length || generatedAssetCount !== plan.assets.length}
                                    onClick={() => void generateAllSegments()}
                                >
                                    依次提交全部未完成片段
                                </Button>
                            </div>
                        </>
                    )}
                    {progress && (
                        <p className="suno-studio-muted" role="status">
                            {progress}
                        </p>
                    )}
                    {!ready && model && <Alert type="warning" showIcon title="所选视频模型尚未配置可用凭据" />}
                    {error && <Alert type="error" showIcon title={error} />}
                    <p className="suno-studio-mv-note">先按歌词提取共享资产并生成参考图，再逐段提交；每段只绑定本段使用的资产和对应歌曲音频。</p>
                </div>

                <div className="suno-studio-mv-output">
                    <div className="suno-studio-section-heading">
                        <Video size={16} />
                        <h3>MV 预览与任务</h3>
                        <span className="suno-studio-count">{tasks.length} 个任务</span>
                    </div>
                    {currentTask?.resultUrl ? (
                        <div className="suno-studio-mv-player">
                            {video.loading && <span className="suno-studio-muted">正在读取视频</span>}
                            {video.url && <video src={video.url} controls preload="metadata" aria-label={`${currentTask.songTitle} MV 片段预览`} />}
                            {video.error && (
                                <div className="suno-studio-error" role="alert">
                                    {video.error}
                                </div>
                            )}
                            {video.warning && (
                                <div className="suno-studio-sync-error" role="status">
                                    {video.warning}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="suno-studio-empty">
                            <Clapperboard size={30} strokeWidth={1.25} />
                            <h3>{currentTask ? statusLabels[currentTask.status] : "MV 结果会显示在这里"}</h3>
                            <span>{currentTask?.error || currentTask?.syncError || "分析歌词并提交分段视频任务"}</span>
                        </div>
                    )}
                    {currentTask && currentTask.status !== "failed" && (
                        <details className="suno-studio-details">
                            <summary>任务信息</summary>
                            <dl className="suno-studio-job-details">
                                <dt>歌曲</dt>
                                <dd>{currentTask.songTitle}</dd>
                                {currentTask.segmentIndex && (
                                    <>
                                        <dt>分段</dt>
                                        <dd>
                                            第 {currentTask.segmentIndex}/{currentTask.segmentCount || "?"} 段
                                        </dd>
                                    </>
                                )}
                                <dt>模型</dt>
                                <dd>{modelOptionLabel(config, currentTask.model)}</dd>
                                <dt>时长</dt>
                                <dd>{currentTask.duration} 秒</dd>
                                <dt>音频片段</dt>
                                <dd>
                                    {currentTask.audioStart}–{currentTask.audioStart + currentTask.audioDuration} 秒
                                </dd>
                                {currentTask.providerTaskId && (
                                    <>
                                        <dt>任务 ID</dt>
                                        <dd>{currentTask.providerTaskId}</dd>
                                    </>
                                )}
                                <dt>提交时间</dt><dd><time dateTime={currentTask.createdAt}>{new Date(currentTask.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></dd>
                                {currentTask.status === "succeeded" && currentTask.completedAt ? <><dt>成功时间</dt><dd><time dateTime={currentTask.completedAt}>{new Date(currentTask.completedAt).toLocaleString("zh-CN", { hour12: false })}</time></dd></> : null}
                            </dl>
                            {currentTask.syncError && <p className="suno-studio-sync-error">{currentTask.syncError}</p>}
                            {(currentTask.status === "queued" || currentTask.status === "running") && (
                                <Button size="small" icon={<RefreshCw size={14} />} onClick={() => void refreshSunoMusicVideo(currentTask.id)}>
                                    手动查询
                                </Button>
                            )}
                        </details>
                    )}
                    <div className="suno-studio-mv-history" aria-label="MV 任务历史">
                        {tasks.map((task) => (
                            <button type="button" key={task.id} className={`suno-studio-mv-task ${task.id === currentTask?.id ? "suno-studio-mv-task-selected" : ""}`} aria-pressed={task.id === currentTask?.id} onClick={() => setSelectedTaskId(task.id)}>
                                <span className={`suno-studio-mv-task-status suno-studio-status-${task.status}`}>
                                    {task.status === "succeeded" ? <Check size={13} /> : <LoaderCircle size={13} />} {statusLabels[task.status]}
                                </span>
                                <strong>
                                    {task.segmentIndex ? `第 ${task.segmentIndex}/${task.segmentCount || "?"} 段 · ` : ""}
                                    {task.songTitle}
                                </strong>
                                <span>
                                    {task.duration} 秒 · {new Date(task.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                </span>
                                {task.error && <small>{task.error}</small>}
                            </button>
                        ))}
                    </div>
                </div>
            </StudioMvLayout>
        </section>
    );
}

function unbindFacePresets(presets: CharacterFacePresets = {}): CharacterFacePresets {
    return Object.fromEntries(Object.entries(presets).filter(([, value]) => value).map(([role, value]) => [role, { ...value, assetIds: [] }]));
}

function readFileDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(new Error(`读取图片失败：${file.name}`));
        reader.readAsDataURL(file);
    });
}
