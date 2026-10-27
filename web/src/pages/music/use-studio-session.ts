import { useEffect, useState } from "react";
import { getActiveUserScope } from "@/lib/user-scope";
import { recoverSunoStudioJobs } from "@/services/suno-studio";
import { useSunoStudioStore } from "@/stores/use-suno-studio-store";
import { useUserStore } from "@/stores/use-user-store";

export function useStudioSession() {
    const userId = useUserStore((state) => state.user?.id);
    const [scope, setScope] = useState(getActiveUserScope);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        const updateScope = () => setScope(getActiveUserScope());
        updateScope();
        window.addEventListener("storage", updateScope);
        window.addEventListener("focus", updateScope);
        return () => {
            window.removeEventListener("storage", updateScope);
            window.removeEventListener("focus", updateScope);
        };
    }, [userId]);

    useEffect(() => {
        let disposed = false;
        let recovering = false;
        setError(null);
        const recover = async () => {
            const store = useSunoStudioStore.getState();
            if (disposed || recovering || !store.hydrated || store.scope !== scope) return;
            if (!store.jobs.some((job) => job.taskId && ["queued", "running", "unknown"].includes(job.status))) return;
            recovering = true;
            try { await recoverSunoStudioJobs(); }
            catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "任务状态同步暂不可用"); }
            finally { recovering = false; }
        };
        void useSunoStudioStore.getState().hydrate(scope).then(() => {
            if (!disposed) void recover();
        }).catch((cause) => {
            if (!disposed) setError(cause instanceof Error ? cause.message : "本地工作台读取失败");
        });
        const interval = window.setInterval(() => {
            if (getActiveUserScope() !== scope) {
                setScope(getActiveUserScope());
                return;
            }
            void recover();
        }, 5000);
        return () => { disposed = true; window.clearInterval(interval); };
    }, [scope]);
    return { scope: getActiveUserScope(), error };
}
