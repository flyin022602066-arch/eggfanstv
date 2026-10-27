import { Music2 } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";

export function CanvasSunoStudioEntry({ onClick, tabIndex = 0, style }: { onClick: () => void; tabIndex?: number; style?: React.CSSProperties }) {
    const stopCanvasEvent = (event: MouseEvent | PointerEvent) => event.stopPropagation();
    return (
        <button
            type="button"
            data-canvas-no-zoom
            className="canvas-node-inline-action inline-flex h-8 items-center gap-1.5 rounded-[var(--r-sm)] border px-2 text-[var(--fs-tiny)] font-medium backdrop-blur-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={style}
            aria-label="打开 Suno 音乐导演台"
            title="打开 Suno 音乐导演台"
            tabIndex={tabIndex}
            onMouseDown={stopCanvasEvent}
            onPointerDown={stopCanvasEvent}
            onClick={(event) => { event.stopPropagation(); onClick(); }}
        >
            <Music2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span>音乐导演台</span>
        </button>
    );
}
