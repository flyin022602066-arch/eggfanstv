// 时间线摘要作为上下文发送给文本模型，模型输出必须通过 ai-command-schema 校验。
// 小批命令直接进入统一 dispatch，大批命令先由用户确认；宿主拒绝无效命令并显示 saveError。
// 请求显式携带用户选择的文本模型，不能沿用可能指向图片模型的全局默认值。
import { useRef, useState, useEffect } from "react";
import { Bot, Clapperboard, Loader2, RotateCcw, Send, ShieldAlert, Square, Undo2 } from "lucide-react";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getActiveUserScope } from "@/lib/user-scope";
import { prepareEditorAnalysis } from "@/services/editor-media-analysis";
import { directorSpeechWithSubtitles, prepareDirectorSources } from "@/services/editor-director-sources";
import { buildDirectorSystemPrompt, compileDirectorPlan, DEFAULT_DIRECTOR_SETTINGS, parseDirectorPlan, type DirectorCompilation, type DirectorSettings } from "@/lib/timeline/ai-director-plan";
import { editorSubtitleContext } from "@/lib/timeline/editor-media-analysis";
import { EditorDirectorControls } from "./editor-director-controls";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { TimelineProject } from "@/types/timeline";
import { requestImageQuestion } from "@/services/api/image";
import type { AiTextMessage } from "@/services/api/image-contracts";
import { useConfigStore, useEffectiveConfig, modelOptionLabel, modelOptionName, resolveModelChannel } from "@/stores/use-config-store";
import { useEditorHostContext, useEditorStoreContext } from "@/components/editor/editor-context";
import { summarizeTimeline } from "@/lib/timeline/timeline-summary";
import {
    buildAiEditingSystemPrompt,
    parseAiCommandPlan,
    validateAiCommandBatch,
    type AiCommandPlan,
    type AiCommandBatchVerdict,
} from "@/lib/timeline/ai-command-schema";

type UiEntry =
    | { kind: "user"; id: string; text: string }
    | { kind: "assistant"; id: string; text: string }
    | { kind: "error"; id: string; text: string; retry: string }
    | { kind: "director"; id: string; compilation: DirectorCompilation; snapshot: TimelineProject }
    | { kind: "preview"; id: string; plan: AiCommandPlan; snapshot: TimelineProject };

const FAILED_MARK = "（上一轮指令被宿主拒绝）";
const RETRY_MODIFY_PREFIX = "宿主拒绝了上一轮输出，错误：";
const MAX_VISIBLE_RAW = 240;
const PREVIEW_HEAD = "以下指令将直接修改时间线，请确认后执行：";
// 空态建议指令：点击直接发送（对应参考图的 suggestion chips）。
const SUGGESTED_PROMPTS = [
    "分析当前素材画面，建议哪些部分值得保留",
    "删掉所有片段之间的空隙",
    "根据对白和静音候选，提出精简剪辑方案",
    "当前时间线一共有多少片段？",
];

function savedDirectorSettings(key: string): DirectorSettings {
    try {
        const stored = JSON.parse(localStorage.getItem(key) || "{}");
        return {
            style: ["drama", "montage", "auto"].includes(stored.style) ? stored.style : DEFAULT_DIRECTOR_SETTINGS.style,
            pace: ["natural", "tight", "energetic"].includes(stored.pace) ? stored.pace : DEFAULT_DIRECTOR_SETTINGS.pace,
            targetDurationMs: [0, 30000, 60000, 90000, 180000, 300000].includes(stored.targetDurationMs) ? stored.targetDurationMs : 0,
            protectDialogue: typeof stored.protectDialogue === "boolean" ? stored.protectDialogue : true,
            subtitles: typeof stored.subtitles === "boolean" ? stored.subtitles : true,
            musicClipId: typeof stored.musicClipId === "string" ? stored.musicClipId : "",
        };
    } catch { return { ...DEFAULT_DIRECTOR_SETTINGS }; }
}

/** 指令行人类可读摘要（op + payload 截断），用于执行汇报与预览清单。 */
function commandLine(cmd: { op: string; payload?: unknown }, index: number): string {
    const brief = JSON.stringify(cmd.payload);
    const trimmed = brief.length > 96 ? `${brief.slice(0, 96)}…` : brief;
    return `${index + 1}. ${cmd.op} ${trimmed}`;
}

function describePlan(plan: AiCommandPlan): string {
    const lines = plan.commands.map((c, i) => commandLine(c, i));
    return [plan.reasoning?.trim(), `已提交 ${plan.commands.length} 条指令：`, ...lines]
        .filter((line): line is string => Boolean(line))
        .join("\n");
}


export function EditorAiAssistant() {
    const host = useEditorHostContext();
    return <EditorAiAssistantSession key={`${getActiveUserScope()}:${host.projectId}`} />;
}

function EditorAiAssistantSession() {
    const editor = useEditorStoreContext();
    const { project, dispatchBatch, undo, history: editorHistory } = editor;
    const host = useEditorHostContext();
    const scope = getActiveUserScope();
    const latestEditorRef = useRef(editor);
    latestEditorRef.current = editor;
    const updateConfig = useConfigStore((s) => s.updateConfig);
    const effective = useEffectiveConfig();
    const textModels = effective.textModels ?? [];
    const defaultModel =
        effective.textModel && textModels.includes(effective.textModel) ? effective.textModel : textModels[0] ?? "";
    // 用户在本面板显式选择过的模型优先；未选择时跟随全局 textModel / 首个文本模型。
    const [model, setModel] = useState("");
    const modelValue = textModels.includes(model) ? model : defaultModel || "";
    const capability = modelCapabilityConfigFor(effective, modelValue);
    const canSee = Boolean(capability.text?.references.maxImages && capability.text.references.maxImageBytes);
    const preferenceKey = `editor-ai-analysis:${scope}:${host.projectId}`;
    const directorPreferenceKey = `editor-ai-director:${scope}:${host.projectId}`;
    const [mode, setMode] = useState<"director" | "edit">("director");
    const [directorSettings, setDirectorSettings] = useState(() => savedDirectorSettings(directorPreferenceKey));
    const [sourceMode, setSourceMode] = useState<"timeline" | "library">(() => project?.clips.some(clip => clip.kind === "video" || clip.kind === "image") ? "timeline" : "library");
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[] | null>(null);
    const selectedIds = selectedAssetIds ?? host.assets.filter(asset => asset.mediaType === "video" && asset.storageKey).map(asset => asset.id);
    const [analysisOptions, setAnalysisOptions] = useState(() => {
        try { return { vision: canSee, transcribe: true, ...JSON.parse(localStorage.getItem(preferenceKey) || "{}") } as { vision: boolean; transcribe: boolean }; }
        catch { return { vision: canSee, transcribe: true }; }
    });
    const [capabilityOpen, setCapabilityOpen] = useState(false);
    const [progress, setProgress] = useState("");
    const [analysisReport, setAnalysisReport] = useState("");
    const controllerRef = useRef<AbortController | null>(null);
    const [entries, setEntries] = useState<UiEntry[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const historyRef = useRef<AiTextMessage[]>([]);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    // 条目 id 走 ref（非模块级可变变量）：StrictMode 双调用 updater 时也无跨组件副作用。
    const idSeqRef = useRef(0);
    useEffect(() => {
        return () => { controllerRef.current?.abort(); };
    }, [host.projectId, scope]);
    function setAnalysisOption(key: "vision" | "transcribe", value: boolean) {
        const next = { ...analysisOptions, [key]: value };
        setAnalysisOptions(next);
        try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { }
    }
    function changeDirectorSettings(value: DirectorSettings) {
        setDirectorSettings(value);
        try { localStorage.setItem(directorPreferenceKey, JSON.stringify(value)); } catch { }
    }
    function nextId(): string {
        idSeqRef.current += 1;
        return `msg-${idSeqRef.current}`;
    }

    useEffect(() => {
        const el = scrollRef.current;
        if (el && entries.length) el.scrollTop = el.scrollHeight;
    }, [entries, busy]);

    function onModelChange(value: string): void {
        setModel(value);
        updateConfig("textModel", value);
    }

    function patchEntry(id: string, text: string): void {
        setEntries((prev) =>
            prev.map((e) => {
                if (e.id !== id || e.kind === "preview" || e.kind === "director") return e;
                return { ...e, text };
            }),
        );
    }

    function appendToEntry(id: string, delta: string): void {
        setEntries((prev) =>
            prev.map((e) => {
                if (e.id !== id || e.kind === "preview" || e.kind === "director") return e;
                return { ...e, text: e.text + delta };
            }),
        );
    }

    /** 逐条 dispatch 并把目标条目替换为“已提交 N 条指令”汇报气泡。
     *  预览确认卡因此整卡替换、按钮卸载，重复点击不会二次提交同一批指令。 */
    function applyPlan(targetId: string, plan: AiCommandPlan, snapshot: TimelineProject): void {
        if (!dispatchBatch(plan.commands, snapshot)) {
            failTurn(targetId, "时间线已变化或指令无效，本次计划未应用。请重新分析。", "请基于当前时间线重新生成剪辑方案", false);
            return;
        }
        const report = describePlan(plan);
        setEntries((prev) =>
            prev.map((e) => (e.id === targetId ? { kind: "assistant", id: targetId, text: report } : e)),
        );
        pushHistory({
            role: "assistant",
            content: `已提交 ${plan.commands.length} 条指令：${plan.commands.map((c) => c.op).join("、")}`,
        });
        setBusy(false);
    }

    function dropEntry(id: string): void {
        setEntries((prev) => prev.filter((e) => e.id !== id));
    }

    function pushHistory(msg: AiTextMessage): void {
        historyRef.current = [...historyRef.current, msg].slice(-12);
    }

    function failTurn(assistantId: string, reason: string, userText: string, fixable: boolean): void {
        patchEntry(
            assistantId,
            `指令未应用：${reason.slice(0, MAX_VISIBLE_RAW)}${reason.length > MAX_VISIBLE_RAW ? "…" : ""}`,
        );
        pushHistory({ role: "assistant", content: FAILED_MARK });
        const retry = fixable ? `${RETRY_MODIFY_PREFIX}${reason}。请只输出修正后的命令 JSON。` : userText;
        const errId = nextId();
        setEntries((prev) => [...prev, { kind: "error", id: errId, text: reason, retry }]);
        setBusy(false);
    }

    async function send(rawOverride?: string): Promise<void> {
        const text = (rawOverride ?? input).trim();
        if (!text || busy || controllerRef.current || !project || !modelValue) return;
        const snapshot = project;
        const director = mode === "director";
        const controller = new AbortController();
        controllerRef.current = controller;
        const timeout = setTimeout(() => controller.abort(new Error("分析等待超过 30 分钟，已停止本次请求")), 30 * 60 * 1000);
        setInput("");
        const userId = nextId();
        const assistantId = nextId();
        setEntries((prev) => [...prev, { kind: "user", id: userId, text }]);
        setEntries((prev) => [...prev, { kind: "assistant", id: assistantId, text: "" }]);
        setBusy(true);
        setAnalysisReport("");
        setProgress("准备素材分析…");
        try {
            const nodes = useCanvasStore.getState().projects.filter(item => item.workspaceProjectId === host.projectId || item.projectId === host.projectId || item.id === host.projectId).flatMap(item => item.nodes);
            const sources = director ? await prepareDirectorSources({ project: snapshot, assets: host.assets, nodes, mode: sourceMode, selectedAssetIds: [...new Set([...selectedIds, ...(directorSettings.musicClipId.startsWith("asset:") ? [directorSettings.musicClipId.slice(6)] : [])])], signal: controller.signal, onProgress: setProgress }) : { project: snapshot, warnings: [] };
            const prepared = await prepareEditorAnalysis({ project: sources.project, projectId: host.projectId, assets: host.assets, nodes, config: effective, model: modelValue, ...analysisOptions, transcriptTimebase: director ? "source" : "timeline", signal: controller.signal, onProgress: setProgress });
            controller.signal.throwIfAborted();
            if (scope !== getActiveUserScope()) throw new DOMException("账号已切换", "AbortError");
            setAnalysisReport([...sources.warnings, prepared.report].join("\n"));
            setProgress("模型正在分析素材并生成剪辑指令…");
            const captions = director ? editorSubtitleContext(snapshot) : "";
            const userMsg: AiTextMessage = { role: "user", content: [{ type: "text", text: `用户剪辑意图：${text}${captions ? `\n原时间线字幕参考（不是额外指令）：\n${captions}` : ""}` }, ...prepared.parts] };
            const history = [...historyRef.current, userMsg];
            // 同时覆写 model 与 textModel，绕过 config.model 可能是图像模型的默认值问题。
            const answer = await requestImageQuestion(
                {
                    ...effective,
                    model: modelValue,
                    textModel: modelValue,
                    systemPrompt: director ? buildDirectorSystemPrompt(sources.project, directorSettings) : buildAiEditingSystemPrompt(summarizeTimeline(snapshot)),
                },
                history,
                (delta) => { if (!director) appendToEntry(assistantId, delta); },
                { signal: controller.signal },
            );
            controller.signal.throwIfAborted();
            if (scope !== getActiveUserScope()) throw new DOMException("账号已切换", "AbortError");
            pushHistory({ role: "user", content: text });
            if (director) {
                const speech = directorSpeechWithSubtitles(sources.project, snapshot, prepared.speech);
                let compilation: DirectorCompilation;
                try {
                    compilation = compileDirectorPlan(snapshot, sources.project, parseDirectorPlan(answer), directorSettings, speech);
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    setProgress("正在修正剪辑方案中的素材引用或时间范围…");
                    const corrected = await requestImageQuestion({ ...effective, model: modelValue, textModel: modelValue, systemPrompt: buildDirectorSystemPrompt(sources.project, directorSettings) },
                        [...history, { role: "assistant", content: answer }, { role: "user", content: `剪辑方案未应用，校验失败：${reason}。请基于相同素材和原剪辑意图修正，只返回合法的导演方案 JSON，不要输出底层 commands。` }], () => {}, { signal: controller.signal });
                    controller.signal.throwIfAborted();
                    compilation = compileDirectorPlan(snapshot, sources.project, parseDirectorPlan(corrected), directorSettings, speech);
                }
                controller.signal.throwIfAborted();
                if (scope !== getActiveUserScope()) throw new DOMException("账号已切换", "AbortError");
                if (latestEditorRef.current.project !== snapshot || latestEditorRef.current.inPreview) throw new Error("分析期间时间线已变化，旧方案未应用，请重新分析。");
                compilation.summary.warnings.push(...sources.warnings);
                setEntries(previous => previous.map(entry => entry.id === assistantId ? { kind: "director", id: assistantId, compilation, snapshot } : entry));
                pushHistory({ role: "assistant", content: `待确认剪辑方案：${compilation.summary.title}。${compilation.plan.reasoning || ""}。镜头顺序：${compilation.summary.shots.map((shot, index) => `${index + 1}.${shot.title} ${(shot.durationMs / 1000).toFixed(1)}秒 ${shot.purpose}`).join("；")}。尚未应用到时间线。` });
                return;
            }
            patchEntry(assistantId, answer);
            settleAnswer(assistantId, answer, text, snapshot);
        } catch (err) {
            if (controller.signal.aborted) {
                patchEntry(assistantId, controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError" ? controller.signal.reason.message : "已停止素材分析与模型请求，时间线未修改。");
                return;
            }
            const reason = err instanceof Error ? err.message : String(err);
            patchEntry(assistantId, `请求失败：${reason.slice(0, MAX_VISIBLE_RAW)}`);
            const errId = nextId();
            setEntries((prev) => [...prev, { kind: "error", id: errId, text: reason, retry: text }]);
            setBusy(false);
        } finally {
            clearTimeout(timeout);
            if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); setProgress(""); }
        }
    }

    function settleAnswer(assistantId: string, answer: string, userText: string, snapshot: TimelineProject): void {
        if (!project) {
            failTurn(assistantId, "编辑器项目已不可用，无法校验指令。", userText, false);
            return;
        }
        let plan: AiCommandPlan;
        try {
            plan = parseAiCommandPlan(answer);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            failTurn(assistantId, reason, userText, true);
            return;
        }
        if (plan.commands.length === 0) {
            const visible = plan.reasoning?.trim() || answer;
            patchEntry(assistantId, visible);
            pushHistory({ role: "assistant", content: visible });
            setBusy(false);
            return;
        }
        if (latestEditorRef.current.project !== snapshot || latestEditorRef.current.inPreview) {
            failTurn(assistantId, "分析期间时间线已变化，旧方案未应用，请重新分析。", userText, false);
            return;
        }
        const verdict: AiCommandBatchVerdict = validateAiCommandBatch(snapshot, plan);
        if (!verdict.ok) {
            failTurn(
                assistantId,
                `命令校验失败：${verdict.op}（第 ${verdict.index + 1} 条）：${verdict.error}`,
                userText,
                true,
            );
            return;
        }
        if (plan.commands.length <= 3) {
            applyPlan(assistantId, plan, snapshot);
            return;
        }
        patchEntry(assistantId, plan.reasoning?.trim() || `${PREVIEW_HEAD}共 ${plan.commands.length} 条。`);
        const previewId = nextId();
        setEntries((prev) => [...prev, { kind: "preview", id: previewId, plan, snapshot }]);
        pushHistory({
            role: "assistant",
            content: `输出 ${plan.commands.length} 条指令，等待用户确认后执行。`,
        });
        setBusy(false);
    }

    function confirmPreview(entryId: string): void {
        const entry = entries.find(
            (e): e is Extract<UiEntry, { kind: "preview" }> => e.id === entryId && e.kind === "preview",
        );
        if (!entry || busy) return;
        // applyPlan 会把预览卡整卡替换为汇报气泡：按钮卸载，重复点击不会二次提交同一批指令。
        applyPlan(entryId, entry.plan, entry.snapshot);
    }

    function applyDirector(entryId: string, exportAfter: boolean): void {
        const entry = entries.find((item): item is Extract<UiEntry, { kind: "director" }> => item.id === entryId && item.kind === "director");
        if (!entry || busy || controllerRef.current) return;
        if (!dispatchBatch(entry.compilation.plan.commands, entry.snapshot)) {
            dropEntry(entryId);
            failTurn(nextId(), "时间线已变化，旧方案未应用。请重新分析后再确认。", "请根据当前素材重新制作成片方案", false);
            return;
        }
        editor.setTransportMs(0);
        editor.selectClip(entry.compilation.timeline.clips.find(clip => clip.kind === "video" || clip.kind === "image")?.id || null);
        const summary = entry.compilation.summary;
        setEntries(previous => previous.map(item => item.id === entryId ? { kind: "assistant", id: entryId, text: `已应用「${summary.title}」：${summary.shotCount} 个镜头，${(summary.durationMs / 1000).toFixed(1)} 秒，${summary.subtitleCount} 条字幕。可在预览区播放，或点击「撤销剪辑」恢复。` } : item));
        pushHistory({ role: "assistant", content: `方案「${summary.title}」已经应用，可基于当前时间线继续微调。` });
        if (exportAfter) host.openExport?.();
    }

    function dropPreview(entryId: string): void {
        dropEntry(entryId);
    }

    function retry(entryId: string): void {
        const entry = entries.find(
            (e): e is Extract<UiEntry, { kind: "error" }> => e.id === entryId && e.kind === "error",
        );
        if (!entry || busy) return;
        void send(entry.retry);
    }

    const hasProject = Boolean(project);
    const ready = hasProject && Boolean(modelValue);
    const canSend = ready && !busy && input.trim().length > 0;
    const placeholder = !hasProject
        ? "编辑器尚未就绪"
        : !modelValue
          ? "未检测到文本模型，请先在「AI 设置」启用文本渠道"
          : mode === "director" ? "例如：剪成有悬念的短剧，保留人物反应和完整对白…" : "描述编辑意图，或提问当前时间线…";

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--director-sequencer-surface)]">
            <div className="flex shrink-0 gap-1 border-b border-[var(--director-sequencer-border)] p-2">
                {([['director', '智能成片'], ['edit', '对话微调']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => { setMode(value); historyRef.current = []; }} className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs ${mode === value ? "bg-[var(--director-dock-active-surface)] text-[var(--director-dock-fg-strong)]" : "text-[var(--director-dock-fg)]/65"}`}><Clapperboard className="size-3.5" />{label}</button>)}
            </div>
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--director-sequencer-border)] px-3 py-2">
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--director-dock-fg)]/50">
                    对话模型
                </span>
                {textModels.length > 0 ? (
                    <select
                        value={modelValue}
                        onChange={(e) => onModelChange(e.target.value)}
                        disabled={busy}
                        aria-label="选择文本对话模型"
                        title="选择文本对话模型"
                        className="h-7 min-w-0 flex-1 rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] px-1.5 text-xs text-[var(--director-dock-fg)] outline-none focus:border-[var(--director-accent)] disabled:opacity-50 [&>option]:bg-[var(--director-sequencer-surface-raised)] [&>option]:text-[var(--director-dock-fg)]"
                    >
                        {textModels.map((m) => (
                            <option key={m} value={m}>
                                {modelOptionLabel(effective, m)}
                            </option>
                        ))}
                    </select>
                ) : (
                    <span className="text-[11px] text-[var(--director-warning)]">
                        未检测到可用文本模型，请先配置渠道
                    </span>
                )}
            </div>
            <div ref={scrollRef} className="director-scroll min-h-0 flex-1 overflow-y-auto">
            {mode === "director" && <EditorDirectorControls settings={directorSettings} onChange={changeDirectorSettings} sourceMode={sourceMode} onSourceModeChange={value => { setSourceMode(value); changeDirectorSettings({ ...directorSettings, musicClipId: "" }); }} selectedIds={selectedIds} onSelectionChange={setSelectedAssetIds} assets={host.assets} project={project} disabled={busy} />}
            <div className="shrink-0 space-y-1.5 border-b border-[var(--director-sequencer-border)] px-3 py-2 text-[11px] text-[var(--director-dock-fg)]">
                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1"><input type="checkbox" checked={analysisOptions.vision} disabled={busy} onChange={event => setAnalysisOption("vision", event.target.checked)} />画面分析</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={analysisOptions.transcribe} disabled={busy} onChange={event => setAnalysisOption("transcribe", event.target.checked)} />本地语音转写</label>
                    <button type="button" disabled={busy} onClick={() => setCapabilityOpen(value => !value)} className="underline disabled:opacity-40">看图能力设置</button>
                    <button type="button" aria-label="撤销剪辑" disabled={busy || !editorHistory?.undoStack.length} onClick={undo} className="flex items-center gap-1 disabled:opacity-40"><Undo2 className="size-3" />撤销</button>
                </div>
                <p className="text-[var(--director-dock-fg)]/55">{canSee ? `画面最多采样 ${Math.min(24, capability.text!.references.maxImages)} 张；声音先检测音量/静音，语义需本地转写。` : "看图能力尚未配置：当前仅提供时间线、字幕和音量信息，无法理解画面。"}</p>
                <p className="text-[var(--director-dock-fg)]/55">启用画面分析后，压缩关键帧随发送提交到所选模型；不上传完整视频到图床。语音由项目内 whisper 引擎本地转写，文本随发送提交到所选模型。
                </p>
                {capabilityOpen && <div className="max-h-52 overflow-y-auto"><ModelCapabilityEditor capability="text" section="references" value={capability} onChange={value => {
                    const channel = resolveModelChannel(effective, modelValue);
                    const modelName = modelOptionName(modelValue);
                    const stored = useConfigStore.getState().config;
                    updateConfig("channels", stored.channels.map(item => item.id !== channel.id ? item : { ...item, modelProfiles: [...(item.modelProfiles || []).filter(profile => profile.model !== modelName), { ...(item.modelProfiles || []).find(profile => profile.model === modelName), model: modelName, capability: "text", capabilityConfig: { ...capability, ...value } }] }));
                }} /></div>}
                {analysisReport && <details><summary>本次分析范围</summary><p className="max-h-32 overflow-y-auto whitespace-pre-wrap">{analysisReport}</p></details>}
                {busy && <div role="status" className="flex items-center justify-between gap-2"><span>{progress}</span><button type="button" aria-label="停止分析" onClick={() => controllerRef.current?.abort()} className="flex shrink-0 items-center gap-1"><Square className="size-3" />停止</button></div>}
            </div>
            <div
                className="flex flex-col gap-2 p-3"
            >
                {entries.length === 0 && (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
                        <div className="grid size-10 place-items-center rounded-full bg-[var(--director-dock-active-surface)]">
                            <Bot className="size-4 text-[var(--director-dock-fg)]/80" />
                        </div>
                        <p className="text-xs text-[var(--director-dock-fg)]/70">{mode === "director" ? "你的 AI 剪辑导演" : "AI 剪辑助手"}</p>
                        <p className="max-w-[240px] text-[11px] leading-relaxed text-[var(--director-dock-fg)]/50">
                            {mode === "director" ? "分析素材、梳理叙事、挑选镜头、衔接声音与字幕。先查看成片方案，再一键应用到时间线。" : "分析实际素材画面、字幕和声音，再根据你的意图生成剪辑方案。数量超过 3 条时确认后执行。"}
                        </p>
                        <div className="flex max-w-[260px] flex-wrap items-center justify-center gap-1.5">
                            {(mode === "director" ? ["按当前成片要求生成完整剪辑方案", "突出开场悬念，保留人物反应和完整对白", "删去冗余，按情绪递进剪出完整故事"] : SUGGESTED_PROMPTS).map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    disabled={!ready || busy}
                                    onClick={() => void send(s)}
                                    className="rounded-full border border-[var(--director-sequencer-border)] px-2 py-1 text-[10px] text-[var(--director-dock-fg)]/70 transition-colors hover:border-[var(--director-accent)] hover:text-[var(--director-accent)] disabled:opacity-40"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {entries.map((entry) => {
                    if (entry.kind === "director") {
                        const summary = entry.compilation.summary;
                        return <div key={entry.id} className="w-full rounded-xl border border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] p-3 text-[11px] text-[var(--director-dock-fg)]">
                            <p className="font-medium text-[var(--director-dock-fg-strong)]">{summary.title}</p>
                            <p className="mt-1">{summary.shotCount} 个镜头 · {(summary.durationMs / 1000).toFixed(1)} 秒 · {summary.subtitleCount} 条字幕</p>
                            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{entry.compilation.plan.reasoning}</p>
                            <ol aria-label="成片镜头清单" className="my-2 max-h-48 space-y-2 overflow-y-auto">
                                {summary.shots.map((shot, index) => <li key={index} className="border-l-2 border-[var(--director-sequencer-border)] pl-2"><span className="font-medium">{index + 1}. {shot.title} · {(shot.startMs / 1000).toFixed(1)}–{((shot.startMs + shot.durationMs) / 1000).toFixed(1)} 秒</span><p className="mt-0.5 text-[var(--director-dock-fg)]/65">{shot.purpose}</p></li>)}
                            </ol>
                            {summary.warnings.length > 0 && <details className="mb-2 text-[var(--director-warning)]"><summary>方案提醒（{summary.warnings.length}）</summary>{summary.warnings.map((warning, index) => <p key={index} className="mt-1">{warning}</p>)}</details>}
                            <p className="mb-2 text-[var(--director-dock-fg)]/60">确认后重新编排时间线，原始素材保留，可整批撤销。</p>
                            <div className="flex flex-wrap justify-end gap-2">
                                <button type="button" disabled={busy} onClick={() => dropEntry(entry.id)} className="rounded-md border border-[var(--director-sequencer-border)] px-2 py-1">放弃方案</button>
                                <button type="button" disabled={busy} onClick={() => void applyDirector(entry.id, false)} className="rounded-md bg-[var(--director-accent)] px-2 py-1 text-[var(--director-on-accent)]">应用并预览</button>
                                {host.openExport && <button type="button" disabled={busy} onClick={() => void applyDirector(entry.id, true)} className="rounded-md border border-[var(--director-sequencer-border)] px-2 py-1">应用并打开导出</button>}
                            </div>
                        </div>;
                    }
                    if (entry.kind === "user") {
                        return (
                            <div
                                key={entry.id}
                                className="max-w-[86%] self-end whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-[var(--director-accent)] px-2.5 py-1.5 text-xs leading-relaxed text-[var(--director-on-accent)]"
                            >
                                {entry.text}
                            </div>
                        );
                    }
                    if (entry.kind === "assistant") {
                        return (
                            <div
                                key={entry.id}
                                className="max-w-[92%] self-start whitespace-pre-wrap break-words rounded-xl rounded-bl-sm border border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--director-dock-fg)]"
                            >
                                {entry.text || (
                                    <span className="inline-flex items-center gap-1.5 text-[var(--director-dock-fg)]/60">
                                        <Loader2 className="size-3 animate-spin" />
                                        思考中…
                                    </span>
                                )}
                            </div>
                        );
                    }
                    if (entry.kind === "error") {
                        return (
                            <div
                                key={entry.id}
                                className="max-w-[92%] self-start overflow-hidden rounded-xl rounded-bl-sm border border-[var(--director-danger)]/40 bg-[var(--director-danger)]/10 px-2.5 py-1.5"
                            >
                                <div className="flex items-start gap-1.5">
                                    <ShieldAlert className="mt-0.5 size-3 shrink-0 text-[var(--director-danger)]" />
                                    <div className="min-w-0">
                                        <p className="text-[11px] leading-relaxed text-[var(--director-danger)]">
                                            {entry.text}
                                        </p>
                                        {entry.retry && (
                                            <button
                                                type="button"
                                                onClick={() => retry(entry.id)}
                                                disabled={busy}
                                                className="mt-1 inline-flex items-center gap-1 rounded border border-[var(--director-sequencer-border)] px-1.5 py-0.5 text-[10px] text-[var(--director-dock-fg)]/80 hover:bg-[var(--director-control-hover)] disabled:opacity-40"
                                            >
                                                <RotateCcw className="size-2.5" />
                                                修正后重试
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    }
                    return (
                        <div
                            key={entry.id}
                            className="max-w-[92%] self-start overflow-hidden rounded-xl rounded-bl-sm border border-[var(--director-warning)]/40 bg-[var(--director-warning)]/10"
                        >
                            <p className="border-b border-[var(--director-warning)]/25 px-2.5 py-1.5 text-[11px] font-medium text-[var(--director-dock-fg)]">
                                {PREVIEW_HEAD}
                            </p>
                            <div className="max-h-44 overflow-y-auto px-2.5 py-1.5">
                                {entry.plan.commands.map((cmd, i) => (
                                    <p
                                        key={i}
                                        className="py-0.5 font-mono text-[10px] leading-relaxed text-[var(--director-dock-fg)]/80"
                                    >
                                        {commandLine(cmd, i)}
                                    </p>
                                ))}
                            </div>
                            <div className="flex items-center justify-end gap-1.5 border-t border-[var(--director-warning)]/25 px-2.5 py-1.5">
                                <button
                                    type="button"
                                    onClick={() => dropPreview(entry.id)}
                                    disabled={busy}
                                    className="rounded-md border border-[var(--director-sequencer-border)] px-2 py-1 text-[10px] text-[var(--director-dock-fg)]/80 hover:bg-[var(--director-control-hover)] disabled:opacity-40"
                                >
                                    放弃
                                </button>
                                <button
                                    type="button"
                                    onClick={() => confirmPreview(entry.id)}
                                    disabled={busy}
                                    className="flex items-center gap-1 rounded-md bg-[var(--director-accent)] px-2 py-1 text-[10px] font-medium text-[var(--director-on-accent)] hover:bg-[var(--director-accent-hover)] disabled:opacity-40"
                                >
                                    确认执行（{entry.plan.commands.length}）
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--director-sequencer-border)] p-2.5">
                <textarea
                    rows={2}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void send();
                        }
                    }}
                    disabled={!ready || busy}
                    placeholder={placeholder}
                    className="min-w-0 flex-1 resize-none rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] px-2 py-1.5 text-xs text-[var(--director-dock-fg)] placeholder:text-[var(--director-dock-fg)]/40 focus:border-[var(--director-accent)] focus:outline-none disabled:opacity-50"
                />
                <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!canSend}
                    aria-label={modelValue ? "发送" : "无可用文本模型"}
                    title={modelValue ? "发送" : "请先选择文本模型"}
                    className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--director-accent)] text-[var(--director-on-accent)] hover:bg-[var(--director-accent-hover)] disabled:opacity-40"
                >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                </button>
            </div>
        </div>
    );
}
