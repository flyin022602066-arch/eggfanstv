export const HANBAO_PROTOCOL = "hanbao-video";
export const HANBAO_MODELS = ["seedance_v2.5", "seedance_v2.0_mini", "seedance_v2.0"];
export const HANBAO_MODEL_NAMES: Record<string, string> = { "seedance_v2.5": "Seedance 2.5", "seedance_v2.0_mini": "Seedance 2.0 Mini", "seedance_v2.0": "Seedance 2.0 Fast" };
export function isHanbaoChannel(channel: { id: string; interfaceType?: string; modelProfiles?: Array<{ protocol?: string }> }) {
    return channel.id === "hanbao" && (channel.interfaceType === HANBAO_PROTOCOL || Boolean(channel.modelProfiles?.some((profile) => profile.protocol === HANBAO_PROTOCOL)));
}
