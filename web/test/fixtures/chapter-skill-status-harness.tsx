import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import { getAntThemeConfig } from "@/lib/app-theme";
import { ChapterSkillStatus, ChapterSkillStatusReport, type ChapterSkillAttempt } from "@/pages/projects/detail/chapter-skill-status";

const params = new URLSearchParams(location.search);
const dark = params.get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);

const task = {
    id: "fixture-task", type: "canvas_text", status: "failed" as const, prompt: "", attempts: 1,
    createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:01:00Z", error: "文本模型请求失败",
};
const report = [
    { skillId: "camera", skillName: "大师级摄影机位与镜头设计", version: "1.2.0", status: "loaded" as const, files: ["SKILL.md", "references/camera.md"], truncated: false },
    { skillId: "lighting", skillName: "电影光影设计与精细布光", version: "2.0.0", status: "failed" as const, files: [], reason: "file_read_failed" as const },
];

function Harness() {
    const [chapterId, setChapterId] = useState("chapter-1");
    const [attempt, setAttempt] = useState<ChapterSkillAttempt>();
    const queryClient = useQueryClient();
    return <main className="mx-auto max-w-3xl p-4">
        <button onClick={() => setChapterId(chapterId === "chapter-1" ? "chapter-2" : "chapter-1")}>切换章节</button>
        {params.has("attempt") ? <>
            <button onClick={() => setAttempt({ report: null, preparing: true })}>开始本次准备</button>
            <button onClick={() => setAttempt({ report: [{ ...report[0]!, skillName: "本次机位设计" }], task: { ...task, id: "local-task", status: "running", error: undefined, createdAt: "2026-11-01T11:00:00Z", updatedAt: "2026-11-01T11:00:00Z" } })}>提交本次请求</button>
            <button onClick={() => void queryClient.invalidateQueries({ queryKey: ["project-chapter-generation-tasks", "offline-project"] })}>刷新任务记录</button>
        </> : null}
        {params.has("shortscript") ? <ChapterSkillStatusReport report={[report[0]!]} task={{ ...task, status: "succeeded", error: undefined, inputJson: JSON.stringify({ metadata: { storyboardMode: "continuous_30s", storyboardPromptReview: { maxInternalShotSeconds: 4, minDirectorScriptChars: 1000 } } }), resultJson: JSON.stringify({ rows: [{ durationSeconds: 30, videoMotionPrompt: "整体设定：同屋。镜头1：起幅：A看B。→ 落幅：递信。镜头2：起幅：B看A。→ 落幅：接信。结尾约束：同场景。" }] }) }} />
            : params.has("static") ? <ChapterSkillStatusReport report={report} task={task} />
            : <ChapterSkillStatus projectId="offline-project" chapterId={chapterId} attempt={chapterId === "chapter-1" ? attempt : undefined} hasStoryboard={!params.has("empty")} />}
    </main>;
}

createRoot(document.getElementById("root")!).render(
    <ConfigProvider theme={getAntThemeConfig(dark)}>
        <App>
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <Harness />
            </QueryClientProvider>
        </App>
    </ConfigProvider>,
);
