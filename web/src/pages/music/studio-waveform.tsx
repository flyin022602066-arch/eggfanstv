import { Button, Spin } from "antd";
import { AudioLines, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function audioPeaks(channels: Float32Array[], count = 720) {
    if (!channels.length || !channels[0].length) return [];
    const length = channels[0].length;
    const buckets = Math.min(count, length);
    return Array.from({ length: buckets }, (_, index) => {
        const start = Math.floor(index * length / buckets);
        const end = Math.floor((index + 1) * length / buckets);
        const stride = Math.max(1, Math.floor((end - start) / 128));
        let peak = 0;
        for (const channel of channels) {
            for (let sample = start; sample < end; sample += stride) peak = Math.max(peak, Math.abs(channel[sample] || 0));
        }
        return Math.min(1, peak);
    });
}

type Props = {
    url: string;
    requested: boolean;
    duration: number;
    time: number;
    range: [number, number];
    selecting: boolean;
    onRequest: () => void;
    onDuration: (duration: number) => void;
    onSeek: (time: number) => void;
    onRange: (range: [number, number]) => void;
};

export function StudioWaveform({ url, requested, duration, time, range, selecting, onRequest, onDuration, onSeek, onRange }: Props) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const anchor = useRef<number | null>(null);
    const [peaks, setPeaks] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const onDurationRef = useRef(onDuration);
    onDurationRef.current = onDuration;
    useEffect(() => {
        if (!requested) return;
        const abort = new AbortController();
        let context: AudioContext | undefined;
        setLoading(true);
        setError("");
        const decode = async () => {
            try {
                const response = await fetch(url, { credentials: "omit", signal: abort.signal });
                if (!response.ok) throw new Error(`音频读取失败 (${response.status})`);
                const data = await response.arrayBuffer();
                if (abort.signal.aborted) return;
                context = new AudioContext();
                const buffer = await context.decodeAudioData(data);
                if (abort.signal.aborted) return;
                setPeaks(audioPeaks(Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))));
                onDurationRef.current(buffer.duration);
            } catch (cause) {
                if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "音频解码失败");
            } finally {
                if (context && context.state !== "closed") void context.close().catch(() => {});
                if (!abort.signal.aborted) setLoading(false);
            }
        };
        void decode();
        return () => { abort.abort(); };
    }, [url, requested, attempt]);

    useEffect(() => {
        const element = canvas.current;
        if (!element || !peaks.length) return;
        const draw = () => {
            const bounds = element.getBoundingClientRect();
            const ratio = window.devicePixelRatio || 1;
            element.width = Math.max(1, Math.round(bounds.width * ratio));
            element.height = Math.max(1, Math.round(bounds.height * ratio));
            const context = element.getContext("2d");
            if (!context) return;
            context.scale(ratio, ratio);
            const style = getComputedStyle(element);
            const ink = style.getPropertyValue("--muted-foreground").trim();
            const accent = style.getPropertyValue("--palette-node-audio").trim();
            const width = bounds.width;
            const height = bounds.height;
            if (duration > 0) {
                context.fillStyle = style.getPropertyValue("--control-selected-bg").trim();
                context.fillRect(range[0] / duration * width, 0, (range[1] - range[0]) / duration * width, height);
            }
            const barWidth = width / peaks.length;
            peaks.forEach((peak, index) => {
                context.fillStyle = duration > 0 && index / peaks.length <= time / duration ? accent : ink;
                const barHeight = Math.max(1, peak * (height - 24));
                context.fillRect(index * barWidth, (height - barHeight) / 2, Math.max(1, barWidth * 0.65), barHeight);
            });
            if (duration > 0) {
                context.fillStyle = style.getPropertyValue("--foreground").trim();
                context.fillRect(time / duration * width, 0, 1, height);
            }
        };
        draw();
        const resize = new ResizeObserver(draw);
        resize.observe(element);
        const theme = new MutationObserver(draw);
        theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
        return () => { resize.disconnect(); theme.disconnect(); };
    }, [peaks, duration, time, range]);

    const pointerTime = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return Math.min(duration, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width) * duration));
    };
    return (
        <div className="suno-studio-waveform" aria-busy={loading}>
            <canvas ref={canvas} aria-label="音频波形" className={selecting ? "suno-studio-waveform-selecting" : undefined} onPointerDown={(event) => {
                if (!duration || !peaks.length) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                const at = pointerTime(event);
                if (selecting) { anchor.current = at; onRange([at, at]); }
                else onSeek(at);
            }} onPointerMove={(event) => {
                if (anchor.current === null) return;
                const at = pointerTime(event);
                onRange([Math.min(at, anchor.current), Math.max(at, anchor.current)]);
            }} onPointerUp={() => { anchor.current = null; }} onPointerCancel={() => { anchor.current = null; }} onLostPointerCapture={() => { anchor.current = null; }} />
            {!peaks.length && <div className="suno-studio-waveform-state">{loading ? <Spin size="small" /> : error ? <><AudioLines size={24} /><span role="status">波形不可用，仍可试听</span><span className="suno-studio-muted">{error}</span><Button type="text" size="small" icon={<RefreshCw size={14} />} onClick={() => setAttempt((current) => current + 1)}>重新加载波形</Button></> : <Button type="text" icon={<AudioLines size={20} />} onClick={onRequest}>加载音频波形</Button>}</div>}
        </div>
    );
}
