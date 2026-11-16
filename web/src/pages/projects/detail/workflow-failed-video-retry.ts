import { latestWorkflowShotTasks } from "@/lib/workflow-shot-task";
import { assertUserScope, captureUserScope, isUserScopeAbandonedError } from "@/lib/user-scope-guard";
import { explainGenerationError } from "@/lib/generation-error";
import { getProjectUnitWorkspace, type ProjectDetail } from "@/services/api/projects";
import { queryGenerationTask, queryFailedVideoProviderTask, retryGenerationTask, type GenerationTask } from "@/services/api/task-center";

type RetryWorkspace = Pick<ProjectDetail, "shots" | "tasks">;
const defaultApi = {
    getWorkspace: getProjectUnitWorkspace,
    queryTask: queryGenerationTask,
    retryTask: retryGenerationTask,
    recoverTask: queryFailedVideoProviderTask,
};

export function failedUnitVideoTasks(detail: RetryWorkspace, unitId: string, submittingShotIds = new Set<string>()) {
    const latest = latestWorkflowShotTasks(detail.tasks || [], "video");
    return detail.shots.filter((shot) => shot.unitId === unitId && !submittingShotIds.has(shot.id))
        .slice().sort((left, right) => left.position - right.position)
        .flatMap((shot) => {
            const task = latest.get(shot.id);
            return task?.status === "failed" && (task.type.startsWith("canvas_video") || task.type.startsWith("video_")) ? [task] : [];
        });
}

export async function retryFailedUnitVideos(detail: ProjectDetail, unitId: string, options: {
    submittingShotIds?: Set<string>;
    onProgress?: (progress: { completed: number; total: number }) => void;
    onTaskQueued?: (task: GenerationTask) => void;
} = {}, api = defaultApi) {
    const scope = captureUserScope();
    const candidates = failedUnitVideoTasks(detail, unitId, options.submittingShotIds);
    const workspace = await api.getWorkspace(detail.project.id, unitId, undefined, scope);
    assertUserScope(scope);
    if (workspace.unit.id !== unitId) throw new Error("章节已切换，未重新提交任务");
    const eligible = new Set(failedUnitVideoTasks(workspace, unitId, options.submittingShotIds).map((task) => task.id));
    const result = { submitted: [] as GenerationTask[], recovered: [] as GenerationTask[], skipped: 0, failures: [] as Array<{ shotId: string; taskId: string; message: string }> };
    options.onProgress?.({ completed: 0, total: candidates.length });
    let completed = 0;
    await Promise.all(candidates.map(async (candidate) => {
        assertUserScope(scope);
        try {
            if (!eligible.has(candidate.id)) { result.skipped++; return; }
            const current = await api.queryTask(candidate.id, { expectedScope: scope });
            assertUserScope(scope);
            if (current.status !== "failed" || current.clientContext?.shotId !== candidate.clientContext?.shotId) { result.skipped++; return; }
            const failure = explainGenerationError(current.error || "", { stage: current.stage, model: current.model, failureDiagnostics: current.failureDiagnostics });
            if (failure.uncertain || current.failureDiagnostics?.executionResult === "completed" || current.failureDiagnostics?.executionResult === "pending" || current.stage === "submission_unknown" || current.stage === "本地结果处理") {
                const recovered = await api.recoverTask(current.id, scope);
                assertUserScope(scope);
                options.onTaskQueued?.(recovered.task);
                if (recovered.task.status !== "queued" && recovered.task.status !== "running" && recovered.task.status !== "succeeded") throw new Error(recovered.task.error || "原视频任务尚未恢复，请查看任务详情；未重复提交生成");
                result.recovered.push(recovered.task);
                return;
            }
            const queued = await api.retryTask(current.id, scope);
            result.submitted.push(queued);
            assertUserScope(scope);
            options.onTaskQueued?.(queued);
        } catch (error) {
            if (isUserScopeAbandonedError(error)) throw error;
            result.failures.push({ shotId: candidate.clientContext!.shotId!, taskId: candidate.id, message: error instanceof Error ? error.message : "重新提交失败，请查看任务详情" });
        } finally { options.onProgress?.({ completed: ++completed, total: candidates.length }); }
    }));
    return result;
}
