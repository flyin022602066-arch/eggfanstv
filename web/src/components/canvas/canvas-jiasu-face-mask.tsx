import { Button, InputNumber, Select } from "antd";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ScanFace } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { Switch } from "@/components/ui/base/switch";
import { clampJiasuFaceRegion, faceMaskGridOptions, normalizeJiasuFaceMaskMode, renderJiasuFaceMask, type JiasuFaceMaskMode, type JiasuFaceMaskOverrides, type JiasuFaceRegion } from "@/lib/jiasu-face-mask";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { inspectJiasuFaceMask, type JiasuFaceMaskInspection } from "@/services/jiasu-face-mask";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { ReferenceImage } from "@/types/image";

type Props = {
    references: CanvasResourceReference[];
    mode: string;
    overrides?: JiasuFaceMaskOverrides;
    theme: CanvasTheme;
    disabled?: boolean;
    channelLabel?: string;
    onModeChange(mode: JiasuFaceMaskMode): void;
    onSave(overrides: JiasuFaceMaskOverrides): void;
};

function referenceImage(reference: CanvasResourceReference): ReferenceImage {
    return { id: referenceIdentity(reference), name: reference.title, type: "image/png", dataUrl: reference.previewUrl || "", storageKey: reference.storageKey };
}

function referenceIdentity(reference: CanvasResourceReference) {
    return reference.nodeId || reference.assetId || reference.id;
}

export function CanvasJiasuFaceMask({ references, mode, overrides, theme, disabled, channelLabel = "佳速 SD", onModeChange, onSave }: Props) {
    const [open, setOpen] = useState(false);
    const images = references.filter((reference) => reference.active && (reference.kind === "image" || reference.kind === "character") && (reference.previewUrl || reference.storageKey));
    return <>
        <button type="button" className="canvas-node-composer-settings-trigger inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[var(--fs-tiny)]" aria-label={`${channelLabel} 人脸遮罩`} disabled={disabled || !images.length} onClick={() => setOpen(true)} title="自动识别人脸，调整遮罩后再上传参考图">
            <ScanFace className="size-3" />人脸遮罩
        </button>
        {open ? <JiasuFaceMaskEditor references={images} mode={normalizeJiasuFaceMaskMode(mode)} overrides={overrides || {}} theme={theme} channelLabel={channelLabel} onModeChange={onModeChange} onSave={onSave} onClose={() => setOpen(false)} /> : null}
    </>;
}

function JiasuFaceMaskEditor({ references, mode, overrides, theme, channelLabel, onModeChange, onSave, onClose }: Omit<Props, "mode" | "overrides" | "disabled"> & { mode: JiasuFaceMaskMode; overrides: JiasuFaceMaskOverrides; onClose(): void }) {
    const [selectedId, setSelectedId] = useState(references[0] ? referenceIdentity(references[0]) : "");
    const [drafts, setDrafts] = useState<JiasuFaceMaskOverrides>(() => ({ ...overrides }));
    const [inspection, setInspection] = useState<JiasuFaceMaskInspection | null>(null);
    const [regions, setRegions] = useState<JiasuFaceRegion[]>([]);
    const [selectedRegion, setSelectedRegion] = useState("");
    const [preview, setPreview] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [drawing, setDrawing] = useState(false);
    const selected = references.find((reference) => referenceIdentity(reference) === selectedId) || references[0];
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    const draftsRef = useRef(drafts);
    draftsRef.current = drafts;
    const imageIdentity = selected ? `${referenceIdentity(selected)}:${selected.storageKey || selected.previewUrl || ""}` : "";

    useEffect(() => {
        const controller = new AbortController();
        const reference = selectedRef.current;
        setInspection(null);
        setRegions([]);
        setPreview("");
        setLoading(true);
        setError("");
        setDrawing(false);
        if (!reference) {
            setLoading(false);
            return;
        }
        const load = async () => {
            let result: JiasuFaceMaskInspection;
            try {
                result = await inspectJiasuFaceMask(referenceImage(reference), draftsRef.current[referenceIdentity(reference)], controller.signal);
            } catch (cause) {
                if (controller.signal.aborted) return;
                setError(cause instanceof Error ? cause.message : "自动人脸识别失败，请手动框选");
                result = await inspectJiasuFaceMask(referenceImage(reference), undefined, controller.signal, false);
            }
            if (controller.signal.aborted) return;
            setInspection(result);
            setRegions(result.regions);
            setSelectedRegion(result.regions[0]?.id || "");
            setDrafts((current) => ({ ...current, [referenceIdentity(reference)]: { sourceHash: result.sourceHash, storageKey: reference.storageKey, regions: result.regions } }));
        };
        void load().catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取原图失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [imageIdentity]);

    useEffect(() => {
        if (!inspection) return;
        let disposed = false;
        let objectUrl = "";
        const timer = setTimeout(() => {
            void renderJiasuFaceMask(inspection.source, regions, mode).then((blob) => {
                if (disposed) return;
                objectUrl = URL.createObjectURL(blob);
                setPreview(objectUrl);
            }).catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : "遮罩预览失败"); });
        }, 80);
        return () => { disposed = true; clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [inspection, regions, mode]);

    const changeRegions = (next: JiasuFaceRegion[]) => {
        setRegions(next);
        if (selected && inspection) setDrafts((current) => ({ ...current, [referenceIdentity(selected)]: { sourceHash: inspection.sourceHash, storageKey: selected.storageKey, regions: next } }));
    };
    const active = regions.find((region) => region.id === selectedRegion);
    const updateRegion = (patch: Partial<JiasuFaceRegion>) => changeRegions(regions.map((region) => region.id === selectedRegion ? clampJiasuFaceRegion({ ...region, ...patch }) : region));
    return <AppModal open title={`${channelLabel} 参考图人脸遮罩`} width="min(1080px, 94vw)" onCancel={onClose} footer={<><Button onClick={onClose}>取消</Button><Button type="primary" disabled={loading || !inspection} onClick={() => { onSave(drafts); onClose(); }}>保存调整</Button></>}>
        <div className="space-y-3" data-canvas-no-zoom data-canvas-wheel-scroll style={{ color: theme.node.text }}>
            <div className="flex flex-wrap items-center gap-3">
                <span>自动人脸遮罩</span><Switch aria-label="自动人脸遮罩" checked={mode !== "off"} onChange={(enabled) => onModeChange(enabled ? "grid" : "off")} />
                <Select aria-label="人脸遮罩样式" value={mode} onChange={onModeChange} style={{ minWidth: 180 }} options={[...faceMaskGridOptions.map((option) => ({ value: option.value, label: `半透明网格 ${option.label}` })), { value: "mosaic", label: "马赛克" }, { value: "off", label: "不遮罩" }]} />
                <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>预览不会上传图床；开始生成时处理后上传，原图保留。</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="选择遮罩参考图">
                {references.map((reference) => <Button key={referenceIdentity(reference)} aria-pressed={selectedId === referenceIdentity(reference)} disabled={loading} onClick={() => setSelectedId(referenceIdentity(reference))}>{reference.label}</Button>)}
            </div>
            {error ? <div role="alert" className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>{error}</div> : null}
            {loading ? <p role="status">正在本地识别人脸…</p> : !inspection ? <p>无法读取原图，请重新连接参考图。</p> : <>
                <div className="flex flex-wrap items-center gap-2">
                    <span role="status">{regions.length ? `已识别或框选 ${regions.length} 个人脸` : "未识别到人脸，可手动框选补充；不框选则使用原图。"}</span>
                    <Button aria-pressed={drawing} onClick={() => setDrawing(!drawing)}>手动框选</Button>
                    <Button disabled={!active} onClick={() => changeRegions(regions.filter((region) => region.id !== selectedRegion))}>删除选中框</Button>
                    <Button disabled={!regions.length} onClick={() => changeRegions([])}>清空遮罩</Button>
                </div>
                <div className="flex justify-center overflow-auto rounded-[var(--r-md)]" style={{ background: theme.toolbar.itemHover, maxHeight: "55vh" }}>
                    <FaceMaskPreview preview={preview} inspection={inspection} regions={regions} selectedRegion={selectedRegion} drawing={drawing} theme={theme} onSelect={setSelectedRegion} onChange={changeRegions} onDrawComplete={() => setDrawing(false)} />
                </div>
                {active ? <div className="flex flex-wrap items-center gap-3">
                    {([{ key: "x", label: "横坐标", scale: inspection.width }, { key: "y", label: "纵坐标", scale: inspection.height }, { key: "width", label: "宽度", scale: inspection.width }, { key: "height", label: "高度", scale: inspection.height }] as const).map(({ key, label, scale }) => <label key={key} className="flex items-center gap-1 text-[var(--fs-label)]">{label}<InputNumber aria-label={`人脸框${label}`} value={Math.round(active[key] * scale)} min={key === "width" || key === "height" ? 1 : 0} max={scale} precision={0} onChange={(value) => updateRegion({ [key]: (value || 0) / scale })} /></label>)}
                </div> : null}
                <p className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>拖动框移动位置，拖动右下角调整大小。漏检可手动框选；遮罩设置仅应用于当前视频节点的参考图。</p>
            </>}
        </div>
    </AppModal>;
}

function FaceMaskPreview({ preview, inspection, regions, selectedRegion, drawing, theme, onSelect, onChange, onDrawComplete }: { preview: string; inspection: JiasuFaceMaskInspection; regions: JiasuFaceRegion[]; selectedRegion: string; drawing: boolean; theme: CanvasTheme; onSelect(id: string): void; onChange(regions: JiasuFaceRegion[]): void; onDrawComplete(): void }) {
    const drag = useRef<{ kind: "draw" | "move" | "resize"; startX: number; startY: number; region: JiasuFaceRegion; pointerId: number } | null>(null);
    const container = useRef<HTMLDivElement>(null);
    const position = (event: PointerEvent) => {
        const rectangle = container.current!.getBoundingClientRect();
        return { x: Math.max(0, Math.min(1, (event.clientX - rectangle.left) / rectangle.width)), y: Math.max(0, Math.min(1, (event.clientY - rectangle.top) / rectangle.height)) };
    };
    const begin = (event: PointerEvent, kind: "draw" | "move" | "resize", region?: JiasuFaceRegion) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const point = position(event);
        const selected = region || { id: crypto.randomUUID(), x: point.x, y: point.y, width: 0, height: 0 };
        drag.current = { kind, startX: point.x, startY: point.y, region: selected, pointerId: event.pointerId };
        container.current!.setPointerCapture(event.pointerId);
        onSelect(selected.id);
        if (kind === "draw") onChange([...regions, selected]);
    };
    return <div ref={container} className={`relative touch-none ${drawing ? "cursor-crosshair" : ""}`} role="group" aria-label="人脸遮罩编辑区域" style={{ width: Math.min(920, inspection.width), maxWidth: "100%", aspectRatio: `${inspection.width} / ${inspection.height}`, flexShrink: 0 }} onPointerDown={(event) => { if (drawing) begin(event, "draw"); }} onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const point = position(event);
        const shiftX = point.x - current.startX;
        const shiftY = point.y - current.startY;
        const region = current.region;
        const next = current.kind === "move"
            ? { ...region, x: Math.max(0, Math.min(1 - region.width, region.x + shiftX)), y: Math.max(0, Math.min(1 - region.height, region.y + shiftY)) }
            : current.kind === "resize"
                ? clampJiasuFaceRegion({ ...region, width: Math.max(1 / inspection.width, region.width + shiftX), height: Math.max(1 / inspection.height, region.height + shiftY) })
                : clampJiasuFaceRegion({ ...region, width: shiftX, height: shiftY });
        onChange(regions.map((item) => item.id === region.id ? next : item));
    }} onPointerUp={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        drag.current = null;
        if (container.current?.hasPointerCapture(event.pointerId)) container.current.releasePointerCapture(event.pointerId);
        onChange(regions.filter((region) => region.width * inspection.width >= 1 && region.height * inspection.height >= 1));
        if (current.kind === "draw") onDrawComplete();
    }} onPointerCancel={() => { drag.current = null; }}>
        {preview ? <img src={preview} alt="处理后的参考图预览" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain" /> : null}
        {regions.map((region, index) => <div key={region.id} className="absolute border-2" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%`, borderColor: theme.accent.primary, pointerEvents: drawing ? "none" : "auto" }}>
            <button type="button" className="absolute inset-0 cursor-move" aria-label={`移动人脸${index + 1}`} aria-pressed={selectedRegion === region.id} onClick={() => onSelect(region.id)} onPointerDown={(event) => begin(event, "move", region)} />
            <button type="button" className="absolute -right-1 -bottom-1 size-3 cursor-nwse-resize border" style={{ background: theme.accent.primary, borderColor: theme.canvas.background }} aria-label={`调整人脸${index + 1}大小`} onPointerDown={(event) => begin(event, "resize", region)} />
        </div>)}
    </div>;
}
