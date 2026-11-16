import { useRef, useState } from "react";
import { Alert, App, Button } from "antd";
import { RefreshCcw } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import type { ProjectDetail } from "@/services/api/projects";
import type { GenerationTask } from "@/services/api/task-center";
import { failedUnitVideoTasks, retryFailedUnitVideos } from "./workflow-failed-video-retry";

export function WorkflowFailedVideoRetryButton({ detail, unitId, submittingShotIds, onTaskQueued, onSubmittingChange, onRefresh }: {
    detail: ProjectDetail; unitId: string; submittingShotIds: Set<string>;
    onTaskQueued: (task: GenerationTask) => void;
    onSubmittingChange: (ids: string[], submitting: boolean) => void;
    onRefresh: () => Promise<void>;
}) {
    const { message } = App.useApp();
    const busy = useRef(false);
    const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
    const [failures, setFailures] = useState<Array<{ shotId: string; message: string }>>([]);
    const candidates = failedUnitVideoTasks(detail, unitId, submittingShotIds);
    const retry = async () => {
        if (busy.current || !candidates.length) return;
        busy.current = true;
        const scope = captureUserScope();
        const ids = candidates.map((task) => task.clientContext!.shotId!);
        onSubmittingChange(ids, true);
        setProgress({ completed: 0, total: candidates.length });
        setFailures([]);
        try {
            const result = await retryFailedUnitVideos(detail, unitId, { submittingShotIds: new Set(submittingShotIds), onProgress: setProgress, onTaskQueued });
            if (!userScopeMatches(scope)) return;
            setFailures(result.failures);
            const summary = `已重新提交${result.submitted.length}个失败视频${result.recovered.length ? `，已查询取回或恢复${result.recovered.length}个原任务` : ""}${result.skipped ? `，跳过${result.skipped}个状态已变化的镜头` : ""}`;
            if (result.failures.length) message.warning(summary + `，${result.failures.length}个未提交，请查看详情`);
            else message.success(summary);
            await onRefresh().catch(() => { message.warning("提交结果已收到，界面刷新失败，请刷新查看原任务，不要重复提交"); });
        } catch (error) {
            if (userScopeMatches(scope)) message.error(error instanceof Error ? error.message : "重新提交失败");
        } finally { busy.current = false; setProgress(null); onSubmittingChange(ids, false); }
    };
    return <>
        <Button size="small" icon={<RefreshCcw className="size-3.5" />} loading={Boolean(progress)} disabled={!progress && !candidates.length} title="仅重试本集最新失败的视频，沿用各任务原模型、提示词与参数；不重复提交成功或生成中的镜头" onClick={() => void retry()}>
            {progress ? <span role="status" aria-live="polite">正在重新提交 {progress.completed}/{progress.total}</span> : `一键重试失败视频${candidates.length ? `（${candidates.length}）` : ""}`}
        </Button>
        <AppModal title="部分失败视频未能重新提交" open={failures.length > 0} onCancel={() => setFailures([])} footer={<Button onClick={() => setFailures([])}>知道了</Button>}>
            <Alert type="warning" showIcon title="其余镜头并发处理，不会重复生成成功视频" description="提交未确认或仅下载失败优先查询原任务；明确审核失败可自动做一次合规润色后重新提交，保留资产绑定，再次拒绝会显示真实原因。" />
            {failures.map((failure) => <p key={failure.shotId}>{detail.shots.find((shot) => shot.id === failure.shotId)?.title || failure.shotId}：{failure.message}</p>)}
        </AppModal>
    </>;
}
