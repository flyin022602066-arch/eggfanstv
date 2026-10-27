import { isEggfansBaseUrl } from "@/lib/eggfans-seedance";
import { mergeFetchedChannelModelProfiles } from "@/lib/channel-model-catalog";
import type { ChannelModelFetchResult } from "@/services/api/image-models";
import type { AiConfig, ModelChannel } from "@/stores/use-config-store";

type ModelCatalogRefreshDependencies = {
    getConfig: () => AiConfig;
    replaceConfig: (config: AiConfig) => void;
    fetchModels: (channel: ModelChannel) => Promise<ChannelModelFetchResult>;
    persist: (config: AiConfig) => Promise<unknown>;
};

export async function refreshEggfansModelCatalog({ getConfig, replaceConfig, fetchModels, persist }: ModelCatalogRefreshDependencies) {
    const initialConfig = getConfig();
    const initialChannel = initialConfig.channels.find((channel) => channel.id === "beefapi" && isEggfansBaseUrl(channel.baseUrl));
    if (!initialChannel || (!initialChannel.apiKey.trim() && !initialChannel.pinned && initialChannel.credentialRef !== "beefapi-enterprise")) return false;

    const result = await fetchModels(initialChannel);
    const models = Array.from(new Set(result.models.map((model) => model.trim()).filter(Boolean)));
    if (!models.length) return false;

    const latestConfig = getConfig();
    const latestChannel = latestConfig.channels.find((channel) => channel.id === initialChannel.id);
    if (!latestChannel || !sameRefreshTarget(initialChannel, latestChannel)) return false;

    const modelProfiles = result.catalog.length
        ? mergeFetchedChannelModelProfiles(latestChannel, result.catalog)
        : latestChannel.modelProfiles || [];
    if (sameCatalog(latestChannel, models, modelProfiles)) return false;

    const nextConfig = {
        ...latestConfig,
        channels: latestConfig.channels.map((channel) => channel.id === latestChannel.id
            ? { ...channel, models, modelProfiles }
            : channel),
    };
    replaceConfig(nextConfig);
    await persist(nextConfig);
    return true;
}

function sameRefreshTarget(initial: ModelChannel, latest: ModelChannel) {
    return initial.baseUrl === latest.baseUrl
        && initial.catalogUrl === latest.catalogUrl
        && initial.apiFormat === latest.apiFormat
        && initial.apiKey === latest.apiKey
        && initial.secretKey === latest.secretKey
        && JSON.stringify(initial.headers || []) === JSON.stringify(latest.headers || [])
        && JSON.stringify(initial.models) === JSON.stringify(latest.models)
        && JSON.stringify(initial.modelProfiles || []) === JSON.stringify(latest.modelProfiles || []);
}

function sameCatalog(channel: ModelChannel, models: string[], modelProfiles: NonNullable<ModelChannel["modelProfiles"]>) {
    return JSON.stringify(channel.models) === JSON.stringify(models)
        && JSON.stringify(channel.modelProfiles || []) === JSON.stringify(modelProfiles);
}
