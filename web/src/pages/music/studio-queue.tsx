import { Button, Input, Segmented, Tooltip } from "antd";
import { Check, CircleAlert, Clock3, CornerDownLeft, Download, Library, ListMusic, LoaderCircle, Play, RefreshCw, RotateCcw, Search } from "lucide-react";
import { useState } from "react";
import type { SunoStudioClip, SunoStudioJob } from "@/stores/use-suno-studio-store";
import { formatStudioTime, playableUrl } from "./studio-helpers";
import type { StudioTrack } from "./studio-player";

export function StudioJobStatus({ job }: { job: SunoStudioJob }) {
    const labels = { submitting: "提交中", queued: "排队中", running: "制作中", succeeded: "已完成", failed: "失败", unknown: "状态待确认" };
    const Icon = job.status === "succeeded" ? Check : job.status === "failed" || job.status === "unknown" ? CircleAlert : job.status === "queued" ? Clock3 : LoaderCircle;
    return <span className={`suno-studio-status suno-studio-status-${job.status}`}><Icon size={12} /><span>{labels[job.status]}</span></span>;
}

type Props = {
    jobs: SunoStudioJob[];
    selectedJobId: string | null;
    selectedClipId?: string;
    busy: string | null;
    onSelect: (id: string) => void;
    onRefresh: (id: string) => void;
    onQuery: (id: string) => void;
    onRestore: (id: string) => void;
    onListen: (track: StudioTrack) => void;
    onSource: (track: StudioTrack) => void;
    onImport: (track: StudioTrack) => void;
    onDownload: (track: StudioTrack) => void;
};

export function StudioQueue({ jobs, selectedJobId, selectedClipId, busy, onSelect, onRefresh, onQuery, onRestore, onListen, onSource, onImport, onDownload }: Props) {
    const [tab, setTab] = useState("jobs");
    const [query, setQuery] = useState("");
    const needle = query.toLocaleLowerCase();
    const filtered = jobs.filter((job) => [job.label, job.taskId, job.id, ...job.clips.map((clip) => clip.title)].join(" ").toLocaleLowerCase().includes(needle));
    const active = jobs.filter((job) => ["submitting", "queued", "running"].includes(job.status)).length;
    return (
        <aside className="suno-studio-queue" aria-label="任务和结果队列">
            <div className="suno-studio-section-heading"><ListMusic size={16} /><h2>制作队列</h2><span className="suno-studio-count">{active ? `${active} 进行中` : `${jobs.length} 个任务`}</span></div>
            <div className="suno-studio-queue-toolbar"><Segmented block size="small" aria-label="队列视图" value={tab} options={[{ value: "jobs", label: "任务" }, { value: "clips", label: `音轨 · ${jobs.reduce((count, job) => count + job.clips.length, 0)}` }]} onChange={(value) => setTab(String(value))} /><Input prefix={<Search size={14} />} placeholder="搜索任务或音轨" aria-label="搜索任务或音轨" value={query} allowClear onChange={(event) => setQuery(event.target.value)} /></div>
            <div className="suno-studio-queue-scroll">
                {tab === "jobs" ? filtered.map((job) => <article key={job.id} className={`suno-studio-job ${job.id === selectedJobId ? "suno-studio-job-selected" : ""}`}>
                    <button type="button" className="suno-studio-job-select" aria-pressed={job.id === selectedJobId} onClick={() => onSelect(job.id)}><div className="suno-studio-job-heading"><strong>{job.label}</strong><StudioJobStatus job={job} /></div><div className="suno-studio-job-meta"><time dateTime={new Date(job.createdAt).toISOString()}>{new Date(job.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time><span>{job.clips.length} 音轨</span></div>{job.taskId && <code className="suno-studio-task-id">{job.taskId}</code>}</button>
                    {job.error && <div className="suno-studio-job-error" role="status">{job.error}</div>}
                    {job.syncError && <div className="suno-studio-sync-error" role="status"><CircleAlert size={13} /><span>同步 / 查询不可用：{job.syncError}</span></div>}
                    <div className="suno-studio-job-actions">{(job.status === "unknown" || job.syncError) && <Tooltip title="手动输入任务 ID 查询"><Button type="text" size="small" aria-label="查询原任务" icon={<Search size={14} />} disabled={busy !== null} onClick={() => onQuery(job.id)} /></Tooltip>}<Tooltip title="恢复参数，不重新提交"><Button type="text" size="small" aria-label={`恢复${job.label}参数`} icon={<RotateCcw size={14} />} disabled={busy !== null} onClick={() => onRestore(job.id)} /></Tooltip><Tooltip title={job.taskId ? "恢复 / 刷新查询" : "无查询 ID，无法确认上游状态"}><Button type="text" size="small" aria-label={`刷新${job.label}状态`} icon={<RefreshCw size={14} />} loading={busy === `refresh:${job.id}`} disabled={!job.taskId || busy !== null} onClick={() => onRefresh(job.id)} /></Tooltip></div>
                    {job.id === selectedJobId && job.clips.map((clip) => <QueueClip key={clip.id} clip={clip} job={job} selected={selectedClipId === clip.id} busy={busy} onListen={onListen} onSource={onSource} onImport={onImport} onDownload={onDownload} />)}
                </article>) : filtered.flatMap((job) => job.clips.map((clip) => <QueueClip key={`${job.id}:${clip.id}`} clip={clip} job={job} selected={job.id === selectedJobId && clip.id === selectedClipId} busy={busy} onListen={onListen} onSource={onSource} onImport={onImport} onDownload={onDownload} />))}
                {(!filtered.length || (tab === "clips" && !filtered.some((job) => job.clips.length))) && <div className="suno-studio-empty suno-studio-queue-empty"><ListMusic size={30} strokeWidth={1.25} /><span>{query ? "没有匹配结果" : tab === "jobs" ? "暂无制作任务" : "暂无音轨"}</span></div>}
            </div>
            <footer className="suno-studio-queue-footer"><span>{jobs.filter((job) => job.status === "succeeded").length} 完成</span><span>{jobs.filter((job) => job.status === "failed").length} 失败</span><span>{jobs.filter((job) => job.syncError || job.status === "unknown").length} 待确认</span></footer>
        </aside>
    );
}

function QueueClip({ clip, job, selected, busy, onListen, onSource, onImport, onDownload }: Pick<Props, "busy" | "onListen" | "onSource" | "onImport" | "onDownload"> & { clip: SunoStudioClip; job: SunoStudioJob; selected: boolean }) {
    const track = { clip, job };
    const url = playableUrl(clip.audioUrl);
    const image = playableUrl(clip.imageUrl);
    return <div className={`suno-studio-clip-row ${selected ? "suno-studio-clip-selected" : ""}`}>
        <div className="suno-studio-clip-main"><Tooltip title="试听音轨"><Button type="text" className="suno-studio-clip-play" aria-label={`试听${clip.title || "音轨"}`} disabled={!url && !clip.storageKey && !playableUrl(clip.videoUrl)} onClick={() => onListen(track)}>{image ? <img src={image} alt="" loading="lazy" /> : null}<Play size={16} /></Button></Tooltip><div className="suno-studio-clip-info"><strong>{clip.title || "未命名音轨"}</strong><span>{clip.tags || formatStudioTime(clip.duration || 0)}</span></div></div>
        <div className="suno-studio-clip-actions"><Tooltip title="设为源曲"><Button type="text" size="small" aria-label={`将${clip.title || "音轨"}设为源曲`} icon={<CornerDownLeft size={13} />} onClick={() => onSource(track)} /></Tooltip><Tooltip title={clip.assetId ? "已加入素材库" : "加入素材库"}><Button type="text" size="small" aria-label={`将${clip.title || "音轨"}加入素材库`} icon={clip.assetId ? <Check size={13} /> : <Library size={13} />} disabled={(!url && !playableUrl(clip.videoUrl) && !clip.storageKey) || Boolean(clip.assetId) || busy !== null} loading={busy === `import:${clip.id}`} onClick={() => onImport(track)} /></Tooltip><Tooltip title="下载音轨"><Button type="text" size="small" aria-label={`下载${clip.title || "音轨"}`} icon={<Download size={13} />} disabled={(!url && !playableUrl(clip.videoUrl) && !clip.storageKey) || busy !== null} loading={busy === `download:${clip.id}`} onClick={() => onDownload(track)} /></Tooltip></div>
    </div>;
}
