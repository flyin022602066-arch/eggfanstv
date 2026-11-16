import { useMemo, useRef, useState } from "react";
import { App, Button } from "antd";
import { Download } from "lucide-react";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import type { ProjectDetail } from "@/services/api/projects";
import { isWailsNativeShell } from "@/services/desktop-media-save";
import { chapterVideoDownloadFiles, downloadProjectUnitVideos } from "./workflow-unit-video-download";

export function WorkflowUnitVideoDownloadButton({ detail, unitId }: { detail: ProjectDetail; unitId: string }) {
    const { message } = App.useApp();
    const busy = useRef(false);
    const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
    const unavailable = useMemo(() => {
        try { chapterVideoDownloadFiles(detail, unitId); return ""; }
        catch (error) { return error instanceof Error ? error.message : "本集视频尚未全部就绪"; }
    }, [detail, unitId]);
    const download = async () => {
        if (busy.current) return;
        busy.current = true;
        const scope = captureUserScope();
        try {
            const result = await downloadProjectUnitVideos(detail, unitId, (completed, total) => setProgress({ completed, total }));
            if (result === "saved" && userScopeMatches(scope)) message.success(isWailsNativeShell() ? "本集视频已打包保存到所选位置" : "已发起本集视频 ZIP 下载");
        } catch (error) {
            if (userScopeMatches(scope)) message.error(error instanceof Error ? error.message : "本集视频下载失败，请重试");
        } finally { busy.current = false; setProgress(null); }
    };
    return <Button size="small" icon={<Download className="size-3.5" />} loading={Boolean(progress)} disabled={Boolean(unavailable)} title={unavailable || "按镜头顺序打包当前版本视频为 ZIP，保留原画质，不合并或重新生成"} onClick={() => void download()}>
        {progress ? <span role="status" aria-live="polite">正在打包 {progress.completed}/{progress.total}</span> : "下载本集视频"}
    </Button>;
}
