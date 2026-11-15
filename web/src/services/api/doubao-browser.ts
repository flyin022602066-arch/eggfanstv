import { http } from "./request";
export interface DoubaoBrowserProfile {
    id: string; label: string; state: "cold" | "idle" | "busy" | "pending" | "attention" | "exhausted" | "used";
    usedTaskId?: string;
    needsCleanup?: boolean; clearedAt?: string;
    reason?: string; visitor?: boolean; quota: "unknown"; checkedAt?: string;
}
export interface DoubaoBrowserStatus {
    enabled: boolean; target: number; reserve: number; total: number; active: number; used: number; cold: number; attention: number; warming: boolean; idle: number; busy: number;
    pending: number; succeeded: number; failed: number; cleaned: number; cleaning: boolean;
    profiles: DoubaoBrowserProfile[]; quotaResetConfirmed: false;
}
export const getDoubaoBrowserStatus = (signal?: AbortSignal) => http.get<DoubaoBrowserStatus>("/doubao-browser/status", { signal });
export const configureDoubaoBrowser = (enabled: boolean, signal?: AbortSignal) => http.put<DoubaoBrowserStatus>("/doubao-browser/settings", { enabled }, { signal, timeout: 120000 });
export const clearDoubaoBrowser = (signal?: AbortSignal) => http.post<{ cleared: number; skipped: number; failed: string[]; quotaResetConfirmed: false }>("/doubao-browser/clear", {}, { signal, timeout: 300000 });
export const openDoubaoBrowser = (profileId: string, signal?: AbortSignal) => http.post<{ opened: boolean }>("/doubao-browser/open", { profileId }, { signal, timeout: 120000 });
