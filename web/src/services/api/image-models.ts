import { sanitizeChannelModelCatalogItem, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import { isNativeDesktopRuntime } from "@/lib/runtime-mode";
import { captureUserScope, isUserScopeAbandonedError, UserScopeAbandonedError } from "@/lib/user-scope-guard";
import { getBeefAPIConnectionEpoch } from "@/services/api/beefapi-connection";
import { createChannelTransport } from "@/services/api/channel-transport";
import { readAxiosError, validateGeminiPayload } from "@/services/api/image-response";
import { geminiApiUrl, geminiHeaders } from "@/services/api/image-transport";
import { ApiError, http } from "@/services/api/request";
import { sanitizeVideoBilling } from "@/lib/video-billing";
import { buildApiUrl, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};

type GeminiModelPayload = { models?: Array<{ name?: string }> };
type OpenAIModelRecord = {
    id?: string;
    name?: string;
    model_name?: string;
    display_name?: string;
    model_type?: string;
    show_image_upload?: number;
    supported_endpoint_types?: string[];
    video_capabilities?: unknown;
    video_capabilities_version?: string;
    video_pricing?: unknown;
    video_billing?: unknown;
    quota_type?: number;
    model_price?: number;
};
type OpenAIModelPayload = { data?: OpenAIModelRecord[]; error?: { message?: string } };
type ModelCatalogConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat"> & { headers?: ModelChannel["headers"] };

async function fetchOpenAIModelCatalog(config: ModelCatalogConfig, catalogUrl?: string) {
    const payload = await createChannelTransport(config, "image").get<OpenAIModelPayload>(catalogRequestUrl(config.baseUrl, catalogUrl));
    return (payload.data || [])
        .map((model) =>
            sanitizeChannelModelCatalogItem({
                id: model.id || model.name || model.model_name,
                displayName: model.display_name || model.name || model.model_name,
                modelType: normalizeEggfansModelType(model.model_type),
                supportsImages: model.show_image_upload ? true : undefined,
                supportedEndpointTypes: model.supported_endpoint_types,
                videoCapabilities: model.video_capabilities,
                videoCapabilitiesVersion: model.video_capabilities_version,
                videoPricing: model.video_pricing,
                ...((model.supported_endpoint_types || []).includes("openai-video") ? { videoBilling: model.video_billing !== undefined ? sanitizeVideoBilling(model.video_billing, model.quota_type, model.model_price) : sanitizeVideoBilling(null, model.quota_type, model.model_price) } : {}),
            }),
        )
        .filter((item): item is ChannelModelCatalogItem => Boolean(item));
}

export async function fetchImageModels(config: ModelCatalogConfig) {
    try {
        if (config.apiFormat === "gemini") {
            const requestConfig = { ...defaultGeminiConfig, ...config };
            const payload = await createChannelTransport(requestConfig, "image").get<GeminiModelPayload>(geminiApiUrl(requestConfig), { headers: geminiHeaders(requestConfig) });
            validateGeminiPayload(payload);
            return (payload.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const catalog = await fetchOpenAIModelCatalog(config);
        return catalog.map((model) => model.id).sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export type ChannelModelFetchResult = { models: string[]; catalog: ChannelModelCatalogItem[] };

export async function fetchChannelModels(channel: ModelChannel, viaBackend = false): Promise<ChannelModelFetchResult> {
    const expectedScope = captureUserScope();
    const connectionEpoch = getBeefAPIConnectionEpoch();
    if (channel.id === "eggfans-sd2" && channel.presetVersion && !channel.catalogUrl?.trim()) {
        const catalog: ChannelModelCatalogItem[] = channel.models.map((id) => ({ id, modelType: "video" }));
        return { models: [...channel.models], catalog };
    }
    const managed = channel.id === "beefapi" && (channel.pinned || Boolean(channel.credentialRef));
    if (managed) {
        viaBackend = true;
    }
    // 桌面端（Mac 的 wails: 协议，或 Windows 的 wails.localhost 回环地址）里由网页直连上游
    // 会卡住不返回；这里统一改走同源后端代取，与浏览器行为一致，也顺带绕开上游 CORS 依赖。
    if (isNativeDesktopRuntime()) {
        viaBackend = true;
    }
    if (!viaBackend) {
        if (channel.apiFormat !== "gemini") {
            const catalog = filterChannelCatalog(channel, await fetchOpenAIModelCatalog(channel, channel.catalogUrl)).sort((a, b) => a.id.localeCompare(b.id));
            return { models: catalog.map((item) => item.id).sort((a, b) => a.localeCompare(b)), catalog };
        }
        const models = await fetchImageModels(channel);
        return { models, catalog: models.map((id) => ({ id })) };
    }
    try {
        // 登录态由同源后端代取模型目录，避免每个 OpenAI 兼容服务分别维护浏览器 CORS 白名单。
        const result = await http.post<{ models?: Array<string | ChannelModelCatalogItem> }>(managed ? "/beefapi/connection/models" : "/ai/models", managed ? {} : {
            baseUrl: channel.baseUrl,
            catalogUrl: channel.catalogUrl,
            apiKey: managed ? "" : channel.apiKey,
            apiFormat: channel.apiFormat,
            headers: channel.headers,
            channelId: managed ? channel.id : undefined,
            credentialRef: managed ? "beefapi-enterprise" : undefined,
        }, { timeout: 30_000, expectedScope });
        if (managed && connectionEpoch !== getBeefAPIConnectionEpoch()) throw new UserScopeAbandonedError();
        const catalog = new Map<string, ChannelModelCatalogItem>();
        for (const item of result.models || []) {
            const entry = typeof item === "string" ? sanitizeChannelModelCatalogItem({ id: item }) : sanitizeChannelModelCatalogItem(item);
            if (!entry) continue;
            const existing = catalog.get(entry.id);
            catalog.set(entry.id, existing || entry);
        }
        const filteredCatalog = filterChannelCatalog(channel, Array.from(catalog.values()));
        const models = filteredCatalog.map((item) => item.id).sort((a, b) => a.localeCompare(b));
        const sortedCatalog = filteredCatalog.sort((a, b) => a.id.localeCompare(b.id));
        return { models, catalog: sortedCatalog };
    } catch (error) {
        // The backend has already classified and sanitized catalogue errors.
        // Running generation-error classification again turns a precise 502
        // auth/unsupported-catalog message into a generic unavailable message.
        if (error instanceof ApiError || isUserScopeAbandonedError(error)) throw error;
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

function isJiasuVideoChannel(channel: ModelChannel) {
    return channel.id === "jiasu-video" || channel.interfaceType === "jiasu-video";
}

function isJiasuVideoCatalogItem(item: ChannelModelCatalogItem) {
    return (item.supportedEndpointTypes || []).some((endpoint) => endpoint.trim().toLowerCase() === "openai-video");
}

function filterChannelCatalog(channel: ModelChannel, items: ChannelModelCatalogItem[]) {
    const catalog = new Map<string, ChannelModelCatalogItem>();
    for (const item of items) {
        if (isJiasuVideoChannel(channel) && !isJiasuVideoCatalogItem(item)) continue;
        if (!catalog.has(item.id)) catalog.set(item.id, isJiasuVideoChannel(channel) ? { ...item, modelType: "video" } : item);
    }
    return Array.from(catalog.values());
}

function catalogRequestUrl(baseUrl: string, catalogUrl?: string) {
    const configured = catalogUrl?.trim();
    if (!configured) return buildApiUrl(baseUrl, "/models");
    if (/^https:\/\/api\.eggfans\.com\/pricing\/?$/i.test(configured)) return "https://api.eggfans.com/api/pricing_new";
    if (/^https:\/\/(?:ai\.jiasuapi\.com|www\.gway\.dev)\/pricing\/?$/i.test(configured)) return "https://www.gway.dev/api/pricing?surface=plaza";
    if (configured.startsWith("/")) return buildApiUrl(baseUrl, configured);
    return configured;
}

function normalizeEggfansModelType(value?: string) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["text", "image", "video", "audio"].includes(normalized)) return normalized;
    if (["对话", "文本", "聊天", "chat", "conversation", "embedding", "embeddings"].includes(normalized)) return "text";
    if (["图片", "图像", "图像生成", "image generation"].includes(normalized)) return "image";
    if (normalized === "音视频") return "audio";
    if (["视频", "视频生成", "video generation"].includes(normalized)) return "video";
    if (["音频", "语音", "音频生成", "audio generation"].includes(normalized)) return "audio";
    return undefined;
}
