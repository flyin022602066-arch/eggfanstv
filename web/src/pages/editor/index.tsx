import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { createProject, listProjects } from "@/services/api/projects";

export default function SmartEditorPage() {
    const navigate = useNavigate();
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const result = await listProjects({ page: 1, pageSize: 50 });
                const project = result.projects
                    .filter((item) => item.project.status !== "archived")
                    .sort((left, right) => right.project.updatedAt.localeCompare(left.project.updatedAt))[0]?.project;
                if (cancelled) return;
                if (project) {
                    navigate("/projects/" + project.id + "/editor", { replace: true });
                    return;
                }
                const created = await createProject({ name: "智能剪辑项目", type: "video", aspectRatio: "16:9", sourceType: "blank" });
                if (!cancelled) navigate("/projects/" + created.project.id + "/editor", { replace: true });
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "无法打开智能剪辑工作台");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [navigate]);

    return (
        <WorkspacePage>
            {error ? <WorkspaceErrorState title="智能剪辑工作台打开失败" description={error} onRetry={() => window.location.reload()} /> : <WorkspaceLoadingState label="正在打开智能剪辑工作台" detail="准备最近项目的完整剪辑界面" />}
        </WorkspacePage>
    );
}
