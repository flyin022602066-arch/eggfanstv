export const PROJECT_WORKFLOW_MODEL_STAGES = ["storyboard", "previz", "video", "chapterText"] as const;
export type ProjectWorkflowModelStage = (typeof PROJECT_WORKFLOW_MODEL_STAGES)[number];
export type ProjectWorkflowModels = Record<string, Partial<Record<ProjectWorkflowModelStage, string>>>;

export function normalizeProjectWorkflowModels(value: unknown): ProjectWorkflowModels {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([projectId, raw]) => {
        if (!projectId.trim() || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
        const fields = raw as Record<string, unknown>;
        const stages = Object.fromEntries(PROJECT_WORKFLOW_MODEL_STAGES.flatMap((stage) => {
            const model = fields[stage];
            return typeof model === "string" && model.trim() ? [[stage, model.trim()]] : [];
        }));
        return Object.keys(stages).length ? [[projectId, stages]] : [];
    }));
}
