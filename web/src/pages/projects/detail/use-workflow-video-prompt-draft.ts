import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { APP_STATE_STORE_NAME, localForageInstance } from "@/lib/localforage-storage";
import { getActiveUserScope, subscribeUserScope } from "@/lib/user-scope";

type DraftState = { key: string; value?: string; ready: boolean; saving?: boolean; error?: string };
const cache = new Map<string, string | undefined>();
const pending = new Map<string, Promise<unknown>>();
const storage = localForageInstance(APP_STATE_STORE_NAME);

export function useWorkflowVideoPromptDraft(projectId: string, unitId: string, shotId?: string) {
    const scope = useSyncExternalStore((listener) => subscribeUserScope(listener), getActiveUserScope, getActiveUserScope);
    const key = JSON.stringify(["workflow-video-final-draft-v1", scope, projectId, unitId, shotId || ""]);
    const [state, setState] = useState<DraftState>({ key, ready: false });
    const sequence = useRef(0);
    const current = state.key === key ? state : { key, ready: cache.has(key), value: cache.get(key) };

    useEffect(() => {
        let active = true;
        const revision = ++sequence.current;
        if (cache.has(key)) setState({ key, value: cache.get(key), ready: true });
        else {
            setState({ key, ready: false });
            void storage.getItem<string>(key).then((value) => {
                if (!active || sequence.current !== revision) return;
                cache.set(key, typeof value === "string" ? value : undefined);
                setState({ key, value: cache.get(key), ready: true });
            }, () => {
                if (active && sequence.current === revision) setState({ key, ready: false, error: "最终提示词草稿读取失败，请重新打开当前镜头；未提交生成任务" });
            });
        }
        return () => { active = false; };
    }, [key]);

    const setDraft = (value?: string) => {
        const revision = ++sequence.current;
        cache.set(key, value);
        setState({ key, value, ready: true, saving: true });
        const write = (pending.get(key) || Promise.resolve()).catch(() => undefined).then(async () => {
            if (value === undefined) await storage.removeItem(key);
            else await storage.setItem(key, value);
        });
        pending.set(key, write);
        void write.then(() => {
            if (sequence.current === revision) setState((previous) => previous.key === key ? { key, value, ready: true } : previous);
        }, () => {
            if (sequence.current === revision) setState((previous) => previous.key === key ? { key, value, ready: true, error: "最终提示词仍保留在当前页面，但本地草稿保存失败；关闭软件前请复制备份" } : previous);
        }).finally(() => { if (pending.get(key) === write) pending.delete(key); });
    };

    return { value: current.value, ready: current.ready, saving: current.saving, error: current.error, setDraft, snapshot: () => cache.get(key) };
}
