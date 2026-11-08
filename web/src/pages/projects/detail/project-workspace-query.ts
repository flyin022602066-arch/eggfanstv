import { ApiError, getTransportFailureKind } from "@/services/api/request";

export function isProjectAccessError(error: unknown) {
    return error instanceof ApiError && (
        [401, 403, 404].includes(error.status || 0)
        || [401, 403, 404].includes(error.code || 0)
        || ["unauthorized", "forbidden", "not_found"].includes(error.reason || "")
    );
}

export function retryProjectRead(failureCount: number, error: unknown) {
    if (failureCount >= 2 || isProjectAccessError(error)) return false;
    return Boolean(getTransportFailureKind(error) || error instanceof ApiError && error.retryable);
}

export function projectReadBlocksView(query: { isError: boolean; data: unknown; error: unknown }) {
    return query.isError && (!query.data || isProjectAccessError(query.error));
}

export function projectReadErrorDescription(error: unknown) {
    const transportKind = getTransportFailureKind(error);
    if (transportKind === "timeout") return "本地服务读取超时，请重试；当前已加载内容不会被清空。";
    if (transportKind === "network") return "与本地服务的连接暂时中断，请重试；当前已加载内容不会被清空。";
    if (error instanceof ApiError) {
        if (error.reason === "unauthorized" || error.status === 401 || error.code === 401) return "当前登录状态已失效，请重新登录后重试。";
        if (error.reason === "forbidden" || error.status === 403 || error.code === 403) return "当前账号没有访问此项目的权限。";
        if (error.reason === "not_found" || error.status === 404 || error.code === 404) return "项目或章节不存在，可能已被删除。";
        if (error.status) return `本地服务读取失败（HTTP ${error.status}），请重试。`;
    }
    return "项目数据暂时读取失败，请重试；这不代表项目已被删除。";
}
