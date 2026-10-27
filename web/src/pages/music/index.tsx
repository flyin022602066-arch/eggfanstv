import { Alert, Button, Checkbox, Select, Tabs, Tooltip } from "antd";
import { AudioLines, Check, CircleAlert, Coins, FileText, Music2, Send, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal";
import { SUNO_OPERATIONS, sunoDefaultValues, sunoOperation } from "@/lib/suno-contract";
import type { SunoCanvasContext } from "@/lib/suno-canvas-context";
import { getActiveUserScope } from "@/lib/user-scope";
import { downloadSunoClip, importSunoClip, refreshSunoStudioJob, registerCanvasSunoSource, submitSunoStudioOperation, sunoStudioChannels, uploadSunoReference } from "@/services/suno-studio";
import { channelHasGenerationCredential, useConfigStore } from "@/stores/use-config-store";
import { useSunoStudioStore } from "@/stores/use-suno-studio-store";
import { clipSourceValues, fieldVisible, rangeValues, studioSourceSelection, studioTextResults, updateStudioValues, validateStudioValues } from "./studio-helpers";
import { StudioParameters } from "./studio-parameters";
import { StudioPlayer, type StudioTrack } from "./studio-player";
import { StudioQueue } from "./studio-queue";
import { StudioResults } from "./studio-results";
import { useStudioSession } from "./use-studio-session";
import "./studio.css";

export default function MusicPage({ canvas }: { canvas?: SunoCanvasContext } = {}) {
    const { scope, error: sessionError } = useStudioSession();
    const store = useSunoStudioStore();
    const configuredChannels = useConfigStore((state) => state.config.channels);
    const channels = sunoStudioChannels();
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [view, setView] = useState("create");
    const [selection, setSelection] = useState<{ jobId: string; clipId: string } | null>(null);
    const [reference, setReference] = useState<{ file: File; url: string } | null>(null);
    const [localPreview, setLocalPreview] = useState(false);
    const [playIntent, setPlayIntent] = useState(0);
    const [costDraft, setCostDraft] = useState<string | null>(null);
    const [costAccepted, setCostAccepted] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "warning" | "error"; text: string } | null>(null);
    const [canvasTextSourceId, setCanvasTextSourceId] = useState("");
    const [canvasAudioSourceKey, setCanvasAudioSourceKey] = useState("");
    const ready = store.hydrated && store.scope === scope && scope === getActiveUserScope();
    const draft = store.draft;
    const operation = SUNO_OPERATIONS.find((item) => item.id === draft.operationId) || SUNO_OPERATIONS[0];
    const channel = channels.find((item) => item.id === draft.channelId);
    const jobs = ready ? store.jobs : [];
    const selectedJob = jobs.find((job) => job.id === store.selectedJobId);
    const selectedClip = selectedJob?.clips.find((clip) => selection?.jobId === selectedJob.id && selection.clipId === clip.id) || selectedJob?.clips[0];
    const track: StudioTrack | null = localPreview && reference && ready
        ? { local: true, clip: { id: "local-reference", title: reference.file.name, audioUrl: reference.url } }
        : selectedClip && selectedJob ? { clip: selectedClip, job: selectedJob } : null;
    const canvasAudioOptions = useMemo(() => (canvas?.audioSources || []).flatMap((source) => source.clips.map((clip) => ({
        key: JSON.stringify([source.id || source.title, clip.id]),
        source,
        clip,
        label: `${source.title}${clip.title ? ` · ${clip.title}` : ""}`,
    }))), [canvas?.audioSources]);
    const selectedCanvasAudio = canvasAudioOptions.find((item) => item.key === canvasAudioSourceKey) || canvasAudioOptions[0];
    const selectedCanvasText = canvas?.textSources?.find((item) => item.id === canvasTextSourceId) || canvas?.textSources?.[0];
    const selectedLyrics = selectedClip?.lyrics || studioTextResults(selectedJob?.result).find((item) => item.kind === "lyrics")?.text;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => () => { if (reference) URL.revokeObjectURL(reference.url); }, [reference]);
    useEffect(() => {
        setSelection(null); setReference(null); setLocalPreview(false); setPlayIntent(0);
        setErrors({}); setBusy(null); setCostDraft(null); setCostAccepted(false); setFeedback(null);
    }, [scope]);
    useEffect(() => {
        if (!ready || draft.channelId) return;
        const eligible = sunoStudioChannels();
        const preferred = eligible.find((item) => {
            try { return new URL(item.baseUrl).hostname === "api.eggfans.com"; } catch { return false; }
        });
        if (preferred || eligible.length === 1) useSunoStudioStore.getState().setDraft({ channelId: (preferred || eligible[0]).id });
    }, [ready, draft.channelId, configuredChannels]);
    useEffect(() => {
        if (!ready) return;
        if (!canvas) {
            if (draft.canvasSource) store.setDraft({ canvasSource: undefined });
            return;
        }
        store.setDraft({
            canvasSource: { projectId: canvas.projectId, nodeId: canvas.nodeId },
            ...(canvas.preferredChannelId ? { channelId: canvas.preferredChannelId } : {}),
        });
        setCanvasTextSourceId(canvas.textSources?.[0]?.id || "");
        setCanvasAudioSourceKey("");
    }, [canvas?.projectId, canvas?.nodeId, canvas?.preferredChannelId, ready]);
    useEffect(() => {
        if (!canvas) return;
        const source = { projectId: canvas.projectId, nodeId: canvas.nodeId };
        const activeScope = scope;
        return () => {
            const state = useSunoStudioStore.getState();
            const current = state.draft.canvasSource;
            if (state.scope === activeScope && current?.projectId === source.projectId && current.nodeId === source.nodeId) {
                state.setDraft({ canvasSource: undefined });
            }
        };
    }, [canvas?.projectId, canvas?.nodeId, scope]);
    useEffect(() => {
        if (!canvasAudioSourceKey && canvasAudioOptions[0]) setCanvasAudioSourceKey(canvasAudioOptions[0].key);
    }, [canvasAudioSourceKey, canvasAudioOptions]);

    const action = async (key: string, execute: () => Promise<unknown>, success?: string) => {
        if (!ready || busy) return;
        const activeScope = scope;
        setBusy(key);
        setFeedback(null);
        try {
            await execute();
            if (mounted.current && getActiveUserScope() === activeScope && success) setFeedback({ type: "success", text: success });
        } catch (cause) {
            if (mounted.current && getActiveUserScope() === activeScope) setFeedback({ type: "error", text: cause instanceof Error ? cause.message : "操作未完成" });
        } finally {
            if (mounted.current && getActiveUserScope() === activeScope) setBusy(null);
        }
    };
    const changeOperation = (id: string) => {
        if (!ready || busy || costDraft) return;
        store.setDraft({ operationId: id });
        const selected = useSunoStudioStore.getState().draft;
        const sourceJob = selected.source && jobs.find((item) => item.id === selected.source?.jobId);
        const sourceClip = sourceJob?.clips.find((item) => item.id === selected.source?.clipId);
        if (sourceJob && sourceClip) {
            const target = sunoOperation(id);
            store.setDraft({ values: clipSourceValues(target, selected.values, sourceClip, sourceJob) });
        }
        setErrors({});
    };
    const submit = (confirmed = false) => {
        if (!ready || busy) return;
        const nextErrors = validateStudioValues(operation, draft.values);
        if (!channel) nextErrors.channelId = "请选择已配置的 Suno 渠道";
        else if (!channelHasGenerationCredential(channel)) nextErrors.channelId = "该渠道尚未配置凭据，请前往模型配置";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) { setFeedback({ type: "warning", text: "请修正标记的参数" }); return; }
        const fingerprint = JSON.stringify({ scope, draft });
        if (operation.id === "post-suno-uploads-audio" && draft.values.upload_type === "MUSIC_COPYRIGHT") {
            if (!confirmed) { setCostAccepted(false); setCostDraft(fingerprint); return; }
            if (!costAccepted || costDraft !== fingerprint) { setCostDraft(null); setFeedback({ type: "warning", text: "参数已变更，请重新确认版权上传" }); return; }
        }
        setCostDraft(null);
        void action("submit", async () => {
            const id = await submitSunoStudioOperation();
            if (getActiveUserScope() !== scope) return;
            useSunoStudioStore.getState().selectJob(id);
            setLocalPreview(false); setPlayIntent(0); setView("preview");
        });
    };
    const listen = (next: StudioTrack) => {
        if (!next.job || !ready) return;
        store.selectJob(next.job.id);
        store.setDraft({ channelId: next.job.channelId, source: studioSourceSelection(next.job, next.clip) });
        setSelection({ jobId: next.job.id, clipId: next.clip.id });
        setLocalPreview(false); setPlayIntent((current) => current + 1); setView("preview");
    };
    const source = (next: StudioTrack) => {
        if (!next.job || !ready || costDraft || busy) return;
        let target = operation;
        let values = { ...draft.values };
        if (!target.fields.some((field) => fieldVisible(field, values) && /(^|\.)(clip_id|clipId|root_clip_id|continue_clip_id|artist_clip_id|underpainting_clip_id|mashup_clip_ids|url|audio_url|id|ids|task_batch_id|taskBatchId)$/.test(field.key))) {
            target = sunoOperation("post-suno-submit-music");
            values = target.id === operation.id ? updateStudioValues(target, values, "task", "extend") : { ...sunoDefaultValues(target.id), mode: "custom", task: "extend" };
        }
        store.setDraft({ channelId: next.job.channelId, operationId: target.id, values: clipSourceValues(target, values, next.clip, next.job), source: studioSourceSelection(next.job, next.clip) });
        setErrors({}); setView("create");
        setFeedback({ type: "success", text: "源曲已填入" });
    };
    const importTrack = (next: StudioTrack) => { if (next.job) void action(`import:${next.clip.id}`, () => importSunoClip(next.job!.id, next.clip.id), "已加入本地素材库"); };
    const downloadTrack = (next: StudioTrack) => { if (next.job) void action(`download:${next.clip.id}`, () => downloadSunoClip(next.job!.id, next.clip.id)); };
    const upload = () => {
        if (!reference) return;
        const file = reference.file;
        const startDraft = JSON.stringify(draft);
        void action("upload", async () => {
            const uploaded = await uploadSunoReference(file);
            if (!mounted.current || getActiveUserScope() !== scope) return;
            if (JSON.stringify(useSunoStudioStore.getState().draft) !== startDraft) throw new Error("草稿已变更，未覆盖当前参考音频");
            const target = operation.fields.some((field) => field.key === "url") ? operation : sunoOperation("post-suno-uploads-audio");
            const values = target.id === operation.id ? { ...draft.values } : sunoDefaultValues(target.id);
            store.setDraft({ operationId: target.id, values: { ...values, url: uploaded.url, ...(target.fields.some((field) => field.key === "name") ? { name: file.name.replace(/\.[^.]+$/, "") } : {}) } });
            setErrors({});
        }, "参考音频已上传");
    };
    const applyText = (kind: "lyrics" | "tags" | "persona", text: string) => {
        if (!ready || busy || costDraft) return;
        if (kind === "persona") {
            store.setDraft({ channelId: selectedJob?.channelId || draft.channelId, operationId: "post-suno-submit-music", values: { ...sunoDefaultValues("post-suno-submit-music"), mode: "custom", task: "artist_consistency", mv: "chirp-v4-tau", persona_id: text, artist_clip_id: String(selectedJob?.values.root_clip_id || "") } });
            setErrors({}); setView("create");
            return;
        }
        const target = sunoOperation("post-suno-submit-music");
        let values = operation.id === target.id ? { ...draft.values } : sunoDefaultValues(target.id);
        if (kind === "lyrics") values = updateStudioValues(target, values, "mode", "custom");
        store.setDraft({ operationId: target.id, values: { ...values, [kind === "lyrics" ? "prompt" : "tags"]: text } });
        setErrors({}); setView("create");
    };
    const useCanvasLyrics = () => {
        const source = selectedCanvasText;
        const text = source?.text.trim();
        if (!source || !text) { setFeedback({ type: "warning", text: "所选文本节点没有可用内容" }); return; }
        applyText("lyrics", text);
        setFeedback({ type: "success", text: `已将「${source.title}」写入歌词` });
    };
    const useCanvasAudio = () => {
        if (!canvas || !selectedCanvasAudio || !ready || busy) return;
        const { source: audioSource, clip } = selectedCanvasAudio;
        void action("canvas-source", async () => {
            const sourceJobId = await registerCanvasSunoSource(audioSource, { projectId: canvas.projectId, nodeId: canvas.nodeId });
            const sourceJob = useSunoStudioStore.getState().jobs.find((job) => job.id === sourceJobId);
            if (!sourceJob) throw new Error("无法读取画布曲目记录");
            let target = operation;
            let values = { ...draft.values };
            if (!target.fields.some((field) => fieldVisible(field, values) && /(^|\\.)(clip_id|clipId|root_clip_id|continue_clip_id|artist_clip_id|underpainting_clip_id|mashup_clip_ids|url|audio_url|id|ids|task_batch_id|taskBatchId)$/.test(field.key))) {
                target = sunoOperation("post-suno-submit-music");
                values = target.id === operation.id ? updateStudioValues(target, values, "task", "extend") : { ...sunoDefaultValues(target.id), mode: "custom", task: "extend" };
            }
            useSunoStudioStore.getState().selectJob(sourceJobId);
            useSunoStudioStore.getState().setDraft({
                channelId: sourceJob.channelId,
                operationId: target.id,
                values: clipSourceValues(target, values, clip, sourceJob),
                source: studioSourceSelection(sourceJob, clip),
                canvasSource: { projectId: canvas.projectId, nodeId: canvas.nodeId },
            });
            setSelection({ jobId: sourceJobId, clipId: clip.id });
            setLocalPreview(false); setPlayIntent(0); setErrors({}); setView("create");
        }, "源曲已关联，可继续创作");
    };
    const returnCanvasClip = () => {
        if (!canvas || !selectedJob || !selectedClip) return;
        void action("canvas-return", () => canvas.onReturnClip(selectedJob, selectedClip), "已将曲目写回画布音频节点");
    };
    const returnCanvasLyrics = () => {
        if (!canvas || !selectedJob) return;
        if (!selectedLyrics) { setFeedback({ type: "warning", text: "当前任务没有可回写的歌词文本" }); return; }
        canvas.onReturnText(selectedLyrics);
        setFeedback({ type: "success", text: "歌词已作为文本节点写回画布" });
    };
    const disabled = !ready || busy !== null || costDraft !== null;
    const persistenceError = store.persistenceError || sessionError;
    return (
        <main className="suno-studio" data-view={view} aria-label="Suno 音乐导演台">
            <header className="suno-studio-header"><div className="suno-studio-title"><AudioLines size={23} /><h1>音乐导演台</h1><span className="suno-studio-brand">SUNO</span></div><div className="suno-studio-header-controls"><span className="suno-studio-save-state">{persistenceError ? <CircleAlert size={13} /> : <Check size={13} />}{persistenceError ? "保存异常" : ready ? "本地草稿" : "正在载入"}</span><Select aria-label="Suno 渠道" className="suno-studio-channel" placeholder="选择渠道" disabled={disabled} value={draft.channelId || undefined} options={channels.map((item) => ({ value: item.id, label: item.name }))} onChange={(channelId) => { store.setDraft({ channelId }); setErrors((current) => ({ ...current, channelId: "" })); }} /><Tooltip title="模型渠道配置"><Link to="/settings" className="suno-studio-settings-link" aria-label="模型渠道配置"><Settings2 size={17} /></Link></Tooltip></div></header>
            {persistenceError && <Alert className="suno-studio-banner" type="error" showIcon title={persistenceError} />}
            {errors.channelId && <Alert className="suno-studio-banner" type="warning" showIcon title={errors.channelId} />}
            {feedback && <Alert className="suno-studio-banner" type={feedback.type} showIcon title={<span role={feedback.type === "success" ? "status" : "alert"}>{feedback.text}</span>} closable onClose={() => setFeedback(null)} />}
            {canvas && <section className="suno-studio-canvas-bridge" aria-label="画布联动">
                <div className="suno-studio-canvas-context"><Music2 size={16} /><span>{canvas.title}</span><span className="suno-studio-canvas-node">当前画布节点</span></div>
                {canvas.textSources?.length ? <div className="suno-studio-canvas-action">
                    <Select aria-label="关联文本节点" value={selectedCanvasText?.id} options={canvas.textSources.map((item) => ({ value: item.id, label: item.title || "文本节点" }))} onChange={setCanvasTextSourceId} />
                    <Button icon={<FileText size={15} />} disabled={disabled || !selectedCanvasText?.text.trim()} onClick={useCanvasLyrics}>写入歌词</Button>
                </div> : null}
                {canvasAudioOptions.length ? <div className="suno-studio-canvas-action">
                    <Select aria-label="关联 Suno 曲目" value={selectedCanvasAudio?.key} options={canvasAudioOptions.map((item) => ({ value: item.key, label: item.label }))} onChange={setCanvasAudioSourceKey} />
                    <Button icon={<Music2 size={15} />} disabled={disabled || !selectedCanvasAudio?.source.channelId} loading={busy === "canvas-source"} onClick={useCanvasAudio}>设为源曲</Button>
                </div> : null}
                <div className="suno-studio-canvas-action">
                    <Button icon={<Send size={15} />} disabled={disabled || !selectedClip || !selectedJob} loading={busy === "canvas-return"} onClick={returnCanvasClip}>曲目写回画布</Button>
                    <Button icon={<FileText size={15} />} disabled={disabled || !selectedLyrics} onClick={returnCanvasLyrics}>歌词写回画布</Button>
                </div>
            </section>}
            <Tabs className="suno-studio-mobile-tabs" activeKey={view} onChange={setView} items={[{ key: "create", label: "创作参数" }, { key: "preview", label: "试听 / 结果" }, { key: "queue", label: `制作队列 · ${jobs.length}` }]} />
            <div className="suno-studio-columns">
                <StudioParameters operation={operation} values={ready ? draft.values : sunoDefaultValues(operation.id)} errors={errors} disabled={disabled} submitting={busy === "submit"} uploading={busy === "upload"} referenceFile={reference?.file || null} canUpload={Boolean(channel && channelHasGenerationCredential(channel))} onOperation={changeOperation} onValue={(key, value) => { store.setDraft({ values: updateStudioValues(operation, draft.values, key, value) }); setErrors((current) => ({ ...current, [key]: "" })); }} onFile={(file) => { setReference(file ? { file, url: URL.createObjectURL(file) } : null); setLocalPreview(Boolean(file)); setPlayIntent(0); }} onUpload={upload} onSubmit={() => submit()} />
                <div className="suno-studio-center"><StudioPlayer track={track} playIntent={playIntent} busy={busy} canApplyRange={!disabled && operation.fields.some((field) => fieldVisible(field, draft.values) && /(continue_at|start_s|end_s)$/.test(field.key))} onSource={source} onImport={importTrack} onDownload={downloadTrack} onRange={(range) => { store.setDraft({ values: rangeValues(operation, draft.values, range) }); setErrors({}); setFeedback({ type: "success", text: "选区已填入" }); }} /><StudioResults job={selectedJob} onApply={applyText} /></div>
                <StudioQueue jobs={jobs} selectedJobId={store.selectedJobId} selectedClipId={track?.clip.id} busy={busy} onSelect={(id) => { store.selectJob(id); setLocalPreview(false); setPlayIntent(0); setView("preview"); }} onRefresh={(id) => { void action(`refresh:${id}`, () => refreshSunoStudioJob(id)); }} onQuery={(id) => { if (disabled) return; const job = jobs.find((item) => item.id === id); if (!job) return; store.setDraft({ channelId: job.channelId, operationId: "get-suno-fetch-id", values: { id: job.taskId || "" } }); setErrors({}); setView("create"); }} onRestore={(id) => { if (disabled) return; store.restoreJob(id); setErrors({}); setView("create"); }} onListen={listen} onSource={source} onImport={importTrack} onDownload={downloadTrack} />
            </div>
            <AppModal open={costDraft !== null} title={<span className="suno-studio-cost-title"><Coins size={18} />版权上传 · 30 积分</span>} width={440} okText="确认并提交上传" cancelText="取消" okButtonProps={{ disabled: !costAccepted }} onCancel={() => setCostDraft(null)} onOk={() => submit(true)}><div className="suno-studio-cost-confirm"><p>上传类型：MUSIC_COPYRIGHT</p><Checkbox checked={costAccepted} onChange={(event) => setCostAccepted(event.target.checked)}>我拥有该音频的版权，并确认本次上传消耗 30 积分</Checkbox></div></AppModal>
        </main>
    );
}
