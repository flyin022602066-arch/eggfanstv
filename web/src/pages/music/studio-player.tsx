import { Button, InputNumber, Segmented, Select, Slider, Switch, Tooltip } from "antd";
import { AudioLines, CornerDownLeft, Download, Library, MousePointer2, Music2, Pause, Play, Repeat2, Scissors, SkipBack, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getActiveUserScope } from "@/lib/user-scope";
import type { SunoStudioClip, SunoStudioJob } from "@/stores/use-suno-studio-store";
import { clampRange, formatStudioTime, playableUrl } from "./studio-helpers";
import { StudioWaveform } from "./studio-waveform";
import { useStudioMedia } from "./use-studio-media";

export type StudioTrack = { clip: SunoStudioClip; job?: SunoStudioJob; local?: boolean };
type Props = {
    track: StudioTrack | null;
    playIntent: number;
    busy: string | null;
    canApplyRange: boolean;
    onSource: (track: StudioTrack) => void;
    onImport: (track: StudioTrack) => void;
    onDownload: (track: StudioTrack) => void;
    onRange: (range: [number, number]) => void;
};

export function StudioPlayer(props: Props) {
    if (!props.track) return <section className="suno-studio-player suno-studio-player-empty" aria-label="音轨播放器"><div className="suno-studio-section-heading"><AudioLines size={16} /><h2>音轨预览</h2></div><div className="suno-studio-empty"><Music2 size={40} strokeWidth={1} /><h3>尚未选择音轨</h3><span>0:00 / 0:00</span></div></section>;
    return <TrackPlayer key={`${getActiveUserScope()}:${props.track.job?.id || "local"}:${props.track.clip.id}:${props.track.clip.audioUrl || ""}`} {...props} track={props.track} />;
}

function TrackPlayer({ track, playIntent, busy, canApplyRange, onSource, onImport, onDownload, onRange }: Props & { track: StudioTrack }) {
    const audio = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const trackDuration = typeof track.clip.duration === "number" && Number.isFinite(track.clip.duration) ? Math.max(0, track.clip.duration) : 0;
    const [duration, setDuration] = useState(trackDuration);
    const [time, setTime] = useState(0);
    const [range, setRange] = useState<[number, number]>([0, trackDuration]);
    const rangeEdited = useRef(false);
    const [selecting, setSelecting] = useState(false);
    const [loop, setLoop] = useState(false);
    const [volume, setVolume] = useState(0.8);
    const [rate, setRate] = useState(1);
    const [waveformRequested, setWaveformRequested] = useState(false);
    const [error, setError] = useState("");
    const [videoError, setVideoError] = useState("");
    const [playRequest, setPlayRequest] = useState(0);
    const playSequence = useRef(0);
    const pendingPlay = useRef(0);
    const hasAudio = Boolean(track.clip.audioUrl || (track.clip.storageKey && !track.clip.videoUrl));
    const media = useStudioMedia(hasAudio ? track.clip.storageKey : undefined, track.clip.audioUrl);
    const video = useStudioMedia(!hasAudio ? track.clip.storageKey : undefined, track.clip.videoUrl);
    const url = media.url;
    const imageUrl = playableUrl(track.clip.imageUrl);
    const videoUrl = playableUrl(track.clip.videoUrl);
    const seek = (next: number) => {
        if (audio.current && Number.isFinite(next)) {
            try { audio.current.currentTime = next; setTime(next); } catch { setError("音频尚未就绪"); }
        }
    };
    const play = () => {
        if (!audio.current) return;
        const request = ++playSequence.current;
        pendingPlay.current = request;
        setError("");
        void media.load().then((resolved) => {
            if (!resolved || !audio.current || request !== playSequence.current) return;
            setWaveformRequested(true);
            setPlayRequest(request);
        });
    };
    const pause = () => { ++playSequence.current; pendingPlay.current = 0; audio.current?.pause(); };
    useEffect(() => {
        if (!playRequest || pendingPlay.current !== playRequest || !url || !audio.current) return;
        const element = audio.current;
        pendingPlay.current = 0;
        let disposed = false;
        void element.play().catch((cause: unknown) => {
            if (!disposed && playSequence.current === playRequest) setError(cause instanceof Error ? `播放失败：${cause.name}: ${cause.message}` : "播放失败，请检查音频地址");
        });
        return () => { disposed = true; };
    }, [playRequest, url]);
    useEffect(() => {
        if (playIntent > 0) play();
    }, [playIntent]);
    useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);
    useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate]);
    const setAudioDuration = (next: number) => {
        if (!Number.isFinite(next) || next <= 0) return;
        setDuration(next);
        setRange((current) => rangeEdited.current ? clampRange(current[0], current[1], next) : [0, next]);
    };
    const changeRange = (next: [number, number]) => { rangeEdited.current = true; setRange(next); };
    return (
        <section className="suno-studio-player" aria-label="音轨播放器">
            <div className="suno-studio-section-heading"><AudioLines size={16} /><h2>音轨预览</h2><span className="suno-studio-count">{track.local ? "本地引用" : "SUNO"}</span></div>
            <div className="suno-studio-player-scroll">
                <div className="suno-studio-track-heading">
                    <div className="suno-studio-cover">{imageUrl ? <img src={imageUrl} alt={`${track.clip.title || "音轨"}封面`} /> : <Music2 size={30} strokeWidth={1.25} />}</div>
                    <div className="suno-studio-track-info"><h3>{track.clip.title || "未命名音轨"}</h3>{track.clip.tags && <p>{track.clip.tags}</p>}<span className="suno-studio-muted">{track.local ? "本地音频" : track.clip.id}</span></div>
                </div>
                {hasAudio ? <>
                    <audio ref={audio} src={url} preload="none" aria-label={track.clip.title || "音轨音频"} onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => {
                        if (loop && range[1] > range[0]) { seek(range[0]); play(); } else setPlaying(false);
                    }} onError={() => { setPlaying(false); setError("音频暂不可播放，请刷新任务或检查资源地址"); }} onTimeUpdate={(event) => {
                        const current = event.currentTarget.currentTime;
                        if (loop && range[1] > range[0] && (current >= range[1] || current < range[0])) seek(range[0]);
                        else setTime(current);
                    }} />
                    <div className="suno-studio-waveform-toolbar"><span>WAVEFORM</span><Segmented size="small" aria-label="波形操作模式" value={selecting ? "range" : "seek"} options={[{ value: "seek", label: <Tooltip title="定位播放"><span className="suno-studio-segment-icon" aria-label="定位播放"><MousePointer2 size={14} /></span></Tooltip> }, { value: "range", label: <Tooltip title="拖拽选区"><span className="suno-studio-segment-icon" aria-label="拖拽选区"><Scissors size={14} /></span></Tooltip> }]} onChange={(value) => setSelecting(value === "range")} /></div>
                    <StudioWaveform url={url || ""} requested={waveformRequested && Boolean(url)} duration={duration} time={time} range={range} selecting={selecting} onRequest={() => { void media.load().then((resolved) => { if (resolved) setWaveformRequested(true); }); }} onDuration={setAudioDuration} onSeek={seek} onRange={changeRange} />
                    <Slider className="suno-studio-seek" aria-label="播放进度" min={0} max={duration || 1} step={0.1} value={Math.min(time, duration)} disabled={!duration} tooltip={{ formatter: (value) => formatStudioTime(value || 0) }} onChange={seek} />
                    <div className="suno-studio-time-row"><span>{formatStudioTime(time)}</span><span>{formatStudioTime(duration)}</span></div>
                    <div className="suno-studio-transport">
                        <div className="suno-studio-transport-buttons"><Tooltip title="回到开头"><Button type="text" aria-label="回到开头" icon={<SkipBack size={17} />} onClick={() => seek(loop ? range[0] : 0)} /></Tooltip><Tooltip title={playing ? "暂停" : "播放"}><Button className="suno-studio-play-button" type="primary" aria-label={playing ? "暂停" : "播放"} loading={media.loading} icon={playing ? <Pause size={22} /> : <Play size={22} />} onClick={() => playing ? pause() : play()} /></Tooltip></div>
                        <div className="suno-studio-playback-settings"><label className="suno-studio-volume"><Volume2 size={15} /><Slider aria-label="音量" min={0} max={1} step={0.01} value={volume} onChange={setVolume} tooltip={{ formatter: (value) => `${Math.round((value || 0) * 100)}%` }} /></label><Select aria-label="播放速度" size="small" value={rate} options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({ value, label: `${value}x` }))} onChange={setRate} /></div>
                    </div>
                    {error && <div role="alert" className="suno-studio-error">{error}</div>}
                    {media.error && <div role="alert" className="suno-studio-error">本地音频读取失败：{media.error}</div>}
                    {media.warning && <div role="status" className="suno-studio-sync-error">{media.warning}</div>}
                    {track.clip.storageKey && <div className="suno-studio-media-source"><span>{media.loading ? "正在读取本地音频" : media.local ? media.url ? "本地素材" : "本地素材待载入" : "原始音频地址"}</span>{(error || media.error) && <><Button type="text" size="small" onClick={() => { setError(""); void media.load(true); }}>重新读取本地音频</Button>{track.clip.audioUrl && <Button type="text" size="small" onClick={() => { setError(""); media.useOriginal(); }}>尝试原始音频</Button>}</>}</div>}
                    <section className="suno-studio-range-section" aria-label="音频区间">
                        <div className="suno-studio-section-heading"><Scissors size={15} /><h3>区间选择</h3><label className="suno-studio-loop"><Repeat2 size={14} /><span>循环选区</span><Switch size="small" checked={loop} onChange={setLoop} aria-label="循环选区" /></label></div>
                        <Slider range min={0} max={duration || 1} step={0.1} value={range} disabled={!duration} aria-label="选区范围" tooltip={{ formatter: (value) => formatStudioTime(value || 0) }} onChange={(value) => changeRange(clampRange(value[0], value[1], duration))} />
                        <div className="suno-studio-range-inputs"><label>入点 / 秒<InputNumber aria-label="选区入点（秒）" min={0} max={range[1]} step={0.1} precision={2} value={range[0]} disabled={!duration} onChange={(value) => changeRange(clampRange(value ?? 0, range[1], duration))} /></label><span className="suno-studio-range-divider">~</span><label>出点 / 秒<InputNumber aria-label="选区出点（秒）" min={range[0]} max={duration} step={0.1} precision={2} value={range[1]} disabled={!duration} onChange={(value) => changeRange(clampRange(range[0], value ?? duration, duration))} /></label><Tooltip title={canApplyRange ? "将选区填入当前操作" : "当前操作无区间参数"}><Button aria-label="应用选区" icon={<CornerDownLeft size={16} />} disabled={!canApplyRange || range[1] <= range[0]} onClick={() => onRange(range)} /></Tooltip></div>
                    </section>
                </> : <div className="suno-studio-empty suno-studio-audio-unavailable"><Music2 size={32} /><span>音频地址尚未返回</span></div>}
                {!track.local && <div className="suno-studio-track-actions"><Button icon={<CornerDownLeft size={15} />} disabled={!track.job} onClick={() => onSource(track)}>设为源曲</Button><Button icon={<Library size={15} />} loading={busy === `import:${track.clip.id}`} disabled={(!track.clip.audioUrl && !videoUrl) || Boolean(track.clip.assetId) || busy !== null} onClick={() => onImport(track)}>{track.clip.assetId ? "已入素材库" : "加入素材库"}</Button><Tooltip title="下载音轨"><Button aria-label="下载音轨" icon={<Download size={15} />} disabled={(!track.clip.audioUrl && !videoUrl && !track.clip.storageKey) || busy !== null} loading={busy === `download:${track.clip.id}`} onClick={() => onDownload(track)} /></Tooltip></div>}
                {track.clip.lyrics && <section className="suno-studio-track-lyrics"><h3>歌词</h3><pre>{track.clip.lyrics}</pre></section>}
                {videoUrl && <details className="suno-studio-details" onToggle={(event) => { if (event.currentTarget.open) void video.load(); }}><summary>视频</summary>{video.loading && <span className="suno-studio-muted">正在读取视频</span>}<video src={video.url} controls preload="none" aria-label="歌曲视频" onError={() => setVideoError("视频播放失败，请检查资源地址")} />{(video.error || videoError) && <div className="suno-studio-error" role="alert">{video.error || videoError}</div>}{video.warning && <div className="suno-studio-sync-error" role="status">{video.warning}</div>}{(video.error || videoError) && <div className="suno-studio-track-actions"><Button size="small" onClick={() => { setVideoError(""); void video.load(true); }}>重新读取视频</Button><Button size="small" onClick={() => { setVideoError(""); video.useOriginal(); }}>尝试原始视频</Button></div>}</details>}
            </div>
        </section>
    );
}
