import { sanitizeChannelModelCatalogItem, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import { isNativeDesktopRuntime } from "@/lib/runtime-mode";
import { createChannelTransport } from "@/services/api/channel-transport";
import { readAxiosError, validateGeminiPayload } from "@/services/api/image-response";
import { geminiApiUrl, geminiHeaders } from "@/services/api/image-transport";
import { http } from "@/services/api/request";
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
                modelType: normalizeEggfansModelType(model.model_type, model.show_image_upload),
                supportsImages: model.show_image_upload ? true : undefined,
                supportedEndpointTypes: model.supported_endpoint_types,
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
            const catalog = await fetchOpenAIModelCatalog({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat, headers: channel.headers }, channel.catalogUrl);
            return { models: catalog.map((item) => item.id).sort((a, b) => a.localeCompare(b)), catalog };
        }
        const models = await fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
        return { models, catalog: models.map((id) => ({ id })) };
    }
    try {
        // 登录态由同源后端代取模型目录，避免每个 OpenAI 兼容服务分别维护浏览器 CORS 白名单。
        const result = await http.post<{ models?: Array<string | ChannelModelCatalogItem> }>("/ai/models", {
            baseUrl: channel.baseUrl,
            catalogUrl: channel.catalogUrl,
            apiKey: managed ? "" : channel.apiKey,
            apiFormat: channel.apiFormat,
            headers: channel.headers,
            channelId: managed ? channel.id : undefined,
            credentialRef: managed ? "beefapi-enterprise" : undefined,
        });
        const catalog = new Map<string, ChannelModelCatalogItem>();
        for (const item of result.models || []) {
            const entry = typeof item === "string" ? sanitizeChannelModelCatalogItem({ id: item }) : sanitizeChannelModelCatalogItem(item);
            if (!entry) continue;
            const existing = catalog.get(entry.id);
            catalog.set(entry.id, existing || entry);
        }
        const models = Array.from(catalog.keys()).sort((a, b) => a.localeCompare(b));
        const sortedCatalog = Array.from(catalog.values()).sort((a, b) => a.id.localeCompare(b.id));
        return { models, catalog: sortedCatalog };
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

function catalogRequestUrl(baseUrl: string, catalogUrl?: string) {
    const configured = catalogUrl?.trim();
    if (!configured) return buildApiUrl(baseUrl, "/models");
    if (/^https:\/\/api\.eggfans\.com\/pricing\/?$/i.test(configured)) return "https://api.eggfans.com/api/pricing_new";
    if (configured.startsWith("/")) return buildApiUrl(baseUrl, configured);
    return configured;
}

function normalizeEggfansModelType(value?: string, showImageUpload?: number) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["text", "image", "video", "audio"].includes(normalized)) return normalized;
    if (["对话", "文本", "聊天", "chat", "conversation", "embedding", "embeddings"].includes(normalized)) return "text";
    if (["图片", "图像", "图像生成", "image generation"].includes(normalized) || showImageUpload) return "image";
    if (normalized === "音视频") return "audio";
    if (["视频", "视频生成", "video generation"].includes(normalized)) return "video";
    if (["音频", "语音", "音频生成", "audio generation"].includes(normalized)) return "audio";
    return undefined;
}
