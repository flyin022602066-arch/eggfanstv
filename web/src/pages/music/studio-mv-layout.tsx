import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { scopedStorageKey } from "@/lib/user-scope";

const DEFAULT_RATIO = 0.56;
const DIVIDER_WIDTH = 10;
const MIN_CONTROLS_WIDTH = 360;
const MIN_PREVIEW_WIDTH = 320;

type ResizeSession = {
    pointerId: number;
    startRatio: number;
    startX: number;
    startWidth: number;
    available: number;
    storageKey: string;
};

export function StudioMvLayout({ scope, children }: { scope: string; children: [ReactNode, ReactNode] }) {
    const layoutRef = useRef<HTMLDivElement>(null);
    const dividerRef = useRef<HTMLDivElement>(null);
    const ratioRef = useRef(DEFAULT_RATIO);
    const sessionRef = useRef<ResizeSession | null>(null);
    const frameRef = useRef<number | null>(null);
    const storageKey = scopedStorageKey("infinite-canvas:suno-mv-split-ratio", scope);

    const paint = () => {
        layoutRef.current?.style.setProperty("--suno-mv-controls-ratio", String(ratioRef.current));
        const percentage = Math.round(ratioRef.current * 100);
        dividerRef.current?.setAttribute("aria-valuenow", String(percentage));
        dividerRef.current?.setAttribute("aria-valuetext", `制作区 ${percentage}%，预览区 ${100 - percentage}%`);
    };

    const persist = (key: string) => {
        try { window.localStorage.setItem(key, String(ratioRef.current)); } catch {}
    };

    const finishResize = (commit: boolean) => {
        const session = sessionRef.current;
        if (!session) return;
        sessionRef.current = null;
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        if (!commit) ratioRef.current = session.startRatio;
        paint();
        layoutRef.current?.removeAttribute("data-resizing");
        const divider = dividerRef.current;
        if (divider?.hasPointerCapture(session.pointerId)) divider.releasePointerCapture(session.pointerId);
        if (commit) persist(session.storageKey);
    };

    useEffect(() => {
        ratioRef.current = DEFAULT_RATIO;
        try {
            const saved = Number(window.localStorage.getItem(storageKey));
            if (Number.isFinite(saved) && saved > 0 && saved < 1) ratioRef.current = saved;
        } catch {}
        paint();
        const stop = () => finishResize(true);
        window.addEventListener("blur", stop);
        window.addEventListener("resize", stop);
        return () => {
            window.removeEventListener("blur", stop);
            window.removeEventListener("resize", stop);
            finishResize(false);
        };
    }, [storageKey]);

    const bounds = () => {
        const layout = layoutRef.current;
        const divider = dividerRef.current;
        if (!layout || !divider || !divider.getClientRects().length) return null;
        const available = layout.getBoundingClientRect().width - DIVIDER_WIDTH;
        if (available < MIN_CONTROLS_WIDTH + MIN_PREVIEW_WIDTH) return null;
        return { available, width: divider.getBoundingClientRect().left - layout.getBoundingClientRect().left };
    };

    const applyWidth = (width: number, available: number) => {
        ratioRef.current = Math.min(available - MIN_PREVIEW_WIDTH, Math.max(MIN_CONTROLS_WIDTH, width)) / available;
    };

    const startResize = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary || sessionRef.current) return;
        const measured = bounds();
        if (!measured) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        sessionRef.current = { pointerId: event.pointerId, startRatio: ratioRef.current, startX: event.clientX, startWidth: measured.width, available: measured.available, storageKey };
        layoutRef.current?.setAttribute("data-resizing", "true");
    };

    const moveResize = (event: PointerEvent<HTMLDivElement>) => {
        const session = sessionRef.current;
        if (!session || event.pointerId !== session.pointerId) return;
        applyWidth(session.startWidth + event.clientX - session.startX, session.available);
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            paint();
        });
    };

    const keyboardResize = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" && sessionRef.current) {
            event.preventDefault();
            finishResize(false);
            return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || sessionRef.current) return;
        const measured = bounds();
        if (!measured) return;
        event.preventDefault();
        const step = event.shiftKey ? 64 : 24;
        const width = event.key === "Home" ? MIN_CONTROLS_WIDTH : event.key === "End" ? measured.available - MIN_PREVIEW_WIDTH : measured.width + (event.key === "ArrowLeft" ? -step : step);
        applyWidth(width, measured.available);
        paint();
        persist(storageKey);
    };

    return (
        <div className="suno-studio-mv-layout" ref={layoutRef}>
            {children[0]}
            <div
                ref={dividerRef}
                className="suno-studio-mv-divider"
                role="separator"
                tabIndex={0}
                aria-label="调整 MV 制作与预览宽度"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={56}
                title="左右拖动调整宽度；方向键微调，双击恢复默认"
                onPointerDown={startResize}
                onPointerMove={moveResize}
                onPointerUp={(event) => { if (event.pointerId === sessionRef.current?.pointerId) finishResize(true); }}
                onPointerCancel={(event) => { if (event.pointerId === sessionRef.current?.pointerId) finishResize(false); }}
                onLostPointerCapture={(event) => { if (event.pointerId === sessionRef.current?.pointerId) finishResize(true); }}
                onKeyDown={keyboardResize}
                onDoubleClick={() => { finishResize(false); ratioRef.current = DEFAULT_RATIO; paint(); persist(storageKey); }}
            />
            {children[1]}
        </div>
    );
}
