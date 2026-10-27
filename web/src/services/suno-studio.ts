import { createClientId } from "@/lib/client-id";
import { buildSunoRequest, sunoOperation } from "@/lib/suno-contract";
import { getActiveUserScope } from "@/lib/user-scope";
import { ChannelResponseError } from "@/services/api/channel-transport";
import { http } from "@/services/api/request";
import { getResource, getResourceUpstreamUrl, importResourceFromUrl, resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { requestSunoOperation, SunoApiRejection, sunoBaseUrl, type SunoReply } from "@/services/api/suno";
import { downloadOwnedOrBrowserMedia, isWailsNativeShell } from "@/services/desktop-media-save";
import { resolveMediaUrl } from "@/services/file-storage";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { channelHasGenerationCredential, useConfigStore, type ModelChannel } from "@/stores/use-config-store";
import { addSunoStudioJob, flushSunoStudioPersistence, sunoStudioSnapshot, updateSunoStudioJob, useSunoStudioStore, type SunoCanvasSource, type SunoStudioClip, type SunoStudioJob } from "@/stores/use-suno-studio-store";

const submissions = new Map<string, Promise<string>>();
const observations = new Map<string, Promise<void>>();
const imports = new Map<string, Promise<void>>();
const nextPolls = new Map<string, { after: number; failures: number }>();

export function sunoStudioChannels() {
    return useConfigStore.getState().config.channels.filter((channel) => channel.enabled !== false && channel.scope !== "system" && !channel.credentialRef && !/eggfans-sd2|jiasu-video/i.test(`${channel.id} ${channel.interfaceType}`));
}

function selectedChannel(id: string, expectedBaseUrl?: string): ModelChannel {
    const channel = sunoStudioChannels().find((item) => item.id === id);
    if (!channel) throw new Error("请在模型配置中设置 Suno 渠道，并在音乐导演台选择该渠道");
    if (!channelHasGenerationCredential(channel)) throw new Error("请在模型配置中填写此渠道的 API Key");
    if (expectedBaseUrl && sunoBaseUrl(channel.baseUrl) !== expectedBaseUrl) throw new Error("该任务的渠道地址已变更，请恢复原地址后查询，未向其他渠道发送任务");
    return channel;
}

function transportConfig(channel: ModelChannel) {
    return { baseUrl: sunoBaseUrl(channel.baseUrl), apiKey: channel.apiKey, apiFormat: "openai" as const, headers: channel.headers };
}

function activeScope() {
    const state = useSunoStudioStore.getState();
    if (!state.hydrated || state.scope !== getActiveUserScope()) throw new Error("音乐工作区尚未就绪");
    return state.scope;
}

function jobFor(scope: string, id: string) {
    const job = sunoStudioSnapshot(scope).jobs.find((item) => item.id === id);
    if (!job) throw new Error("音乐任务不存在");
    return job;
}

function mergeClips(previous: SunoStudioClip[], incoming: SunoStudioClip[]) {
    const clips = new Map(previous.map((clip) => [clip.id, clip]));
    for (const clip of incoming) {
        const defined = Object.fromEntries(Object.entries(clip).filter(([, value]) => value !== undefined));
        clips.set(clip.id, { ...clips.get(clip.id), ...defined } as SunoStudioClip);
    }
    return [...clips.values()];
}

async function applyReply(scope: string, id: string, reply: SunoReply, submitted = false) {
    const job = jobFor(scope, id);
    const operation = sunoOperation(job.operationId);
    const status = reply.status || (operation.poll !== "none" && reply.taskId ? "queued" : "succeeded");
    if (submitted && operation.poll !== "none" && !reply.status && !reply.taskId) throw new Error("Suno 提交返回缺少任务 ID，接单结果未确认，请核对渠道任务记录");
    await updateSunoStudioJob(scope, id, { taskId: reply.taskId || job.taskId, taskIds: reply.taskIds || job.taskIds, status, result: reply.result, clips: mergeClips(job.clips, reply.clips), error: reply.error, syncError: undefined });
}

export function submitSunoStudioOperation(): Promise<string> {
    const scope = activeScope();
    const existing = submissions.get(scope);
    if (existing) return existing;
    const pending = submit(scope).finally(() => { if (submissions.get(scope) === pending) submissions.delete(scope); });
    submissions.set(scope, pending);
    return pending;
}

async function submit(scope: string) {
    const draft = structuredClone(sunoStudioSnapshot(scope).draft);
    const channel = selectedChannel(draft.channelId);
    const operation = sunoOperation(draft.operationId);
    buildSunoRequest(operation.id, draft.values);
    await flushSunoStudioPersistence(scope);
    const now = new Date().toISOString();
    const job: SunoStudioJob = { id: createClientId(), channelId: channel.id, baseUrl: sunoBaseUrl(channel.baseUrl), operationId: operation.id, label: operation.label, values: draft.values, source: draft.source, canvasSource: draft.canvasSource, status: "submitting", clips: [], createdAt: now, updatedAt: now };
    await addSunoStudioJob(scope, job);
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，未提交音乐任务");
    try {
        const reply = await requestSunoOperation(transportConfig(channel), operation.id, draft.values);
        await applyReply(scope, job.id, reply, true);
    } catch (error) {
        const accepted = jobFor(scope, job.id).taskId;
        const rejected = error instanceof SunoApiRejection || (error instanceof ChannelResponseError && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408);
        await updateSunoStudioJob(scope, job.id, accepted
            ? { syncError: "已取得任务 ID，但本地结果保存未完成，请恢复存储后查询原任务" }
            : { status: rejected ? "failed" : "unknown", error: rejected ? errorMessage(error) : undefined, syncError: rejected ? undefined : "提交结果未确认，请核对渠道任务记录，勿重复提交" });
        throw error;
    }
    await importCompletedClips(scope, job.id);
    return job.id;
}

export function refreshSunoStudioJob(id: string): Promise<void> {
    const scope = activeScope();
    const key = `${scope}:${id}`;
    const existing = observations.get(key);
    if (existing) return existing;
    const pending = refresh(scope, id).finally(() => { if (observations.get(key) === pending) observations.delete(key); });
    observations.set(key, pending);
    return pending;
}

async function refresh(scope: string, id: string) {
    const job = jobFor(scope, id);
    if (!job.taskId) throw new Error("未取得上游任务 ID，无法自动查询；请从渠道任务记录复制 ID 到查询任务入口");
    try {
        const channel = selectedChannel(job.channelId, job.baseUrl);
        const mp4 = sunoOperation(job.operationId).poll === "mp4" || job.operationId === "get-suno-act-mp4-state";
        const batch = job.operationId === "post-suno-fetch";
        const operationId = batch ? "post-suno-fetch" : mp4 ? "get-suno-act-mp4-state" : "get-suno-fetch-id";
        const values = batch ? { ids: job.taskIds || job.values.ids, action: job.values.action } : mp4 ? { taskBatchId: job.taskId } : { id: job.taskId };
        const reply = await requestSunoOperation(transportConfig(channel), operationId, values);
        if (!reply.status && !reply.clips.length) {
            await updateSunoStudioJob(scope, id, { result: reply.result, syncError: "查询响应尚未包含明确任务状态，继续保留原任务" });
        } else await applyReply(scope, id, { ...reply, taskId: job.taskId });
        nextPolls.set(`${scope}:${id}`, { failures: 0, after: Date.now() + 5000 });
        await importCompletedClips(scope, id);
    } catch (error) {
        const key = `${scope}:${id}`;
        const failures = (nextPolls.get(key)?.failures || 0) + 1;
        nextPolls.set(key, { failures, after: Date.now() + Math.min(5000 * 2 ** Math.min(failures, 4), 60_000) });
        await updateSunoStudioJob(scope, id, { syncError: `任务状态暂未同步：${errorMessage(error)}。未判定上游失败，不会重新提交` });
        throw error;
    }
}

export async function recoverSunoStudioJobs() {
    const scope = activeScope();
    const jobs = sunoStudioSnapshot(scope).jobs.filter((job) => job.taskId && ["queued", "running", "unknown", "submitting"].includes(job.status));
    for (const job of jobs) {
        if (getActiveUserScope() !== scope) return;
        if ((nextPolls.get(`${scope}:${job.id}`)?.after || 0) > Date.now()) continue;
        await refreshSunoStudioJob(job.id).catch(() => undefined);
    }
}

async function importCompletedClips(scope: string, id: string) {
    const job = jobFor(scope, id);
    if (job.status !== "succeeded" || getActiveUserScope() !== scope) return;
    for (const clip of job.clips) {
        if (getActiveUserScope() !== scope) return;
        if (clip.assetId || (!clip.audioUrl && !clip.videoUrl && !clip.storageKey)) continue;
        try { await importSunoClip(id, clip.id); }
        catch (error) {
            await updateSunoStudioJob(scope, id, { syncError: `生成已成功，但本地素材保存失败：${errorMessage(error)}。可重试保存，无需重新生成` });
        }
    }
}

export function importSunoClip(id: string, clipId: string): Promise<void> {
    const scope = activeScope();
    const key = `${scope}:${id}:${clipId}`;
    const previous = imports.get(key);
    if (previous) return previous;
    const pending = importClip(scope, id, clipId).finally(() => { if (imports.get(key) === pending) imports.delete(key); });
    imports.set(key, pending);
    return pending;
}

async function importClip(scope: string, id: string, clipId: string) {
    const job = jobFor(scope, id);
    const clip = job.clips.find((item) => item.id === clipId);
    if (!clip) throw new Error("音乐片段不存在");
    if (clip.storageKey && clip.assetId) return;
    const url = clip.audioUrl || clip.videoUrl;
    if (!url) throw new Error("该片段尚未返回可下载的媒体地址");
    const kind = clip.audioUrl ? "audio" : "video";
    const resource = clip.storageKey ? await getResource(resourceIdFromStorageKey(clip.storageKey)) : await importResourceFromUrl(url, kind, { durationMs: clip.duration ? Math.round(clip.duration * 1000) : undefined, idempotencyKey: `suno:${scope}:${id}:${clipId}` });
    const storageKey = resourceStorageKey(resource.id);
    const base = { id: `suno-${id}-${clipId}`, title: clip.title, coverUrl: clip.imageUrl || "", tags: clip.tags?.split(",").map((tag) => tag.trim()).filter(Boolean) || [], status: "confirmed" as const, source: "Suno", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: { source: "suno", sunoClipId: clip.id, sunoTaskId: job.taskId, channelId: job.channelId } };
    const data = { url: resourceFileUrl(resource.id), storageKey, durationMs: resource.durationMs || (clip.duration ? Math.round(clip.duration * 1000) : undefined), bytes: resource.size, mimeType: resource.mimeType || (kind === "audio" ? "audio/mpeg" : "video/mp4") };
    const asset: Asset = kind === "audio" ? { ...base, kind: "audio", data } : { ...base, kind: "video", data: { ...data, width: resource.width || 0, height: resource.height || 0 } };
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，未将素材加入当前资产库");
    await http.put(`/assets/${encodeURIComponent(asset.id)}`, { asset });
    if (getActiveUserScope() === scope) {
        useAssetStore.setState((state) => ({ assets: [asset, ...state.assets.filter((item) => item.id !== asset.id)] }));
        await flushAssetStorePersistence();
    }
    const latest = jobFor(scope, id);
    await updateSunoStudioJob(scope, id, { clips: latest.clips.map((item) => item.id === clipId ? { ...item, storageKey, assetId: asset.id } : item), syncError: undefined });
}

export async function uploadSunoReference(file: File) {
    const scope = activeScope();
    if (!file.size || (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.name))) throw new Error("请选择有效的本地音频文件");
    const resource = await uploadResourceFile(file, "audio", { fileName: file.name });
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，未上传到临时图床");
    const storageKey = resourceStorageKey(resource.id);
    const url = await getResourceUpstreamUrl(storageKey);
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，未回填参考链接");
    return { url, storageKey };
}

export async function downloadSunoClip(id: string, clipId: string) {
    const scope = activeScope();
    await importSunoClip(id, clipId);
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，未导出其他工作区的音频");
    const clip = jobFor(scope, id).clips.find((item) => item.id === clipId)!;
    const resourceId = resourceIdFromStorageKey(clip.storageKey);
    const resource = await getResource(resourceId);
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，未导出其他工作区的音频");
    const video = !clip.audioUrl && Boolean(clip.videoUrl);
    const extensions: Record<string, string> = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/flac": "flac", "audio/ogg": "ogg", "audio/aac": "aac", "audio/opus": "opus", "video/mp4": "mp4", "video/webm": "webm" };
    const extension = extensions[resource.mimeType?.split(";", 1)[0]?.trim().toLowerCase()] || (video ? "mp4" : "mp3");
    await downloadOwnedOrBrowserMedia({ fileName: `${clip.title || "Suno"}.${extension}`, resourceId, browserUrl: isWailsNativeShell() ? undefined : await resolveMediaUrl(clip.storageKey) });
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "请求未完成"; }

export async function registerCanvasSunoSource(source: { id?: string; title: string; channelId?: string; taskId?: string; clips: SunoStudioClip[] }, canvasSource: SunoCanvasSource) {
    const scope = activeScope();
    if (!source.channelId || !source.clips.length) throw new Error("该音频缺少 Suno 渠道或曲目 ID，无法作为平台源曲");
    const channel = sunoStudioChannels().find((item) => item.id === source.channelId);
    if (!channel) throw new Error("源曲的 Suno 渠道已移除，请恢复原渠道配置");
    const existing = sunoStudioSnapshot(scope).jobs.find((job) => job.channelId === channel.id && job.taskId === source.taskId && source.clips.every((clip) => job.clips.some((item) => item.id === clip.id)));
    if (existing) return existing.id;
    const now = new Date().toISOString();
    const job: SunoStudioJob = { id: createClientId(), channelId: channel.id, baseUrl: sunoBaseUrl(channel.baseUrl), operationId: "post-suno-submit-music", label: source.title || "画布音乐", status: "succeeded", taskId: source.taskId, createdAt: now, updatedAt: now, values: {}, clips: structuredClone(source.clips), canvasSource };
    await addSunoStudioJob(scope, job);
    return job.id;
}
