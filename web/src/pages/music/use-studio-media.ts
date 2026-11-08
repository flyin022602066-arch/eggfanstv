import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveUserScope } from "@/lib/user-scope";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";
import { ownedResourceIdFromMediaRef, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { ensureSunoClipStorageKey } from "@/services/suno-studio";
import { playableUrl } from "./studio-helpers";

type MediaState = { identity: string; url?: string; loading: boolean; error?: string; warning?: string };

export function useStudioMedia(storageKey?: string, remoteUrl?: string, suno?: { jobId: string; clipId: string }) {
    const scope = getActiveUserScope();
    const resourceId = ownedResourceIdFromMediaRef(storageKey, remoteUrl);
    const mediaKey = storageKey || (resourceId ? resourceStorageKey(resourceId) : undefined);
    const jobId = suno?.jobId;
    const clipId = suno?.clipId;
    const identity = `${scope}:${jobId && clipId ? "suno:" + jobId + ":" + clipId : mediaKey || ""}:${remoteUrl || ""}`;
    const currentIdentity = useRef(identity);
    currentIdentity.current = identity;
    const mounted = useRef(true);
    const inflight = useRef<{ identity: string; promise: Promise<string | undefined> } | null>(null);
    const [state, setState] = useState<MediaState>(() => ({ identity, url: mediaKey || jobId ? undefined : playableUrl(remoteUrl), loading: false }));
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const active: MediaState = state.identity === identity ? state : { identity, loading: false };
    const load = useCallback((force = false): Promise<string | undefined> => {
        if (!mounted.current || getActiveUserScope() !== scope) return Promise.resolve(undefined);
        if (!force && state.identity === identity && state.url) return Promise.resolve(state.url);
        if (inflight.current?.identity === identity) return inflight.current.promise;
        setState({ identity, loading: true });
        const request = (async () => {
            try {
                let resolved = "";
                let warning: string | undefined;
                const savedKey = mediaKey || (jobId && clipId ? await ensureSunoClipStorageKey(jobId, clipId) : undefined);
                if (savedKey && resourceIdFromStorageKey(savedKey)) {
                    resolved = (await cacheResourceObjectUrl(savedKey, force)) || "";
                    if (!resolved && remoteUrl && !ownedResourceIdFromMediaRef(undefined, remoteUrl)) {
                        resolved = playableUrl(remoteUrl) || "";
                        if (resolved) warning = "本地媒体暂不可读，已切换为原始媒体地址";
                    }
                    if (!resolved) throw new Error("本地媒体资源读取失败，请点击重新读取");
                } else {
                    resolved = playableUrl(await resolveMediaUrl(savedKey, remoteUrl)) || "";
                }
                const url = resolved;
                if (!mounted.current || currentIdentity.current !== identity || getActiveUserScope() !== scope) return undefined;
                if (!url) throw new Error(storageKey ? "本地媒体地址无法解析" : "未返回可播放的媒体地址");
                setState({ identity, url, loading: false, warning });
                return url;
            } catch (cause) {
                if (mounted.current && currentIdentity.current === identity && getActiveUserScope() === scope) setState({ identity, loading: false, error: cause instanceof Error ? cause.message : "媒体读取失败" });
                return undefined;
            }
        })();
        inflight.current = { identity, promise: request };
        void request.then(() => { if (inflight.current?.promise === request) inflight.current = null; });
        return request;
    }, [identity, mediaKey, remoteUrl, scope, state, jobId, clipId]);
    const useOriginal = () => {
        if (ownedResourceIdFromMediaRef(undefined, remoteUrl)) return;
        const url = playableUrl(remoteUrl);
        if (!url || getActiveUserScope() !== scope) return;
        setState({ identity, url, loading: false, warning: "已切换为原始媒体地址，本地媒体仍未恢复" });
    };
    return { ...active, load, useOriginal, local: Boolean(mediaKey || active.url?.startsWith("blob:")) && !active.warning };
}
