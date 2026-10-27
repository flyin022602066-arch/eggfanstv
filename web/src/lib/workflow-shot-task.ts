import type { GenerationTask } from "@/services/api/task-center";

export function latestWorkflowShotTasks(tasks: GenerationTask[], artifactType: string) {
    const latest = new Map<string, GenerationTask>();
    const active = (task: GenerationTask) => task.status === "queued" || task.status === "running";
    for (const task of tasks) {
        const shotId = task.clientContext?.shotId;
        if (!shotId || task.clientContext?.artifactType !== artifactType) continue;
        const current = latest.get(shotId);
        if (!current || (active(task) !== active(current) ? active(task) : Date.parse(task.createdAt) > Date.parse(current.createdAt) || (task.createdAt === current.createdAt && task.updatedAt > current.updatedAt))) {
            latest.set(shotId, task);
        }
    }
    return latest;
}
