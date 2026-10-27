import { Button } from "antd";
import { ChevronRight, CornerDownLeft, FileText } from "lucide-react";
import type { SunoStudioJob } from "@/stores/use-suno-studio-store";
import { studioPersonaId, studioResultDetails, studioResultLinks, studioTextResults } from "./studio-helpers";
import { StudioJobStatus } from "./studio-queue";

type Props = { job: SunoStudioJob | undefined; onApply: (kind: "lyrics" | "tags" | "persona", text: string) => void };

export function StudioResults({ job, onApply }: Props) {
    if (!job) return null;
    const texts = studioTextResults(job.result);
    const links = studioResultLinks(job.result);
    const personaId = job.operationId === "post-suno-submit-persona" ? studioPersonaId(job.result) : undefined;
    return <section className="suno-studio-results" aria-label="任务结果">
        <div className="suno-studio-section-heading"><FileText size={16} /><h2>任务结果</h2><StudioJobStatus job={job} /></div>
        {job.error && <div className="suno-studio-job-error" role="status">{job.error}</div>}
        {job.syncError && <div className="suno-studio-sync-error" role="status">同步 / 查询不可用：{job.syncError}</div>}
        {personaId && <div className="suno-studio-text-result"><p>歌手风格 ID：{personaId}</p><Button size="small" onClick={() => onApply("persona", personaId)}>用于歌手风格一致创作</Button></div>}
        {links.length > 0 && <div className="suno-studio-text-result"><div className="suno-studio-section-heading"><h3>返回资源</h3></div>{links.map((link) => <p key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></p>)}</div>}
        {texts.map((result) => <div className="suno-studio-text-result" key={result.path}><div className="suno-studio-text-result-heading"><span>{result.kind === "tags" ? "风格标签" : result.kind === "lyrics" ? "歌词" : "文本结果"}</span><div className="suno-studio-text-result-actions">{result.kind !== "tags" && <Button size="small" icon={<CornerDownLeft size={13} />} onClick={() => onApply("lyrics", result.text)}>用于歌词</Button>}<Button size="small" icon={<CornerDownLeft size={13} />} onClick={() => onApply("tags", result.text)}>用于风格</Button></div></div><pre>{result.text}</pre></div>)}
        {job.result !== undefined && <details className="suno-studio-details"><summary><ChevronRight size={14} />结果数据</summary><pre className="suno-studio-result-json">{studioResultDetails(job.result)}</pre></details>}
        <details className="suno-studio-details"><summary><ChevronRight size={14} />任务参数</summary><dl className="suno-studio-job-details"><dt>操作</dt><dd>{job.operationId}</dd><dt>本地 ID</dt><dd>{job.id}</dd>{job.taskId && <><dt>查询 ID</dt><dd>{job.taskId}</dd></>}</dl><pre className="suno-studio-result-json">{studioResultDetails(job.values)}</pre></details>
    </section>;
}
