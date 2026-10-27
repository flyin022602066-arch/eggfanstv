import type { ModelChannel } from "@/stores/use-config-store";
import { isEggfansSeedanceProtocol } from "@/lib/eggfans-seedance";

import { inferProtocolFromModelName } from "@/lib/model-protocol-inference";

export type ModelProtocol = string;
export type ProtocolCapability = "text" | "image" | "video" | "audio";
export type ModelProtocolWorkflow = { id: string; label: string; providerId: string; capability: ProtocolCapability; parameters: Array<{ name: string; type: string; required?: boolean; description?: string; values?: string[]; mapping?: string }>; defaults?: Record<string, string | number | boolean> };
export type ModelProtocolDefinition = { value: ModelProtocol; label: string; vendor?: string; capability: ProtocolCapability; create: string; contentType: string; poll?: string; media: string; enabled?: boolean; baseUrl?: string; workflows?: ModelProtocolWorkflow[] };

export function protocolGroups(protocols: ModelProtocolDefinition[]) {
    return (["text", "image", "video", "audio"] as ProtocolCapability[]).map((capability) => ({ label: { text: "文本", image: "图片", video: "视频", audio: "音频" }[capability], options: protocols.filter((item) => item.capability === capability && item.enabled !== false).map((item) => ({ label: `${item.label} · ${item.create.replace(/^POST /, "")}`, value: item.value })) }));
}
export function modelProtocolDefinition(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return definitions.find((item) => item.value === value); }
export function modelProtocolLabel(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return modelProtocolDefinition(value, definitions)?.label || (value ? value : "未安装协议"); }
export function modelProtocolCapability(value: string | undefined, definitions: ModelProtocolDefinition[] = []): ProtocolCapability | undefined {
    const configured = modelProtocolDefinition(value, definitions)?.capability;
    if (configured || !value) return configured;
    return (Object.keys(BUILTIN_PROTOCOL_CAPABILITIES) as ProtocolCapability[]).find((capability) => BUILTIN_PROTOCOL_CAPABILITIES[capability].includes(value));
}
export function isVolcengineArkImageProtocol(protocol?: string) {
    return protocol === "volcengine-ark-image" || protocol === "volcengine-ark-agent-plan-image";
}
export function isVolcengineArkVideoProtocol(protocol?: string) {
    // ark-task-gateway-video 面向中转网关：body 与官方 Ark 相同，
    // 只是路径前缀落在 /v1 下（见 video-provider-seedance.ts 的 seedanceApiUrl）。
    // ark-task-gateway-video-25 是同网关的 Seedance 2.5 专用协议（顶层 prompt + /v1/videos 查询）。
    return protocol === "volcengine-ark-video" || protocol === "volcengine-ark-agent-plan-video" || protocol === "ark-task-gateway-video" || protocol === "ark-task-gateway-video-25" || protocol === "mints-seedance-video" || isEggfansSeedanceProtocol(protocol);
}
export function protocolForModelCatalog(_endpointTypes: string[] = []): ModelProtocol | undefined {
    // A provider catalog cannot invent a protocol ID. The channel's selected
    // plugin or an explicit model configuration must supply it.
    return undefined;
}
export function modelProtocolSummary(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { const protocol = modelProtocolDefinition(value, definitions); return protocol ? [protocol.create, protocol.contentType, protocol.poll, protocol.media].filter(Boolean).join(" · ") : "当前协议未安装或尚未选择。"; }
export function normalizeModelProtocol(value: unknown): ModelProtocol | undefined {
    const protocol = typeof value === "string" && value.trim() ? value.trim() : undefined;
    return protocol === "google-gemini-generate-content" ? "gemini-generate-content" : protocol;
}

const STANDARD_PROTOCOLS: Record<ProtocolCapability, ModelProtocol[]> = {
    text: ["chat-completion", "openai-response"],
    image: ["openai-image"],
    video: ["newapi-channel-2", "newapi"],
    audio: ["openai-audio"],
};

const BUILTIN_PROTOCOL_CAPABILITIES: Record<ProtocolCapability, ModelProtocol[]> = {
    text: [...STANDARD_PROTOCOLS.text, "gemini-api", "claude-api"],
    image: [...STANDARD_PROTOCOLS.image, "gemini-image", "grok-image", "volcengine-ark-image", "volcengine-ark-agent-plan-image", "volcengine-jimeng-image"],
    video: [...STANDARD_PROTOCOLS.video, "newapi-channel-1", "eggfans-sd2-video", "jiasu-video", "mints-seedance-video", "eggfans-seedance-video", "eggfans-volc-video", "gemini-veo", "volcengine-ark-video", "volcengine-ark-agent-plan-video", "volcengine-jimeng-video", "ark-task-gateway-video", "ark-task-gateway-video-25", "novita-video", "minimax-video", "xai-video"],
    audio: [...STANDARD_PROTOCOLS.audio, "async-audio"],
};

export function isNonConversationModelName(model: string) {
    return /(?:^|[\/_-])(?:embeddings?\d*|rerank(?:er)?|moderation|bge)(?:[\/_-]|$)/i.test(model);
}

const FALLBACK_PROTOCOLS: Record<ProtocolCapability, ModelProtocol> = {
    text: "chat-completion",
    image: "openai-image",
    video: "newapi-channel-2",
    audio: "openai-audio",
};

export function inferProtocolCapabilityFromModel(model: string): ProtocolCapability {
    const lower = model.toLowerCase();
    if (
        lower.includes("audio") ||
        lower.includes("tts") ||
        lower.includes("voice") ||
        lower.includes("speech") ||
        lower.includes("sound") ||
        lower.includes("music") ||
        /^(?:suno|chirp)(?:[-_]|$)/u.test(lower)
    ) {
        return "audio";
    }
    if (
        lower.includes("seedream") ||
        lower.includes("gpt-image") ||
        lower.includes("image") ||
        lower.includes("dall-e") ||
        lower.includes("dalle") ||
        lower.includes("flux") ||
        lower.includes("imagen") ||
        lower.includes("banana") ||
        lower.includes("midjourney") ||
        /^mj[_-]/u.test(lower) ||
        lower.includes("sdxl") ||
        lower.includes("stable-diffusion")
    ) {
        return "image";
    }
    if (
        lower.includes("video") ||
        lower.includes("sora") ||
        lower.includes("veo") ||
        lower.includes("kling") ||
        lower.includes("seedance") ||
        lower.includes("minimax-video") ||
        lower.includes("hailuo") ||
        lower.includes("pika") ||
        lower.includes("runway") ||
        lower.includes("omni") ||
        lower.includes("cogvideo") ||
        /^(?:dola-)?sd-2[.-]/i.test(lower) ||
        lower === "minimax-h3" ||
        lower.includes("wan")
    ) {
        return "video";
    }
    return "text";
}

export function defaultProtocolForCapability(capability: ProtocolCapability, availableProtocols: ModelProtocolDefinition[] = []): ModelProtocol {
    for (const id of STANDARD_PROTOCOLS[capability] || []) {
        if (!availableProtocols.length || availableProtocols.some((item) => item.value === id && item.enabled !== false)) return id;
    }
    const matched = availableProtocols.find((item) => item.capability === capability && item.enabled !== false);
    return matched?.value || FALLBACK_PROTOCOLS[capability] || "chat-completion";
}

export function defaultProtocolForModel(model: string, availableProtocols: ModelProtocolDefinition[] = []): ModelProtocol {
    if (/^sd-2\.5-[a-e]$/i.test(model.trim())) return "eggfans-sd2-video";
    const inferred = inferProtocolFromModelName(model, availableProtocols);
    if (inferred) return inferred;
    return defaultProtocolForCapability(inferProtocolCapabilityFromModel(model), availableProtocols);
}

export function usesOpenAICompatibleProtocolDefault(apiFormat?: string) {
    return apiFormat !== "gemini" && apiFormat !== "claude";
}

type ChannelModelProfile = NonNullable<ModelChannel["modelProfiles"]>[number];

export function ensureModelProfilesWithUiDefaults(
    models: string[],
    profiles: Array<Omit<ChannelModelProfile, "capability"> & { capability?: ProtocolCapability }> | undefined,
    availableProtocols: ModelProtocolDefinition[] = [],
    apiFormat?: string,
): ChannelModelProfile[] {
    const byModel = new Map((profiles || []).filter((item) => models.includes(item.model)).map((item) => [item.model, item]));
    return models.map((model) => {
        const current = byModel.get(model);
        if (current?.protocol && current.capability) return { ...current, capability: current.capability, protocol: current.protocol };
        const protocol = current?.protocol || (usesOpenAICompatibleProtocolDefault(apiFormat) ? defaultProtocolForModel(model, availableProtocols) : undefined);
        const capability = current?.capability || modelProtocolCapability(protocol, availableProtocols) || inferProtocolCapabilityFromModel(model);
        return { ...current, model, capability, protocol };
    });
}
