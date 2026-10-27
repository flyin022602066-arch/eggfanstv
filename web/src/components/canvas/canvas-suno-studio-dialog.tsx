import { lazy, Suspense, type ReactNode } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import type { SunoCanvasContext } from "@/lib/suno-canvas-context";

const MusicPage = lazy(() => import("@/pages/music/index").then((module) => ({ default: module.default })));

export function CanvasSunoStudioDialog({ canvas, children }: { canvas: SunoCanvasContext | null; children?: ReactNode }) {
    return (
        <AppModal
            open={Boolean(canvas)}
            centered
            title="Suno 音乐导演台"
            footer={null}
            flush
            width="min(1560px, 96vw)"
            styles={{ container: { height: "min(920px, 92dvh)" }, body: { height: "calc(min(920px, 92dvh) - 55px)", minHeight: 0, overflow: "hidden" } }}
            onCancel={() => canvas?.onClose()}
        >
            {canvas ? (
                <Suspense fallback={<div className="grid h-full min-h-80 place-items-center text-sm text-[var(--muted-foreground)]">正在加载音乐导演台</div>}>
                    {children ?? <MusicPage canvas={canvas} />}
                </Suspense>
            ) : null}
        </AppModal>
    );
}
