import { buildSunoRequest, sunoOperation } from "@/lib/suno-contract";
import { createChannelTransport, type ChannelTransportConfig } from "@/services/api/channel-transport";
import type { SunoStudioClip } from "@/stores/use-suno-studio-store";
import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { getActiveUserScope } from "@/lib/user-scope";

type JsonObject = Record<string, unknown>;
export type SunoReply = { taskId?: string; taskIds?: string[]; status?: "queued" | "running" | "succeeded" | "failed"; clips: SunoStudioClip[]; result: unknown; error?: string };
export class SunoApiRejection extends Error {}

function record(value: unknown): value is JsonObject { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function identifier(value: unknown) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Suno 返回的 ID 精度不安全，请联系接口方以字符串返回 ID");
    return text(value) || (typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "");
}

export function sunoBaseUrl(value = "https://api.eggfans.com") {
    const url = new URL(value.trim() || "https://api.eggfans.com");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Suno Base URL 必须是不含密钥或查询参数的 HTTP(S) 地址");
    url.pathname = url.pathname.replace(/\/(?:v1|suno)\/?$/i, "").replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
}

function redactReply(value: unknown, secret: string): unknown {
    if (typeof value === "string") return secret.length >= 8 ? value.replaceAll(secret, "[已隐藏]") : value;
    if (Array.isArray(value)) return value.map((item) => redactReply(item, secret));
    if (!record(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(api[_-]?key|authorization|headers|cookie|access[_-]?token|secret[_-]?key)$/i.test(key) ? "[已隐藏]" : redactReply(item, secret)]));
}

export function decodeSunoData(value: unknown, depth = 0): unknown {
    if (depth > 10) throw new Error("Suno 返回的数据嵌套过深");
    if (Array.isArray(value)) return value.map((item) => decodeSunoData(item, depth + 1));
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ["data", "result", "output"].includes(key) ? decodeSunoData(child, depth + 1) : child]));
    if (typeof value !== "string") return value;
    let source = value.trim();
    if (!source.startsWith("{") && !source.startsWith("[")) {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(source) || source.length % 4 !== 0) return value;
        try { source = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(source), (character) => character.charCodeAt(0))).trim(); } catch { return value; }
    }
    if (!source.startsWith("{") && !source.startsWith("[")) return value;
    try { return decodeSunoData(JSON.parse(source), depth + 1); } catch { throw new Error("Suno 结果数据无法解析"); }
}

export function parseSunoReply(rawPayload: unknown, secret = ""): SunoReply {
    const payload = redactReply(decodeSunoData(rawPayload), secret);
    if (!record(payload)) throw new Error("Suno 返回了无法解析的响应");
    const code = payload.code;
    if (payload.success === false || payload.error || (code !== undefined && !["success", "ok", "0", "200"].includes(String(code).toLowerCase()))) {
        const error = record(payload.error) ? text(payload.error.message) : text(payload.error);
        throw new SunoApiRejection(error || text(payload.message) || text(payload.msg) || "Suno 接口拒绝了请求");
    }
    const data = payload.data ?? payload;
    const entries = Array.isArray(data) ? data : [data];
    const task = entries.find((entry) => record(entry) && (entry.task_id || entry.taskId || (entry.status && !entry.audio_url && !entry.audioUrl && !entry.cld2AudioUrl && !entry.video_url && !entry.videoUrl))) as JsonObject | undefined;
    const taskIds = [...new Set(entries.filter(record).map((entry) => identifier(entry.task_id ?? entry.taskId)).filter(Boolean))];
    const taskId = identifier((entries.length === 1 ? task?.task_id ?? task?.taskId : undefined) ?? payload.task_id ?? payload.taskId ?? (typeof data === "string" && /^[\w-]+$/.test(data) ? data : undefined));
    const clips = new Map<string, SunoStudioClip>();
    const statuses: string[] = [];
    const inspect = (value: unknown, depth = 0) => {
        if (depth > 7 || value == null) return;
        if (Array.isArray(value)) { for (const child of value) inspect(child, depth + 1); return; }
        if (!record(value)) return;
        if (value.success === false || (value.code !== undefined && !["success", "ok", "0", "200"].includes(String(value.code).toLowerCase()))) throw new SunoApiRejection(text(value.message) || text(value.msg) || "Suno 结果载荷返回业务错误");
        const audioUrl = text(value.audio_url) || text(value.audioUrl) || text(value.cld2AudioUrl);
        const videoUrl = text(value.video_url) || text(value.videoUrl);
        const id = identifier(value.clip_id ?? value.clipId ?? value.id);
        if (text(value.status)) statuses.push(text(value.status).toLowerCase());
        if (id && (audioUrl || videoUrl)) {
            const metadata = record(value.metadata) ? value.metadata : {};
            const duration = Number(value.duration ?? metadata.duration);
            clips.set(id, { id, title: text(value.title) || text(metadata.title) || "未命名音乐", audioUrl: publicMediaUrl(audioUrl), videoUrl: publicMediaUrl(videoUrl), imageUrl: publicMediaUrl(text(value.image_url) || text(value.imageUrl) || text(value.cld2ImageUrl)), duration: Number.isFinite(duration) && duration >= 0 ? duration : undefined, lyrics: text(value.prompt) || text(value.lyrics) || text(metadata.prompt), tags: text(value.tags) || text(metadata.tags) });
        }
        for (const key of ["data", "clips", "songs", "results", "result", "output", "music"]) inspect(value[key], depth + 1);
    };
    inspect(data);
    const rootStatuses = entries.filter(record).map((entry) => text(entry.status).toLowerCase()).filter(Boolean);
    const rawStatus = entries.length === 1 ? text(task?.status).toLowerCase() : "";
    const failed = ["failed", "failure", "error", "cancelled", "canceled", "expired"];
    const succeeded = ["success", "succeeded", "complete", "completed", "done"];
    let status: SunoReply["status"];
    if (entries.length > 1 && rootStatuses.length === entries.length) {
        const terminal = rootStatuses.every((state) => failed.includes(state) || succeeded.includes(state));
        status = terminal ? rootStatuses.some((state) => failed.includes(state)) ? "failed" : "succeeded" : "running";
    } else if (failed.includes(rawStatus) || (!rawStatus && statuses.some((state) => failed.includes(state)))) status = "failed";
    else if (succeeded.includes(rawStatus) || (clips.size > 0 && (!statuses.length || statuses.every((state) => succeeded.includes(state))))) status = "succeeded";
    else if (["submitted", "pending", "queueing", "queued", "waiting"].includes(rawStatus)) status = "queued";
    else if (rawStatus || taskId || statuses.length) status = "running";
    const failures = entries.filter(record).filter((entry) => failed.includes(text(entry.status).toLowerCase())).map((entry) => text(entry.fail_reason) || text(entry.error_message) || text(entry.error)).filter(Boolean);
    return { taskId: taskId || undefined, taskIds: taskIds.length ? taskIds : undefined, status, clips: [...clips.values()], result: data, error: status === "failed" ? failures.join("；") || text(payload.message) || "Suno 上游任务失败" : undefined };
}

function publicMediaUrl(value: string) {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined;
    } catch { return undefined; }
}

export async function requestSunoOperation(config: ChannelTransportConfig, operationId: string, values: Record<string, unknown>, signal?: AbortSignal): Promise<SunoReply> {
    const scope = getActiveUserScope();
    const request = buildSunoRequest(operationId, values);
    const transport = createChannelTransport(config, "audio");
    const url = sunoBaseUrl(config.baseUrl) + request.path;
    const options = { signal, allowBusinessErrorPayload: true };
    let payload: unknown;
    if (operationId === "get-suno-act-wav-clip-id") {
        const response = await transport.getBlob(url, options);
        if (response instanceof Blob) {
            const prefix = await response.slice(0, 256).text();
            if (/^\s*[{[]/.test(prefix)) payload = JSON.parse(await response.text());
            else {
                if (!prefix.startsWith("RIFF") || prefix.slice(8, 12) !== "WAVE") throw new Error("Suno WAV 接口未返回有效 WAV 音频");
                if (getActiveUserScope() !== scope) throw new Error("账号已切换，未保存其他工作区的音频");
                const resource = await uploadResourceFile(new File([response], `suno-${String(values.clip_id)}.wav`, { type: "audio/wav" }), "audio");
                const clip: SunoStudioClip = { id: String(values.clip_id), title: "Suno WAV", audioUrl: resourceFileUrl(resource.id), storageKey: resourceStorageKey(resource.id) };
                return { clips: [clip], status: "succeeded", result: { clip_id: clip.id, storageKey: clip.storageKey, mimeType: "audio/wav" } };
            }
        } else payload = response;
    } else payload = request.method === "GET" ? await transport.get(url, options) : await transport.postJson(url, request.body, options);
    const reply = parseSunoReply(payload, config.apiKey);
    const taskQuery = ["get-suno-fetch-id", "post-suno-fetch", "get-suno-act-mp4-state"].includes(operationId);
    if (sunoOperation(operationId).poll === "none" && !taskQuery) {
        const explicitTask = record(reply.result) && (reply.result.task_id || reply.result.taskId);
        const submittedId = request.method === "POST" && (explicitTask || (typeof reply.result === "string" && /^\d{15,}$/.test(reply.result)));
        if (!submittedId) return { ...reply, taskId: undefined, taskIds: undefined, status: reply.status === "failed" ? "failed" : "succeeded" };
    }
    if (operationId === "post-suno-fetch") {
        const ids = values.ids as string[];
        const complete = Array.isArray(reply.result) && reply.result.length === ids.length;
        return { ...reply, taskId: ids[0], taskIds: [...ids], status: complete ? reply.status : "running" };
    }
    if (operationId === "get-suno-fetch-id") return { ...reply, taskId: reply.taskId || String(values.id), status: reply.status || "running" };
    if (operationId === "get-suno-act-mp4-state") return { ...reply, taskId: reply.taskId || String(values.taskBatchId), status: reply.status || "running" };
    return reply;
}
