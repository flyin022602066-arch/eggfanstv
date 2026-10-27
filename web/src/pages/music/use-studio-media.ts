import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveUserScope } from "@/lib/user-scope";
import { resolveMediaUrl } from "@/services/file-storage";
import { playableUrl } from "./studio-helpers";

type MediaState = { identity: string; url?: string; loading: boolean; error?: string; warning?: string };

export function useStudioMedia(storageKey?: string, remoteUrl?: string) {
    const scope = getActiveUserScope();
    const identity = `${scope}:${storageKey || ""}:${remoteUrl || ""}`;
    const currentIdentity = useRef(identity);
    currentIdentity.current = identity;
    const mounted = useRef(true);
    const inflight = useRef<{ identity: string; promise: Promise<string | undefined> } | null>(null);
    const [state, setState] = useState<MediaState>(() => ({ identity, url: storageKey ? undefined : playableUrl(remoteUrl), loading: false }));
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const active: MediaState = state.identity === identity ? state : { identity, loading: false };
    const load = useCallback((force = false): Promise<string | undefined> => {
        if (!mounted.current || getActiveUserScope() !== scope) return Promise.resolve(undefined);
        if (!force && state.identity === identity && state.url) return Promise.resolve(state.url);
        if (inflight.current?.identity === identity) return inflight.current.promise;
        setState({ identity, loading: true });
        const request = (async () => {
            try {
                const url = playableUrl(storageKey ? await resolveMediaUrl(storageKey) : remoteUrl);
                if (!mounted.current || currentIdentity.current !== identity || getActiveUserScope() !== scope) return undefined;
                if (!url) throw new Error(storageKey ? "本地媒体地址无法解析" : "未返回可播放的媒体地址");
                setState({ identity, url, loading: false });
                return url;
            } catch (cause) {
                if (mounted.current && currentIdentity.current === identity && getActiveUserScope() === scope) setState({ identity, loading: false, error: cause instanceof Error ? cause.message : "媒体读取失败" });
                return undefined;
            }
        })();
        inflight.current = { identity, promise: request };
        void request.then(() => { if (inflight.current?.promise === request) inflight.current = null; });
        return request;
    }, [identity, remoteUrl, scope, state, storageKey]);
    const useOriginal = () => {
        const url = playableUrl(remoteUrl);
        if (!url || getActiveUserScope() !== scope) return;
        setState({ identity, url, loading: false, warning: "已切换为原始媒体地址，本地媒体仍未恢复" });
    };
    return { ...active, load, useOriginal, local: Boolean(storageKey) && !active.warning };
}
