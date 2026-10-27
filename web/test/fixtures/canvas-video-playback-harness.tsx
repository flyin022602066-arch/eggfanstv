import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNodeContent } from "@/components/canvas/canvas-node-content";
import { CanvasNodeActionContext } from "@/components/canvas/canvas-node-action-context";
import { canvasThemes } from "@/lib/canvas-theme";
import { configureApiRuntime } from "@/services/api/request";
import { primeResourceBlobCache } from "@/services/resource-blob-cache";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "@/styles/globals.css";

configureApiRuntime("/api", "synthetic-desktop-token");
await primeResourceBlobCache("resource:video", await (await fetch("/original.mp4")).blob());

function Harness() {
    const [active, setActive] = useState(false);
    const [otherNodeEdits, setOtherNodeEdits] = useState(0);
    const [node, setNode] = useState<CanvasNodeData>({
        id: "video", type: CanvasNodeType.Video, title: "本地视频播放测试", position: { x: 0, y: 0 }, width: 640, height: 360, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        metadata: { status: "success", content: "blob:expired-original", storageKey: "resource:video", mimeType: "video/mp4", naturalWidth: 1280, naturalHeight: 720, hasAudio: true },
    });
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    return <CanvasNodeActionContext.Provider value={{ updateMediaNode: (_id, update) => setNode(update) }}>
        <button type="button" onClick={() => setOtherNodeEdits((count) => count + 1)}>编辑其他节点 {otherNodeEdits}</button>
        <div style={{ width: 640, height: 360, margin: 40 }} data-testid="video-node">
            <CanvasNodeContent node={node} theme={canvasThemes.dark} mediaActive={active} onMediaPlayRequest={() => setActive(true)} isEditingContent={false} textareaRef={textareaRef} isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false} onContentChange={() => undefined} onStopEditing={() => undefined} mentionReferences={[]} />
        </div>
    </CanvasNodeActionContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
