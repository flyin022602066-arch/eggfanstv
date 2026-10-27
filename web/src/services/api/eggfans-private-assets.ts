import { EGGFANS_AVATAR_MODEL } from "@/lib/eggfans-seedance";
import { http } from "@/services/api/request";
import { resolveModelRequestConfig, type ModelChannel } from "@/stores/use-config-store";
import { useConfigStore } from "@/stores/use-config-store";

export type EggfansAvatarOperation = "create-group" | "list-groups" | "get-group" | "update-group" | "delete-group" | "create-asset" | "list-assets" | "get-asset" | "update-asset" | "delete-asset" | "auth-session" | "group-from-token";
export type EggfansAvatarGroup = { Id: string; Name: string; Description?: string; GroupType: "AIGC" | "LivenessFace" };
export type EggfansAvatarAsset = { Id: string; Name?: string; GroupId: string; AssetType: "Image" | "Video" | "Audio"; Status: "Processing" | "Active" | "Failed"; URL?: string };
export type EggfansAvatarList<T> = { Items: T[]; PageNumber: number; PageSize: number; Total: number };
export type EggfansAssetBinding = { id: string; resourceId?: string; assetId: string; groupId: string; assetType: string; uri: string; status: string; error: string; baseUrl: string };
export type EggfansRemoteVideoTask = { id?: string; task_id?: string; status?: string; model?: string; content?: { video_url?: string } };

export async function queryEggfansVideoTasks(channel: ModelChannel, protocol: string, taskId?: string, signal?: AbortSignal): Promise<EggfansRemoteVideoTask[]> {
    const result = await http.post<EggfansRemoteVideoTask & { items?: EggfansRemoteVideoTask[]; tasks?: EggfansRemoteVideoTask[] }>("/eggfans/video-tasks/query", { config: { ...avatarConfig(channel), interfaceType: protocol }, taskId, pageSize: 20 }, { signal });
    if (result.id || result.task_id) return [result];
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.tasks)) return result.tasks;
    throw new Error("上游未返回任务列表；可填写任务 ID 查询详情");
}

function avatarConfig(channel: ModelChannel) {
    const selected = channel.models.find((model) => model.toLowerCase().includes("seedance"));
    const resolved = selected ? resolveModelRequestConfig(useConfigStore.getState().config, `${channel.id}::${selected}`) : undefined;
    return { baseUrl: channel.baseUrl, apiKey: resolved?.apiKey || channel.apiKey, headers: channel.headers, apiFormat: channel.apiFormat, model: EGGFANS_AVATAR_MODEL };
}

export function eggfansAvatar<T>(channel: ModelChannel, operation: EggfansAvatarOperation, body?: Record<string, unknown>, id?: string, signal?: AbortSignal) {
    return http.post<T>("/eggfans/private-avatar", { config: avatarConfig(channel), operation, id, body: { ...body, model: EGGFANS_AVATAR_MODEL } }, { signal, timeout: 120000 });
}

export function syncResourceToEggfans(channel: ModelChannel, resourceId: string, groupId?: string, name?: string, signal?: AbortSignal) {
    return http.post<EggfansAssetBinding>(`/resources/${encodeURIComponent(resourceId)}/eggfans-private-asset`, { config: avatarConfig(channel), body: { GroupId: groupId, Name: name } }, { signal, timeout: 600000 });
}

export function getResourceEggfansAssets(resourceId: string, signal?: AbortSignal) {
    return http.get<EggfansAssetBinding[]>(`/resources/${encodeURIComponent(resourceId)}/eggfans-private-assets`, { signal });
}
