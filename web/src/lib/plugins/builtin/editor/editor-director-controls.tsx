import type { DirectorSettings } from "@/lib/timeline/ai-director-plan";
import type { ProjectAsset } from "@/services/api/projects";
import type { TimelineProject } from "@/types/timeline";

const CONTROL = "mt-1 h-7 w-full min-w-0 rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] px-1.5 text-[11px] text-[var(--director-dock-fg)] [&>option]:bg-[var(--director-sequencer-surface)]";

export function EditorDirectorControls({ settings, onChange, sourceMode, onSourceModeChange, selectedIds, onSelectionChange, assets, project, disabled }: {
    settings: DirectorSettings;
    onChange: (settings: DirectorSettings) => void;
    sourceMode: "timeline" | "library";
    onSourceModeChange: (mode: "timeline" | "library") => void;
    selectedIds: string[];
    onSelectionChange: (ids: string[]) => void;
    assets: ProjectAsset[];
    project: TimelineProject | null;
    disabled: boolean;
}) {
    const media = assets.filter(asset => ["video", "image"].includes(asset.mediaType) && asset.storageKey);
    const music = sourceMode === "timeline" ? (project?.clips || []).filter(clip => clip.kind === "audio").map(clip => ({ id: clip.id, title: clip.title || clip.id }))
        : assets.filter(asset => asset.mediaType === "audio" && asset.storageKey).map(asset => ({ id: `asset:${asset.id}`, title: asset.title }));
    return <details open className="shrink-0 border-b border-[var(--director-sequencer-border)] px-3 py-2 text-[11px] text-[var(--director-dock-fg)]">
        <summary className="cursor-pointer font-medium">成片要求与素材</summary>
        <fieldset disabled={disabled} className="mt-2 space-y-2 disabled:opacity-50">
            <div className="grid grid-cols-2 gap-2">
                <label>剪辑风格<select aria-label="剪辑风格" className={CONTROL} value={settings.style} onChange={event => onChange({ ...settings, style: event.target.value as DirectorSettings["style"] })}>
                    <option value="drama">剧情短剧 · 情绪与对白</option><option value="montage">精彩混剪 · 高燃节奏</option><option value="auto">根据素材自动决定</option>
                </select></label>
                <label>目标时长<select aria-label="目标时长" className={CONTROL} value={settings.targetDurationMs} onChange={event => onChange({ ...settings, targetDurationMs: Number(event.target.value) })}>
                    <option value={0}>按内容自然决定</option>{[30, 60, 90, 180, 300].map(seconds => <option key={seconds} value={seconds * 1000}>{seconds} 秒左右</option>)}
                </select></label>
                <label>叙事节奏<select aria-label="叙事节奏" className={CONTROL} value={settings.pace} onChange={event => onChange({ ...settings, pace: event.target.value as DirectorSettings["pace"] })}>
                    <option value="natural">自然表演 · 保留呼吸</option><option value="tight">紧凑叙事 · 删去冗余</option><option value="energetic">高能节奏 · 重点突出</option>
                </select></label>
                <label>素材范围<select aria-label="素材范围" className={CONTROL} value={sourceMode} onChange={event => onSourceModeChange(event.target.value as "timeline" | "library")}>
                    <option value="timeline">当前时间线</option><option value="library">项目媒体库</option>
                </select></label>
            </div>
            {sourceMode === "library" && <details>
                <summary className="cursor-pointer">选择视频与图片（已选 {selectedIds.length}）</summary>
                <div className="mt-1 flex gap-3"><button type="button" onClick={() => onSelectionChange(media.filter(asset => asset.mediaType === "video").map(asset => asset.id))} className="underline">只选视频</button><button type="button" onClick={() => onSelectionChange(media.map(asset => asset.id))} className="underline">全选</button><button type="button" onClick={() => onSelectionChange([])} className="underline">清空</button></div>
                <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">
                    {media.map(asset => <label key={asset.id} className="flex items-center gap-2"><input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={event => onSelectionChange(event.target.checked ? [...selectedIds, asset.id] : selectedIds.filter(id => id !== asset.id))} /><span className="min-w-0 truncate" title={asset.title}>{asset.mediaType === "video" ? "视频" : "图片"} · {asset.title}</span></label>)}
                    {!media.length && <p>项目中还没有媒体，请先在左侧媒体库导入视频。</p>}
                </div>
            </details>}
            <label className="block">背景音乐<select aria-label="背景音乐" className={CONTROL} value={settings.musicClipId} onChange={event => onChange({ ...settings, musicClipId: event.target.value })}>
                <option value="">保留原声，不额外配乐</option>{music.map(clip => <option key={clip.id} value={clip.id}>{clip.title}</option>)}
            </select></label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                <label className="flex items-center gap-1"><input type="checkbox" checked={settings.protectDialogue} onChange={event => onChange({ ...settings, protectDialogue: event.target.checked })} />保护完整对白</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={settings.subtitles} onChange={event => onChange({ ...settings, subtitles: event.target.checked })} />根据识别对白添加字幕</label>
            </div>
            <p className="text-[var(--director-dock-fg)]/60">原素材保留；方案会重新编排当前时间线，可整批撤销。配乐压低音量并淡入淡出，目标时长优先服从完整表演。</p>
        </fieldset>
    </details>;
}
