import { http } from "./request";

export type HanbaoSettings = {
    account: string; channel: "auto" | "canvas" | "chat"; canvasAttempts: number; versionCode: string; pcVersion: string;
    feihu: { baseUrl: string; apiKey: string; apiSecret: string; projectId: string; hasApiKey?: boolean; hasApiSecret?: boolean };
};
export type HanbaoStatus = { available: boolean; reason?: string; settings: HanbaoSettings };
export type HanbaoAccount = { id: string; label?: string; logged_in?: boolean; active?: boolean; blocked?: boolean; plan?: string; daily_limit?: number; used_today?: number; remaining_today?: number; daily_seconds_limit?: number; used_seconds_today?: number; remaining_seconds?: number; profile_ready?: boolean };
export type HanbaoOrder = { order_id: string; account: string; phone: string; pid: string; status: number; code?: string; message?: string };
export type FeihuProject = { project_id: number; name: string; price: number; status: number };
export const getHanbaoStatus = (signal?: AbortSignal) => http.get<HanbaoStatus>("/hanbao/status", { signal, timeout: 10000 });
export const saveHanbaoSettings = (settings: HanbaoSettings) => http.put<{ saved: boolean }>("/hanbao/settings", settings, { timeout: 35000 });
export function hanbaoAccountAction(action: "accounts" | "login" | "checklogin" | "open" | "logout" | "delete-account" | "set-plan" | "reset-quota", input: { account?: string; plan?: string; dailyLimit?: number; dailySeconds?: number } = {}) {
    return http.post<{ accounts?: HanbaoAccount[]; logged_in?: boolean }>(`/hanbao/accounts/${action}`, input, { timeout: 350000 });
}
export function hanbaoSMS<T>(action: "connect" | "info" | "projects" | "orders" | "receive" | "message" | "release" | "blacklist", input: { account?: string; orderId?: string; filters?: Record<string, string> } = {}, signal?: AbortSignal) {
    return http.post<T>(`/hanbao/sms/${action}`, input, { signal, timeout: 65000 });
}
