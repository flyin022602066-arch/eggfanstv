import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanvasCharacterReferenceNodeContent } from "../../src/components/canvas/canvas-character-reference-node";
import { CanvasNodeSearchModal } from "../../src/components/canvas/canvas-node-search-modal";
import { CanvasResourceMentionTextarea } from "../../src/components/canvas/canvas-resource-mention-textarea";
import { buildCanvasResourceReferences } from "../../src/lib/canvas/canvas-resource-references";
import { configureApiRuntime } from "../../src/services/api/request";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";

configureApiRuntime(`${location.origin}/api`, "reopened-desktop-token");

const initialNodes: CanvasNodeData[] = [
    { id: "character", type: CanvasNodeType.Text, title: "Character", width: 300, height: 240, position: { x: 0, y: 0 }, metadata: { workflowKind: "character", characterAssetId: "character-asset", characterName: "Character", characterCoverUrl: "http://127.0.0.1:9/api/resources/character-cover/file", characterVisualStatus: "ready" } },
    { id: "image", type: CanvasNodeType.Image, title: "Image", width: 300, height: 240, position: { x: 350, y: 0 }, metadata: { content: "blob:http://old-session/image", storageKey: "resource:image" } },
    { id: "video", type: CanvasNodeType.Video, title: "Video", width: 300, height: 240, position: { x: 700, y: 0 }, metadata: { content: "/original-video.mp4", storageKey: "resource:video", videoPreview: { content: "blob:http://old-session/poster", storageKey: "resource:poster", width: 32, height: 16, sourceKey: "resource:video" } } },
];
const nodes: CanvasNodeData[] = JSON.parse(localStorage.getItem("asset-reopen-nodes") || JSON.stringify(initialNodes));
localStorage.setItem("asset-reopen-nodes", JSON.stringify(nodes));
const references = buildCanvasResourceReferences(nodes, []).map((reference) => ({ ...reference, active: true }));

function Harness() {
    const [value, setValue] = useState("@角色1 @图片1 @视频1");
    const [searchOpen, setSearchOpen] = useState(false);
    return <QueryClientProvider client={new QueryClient()}>
        <div data-testid="character" style={{ width: 300, height: 240 }}><CanvasCharacterReferenceNodeContent node={nodes[0]} /></div>
        <div data-testid="mentions"><CanvasResourceMentionTextarea value={value} onChange={setValue} references={references} /></div>
        <button onClick={() => setSearchOpen(true)}>Search nodes</button>
        <CanvasNodeSearchModal open={searchOpen} nodes={nodes} onClose={() => setSearchOpen(false)} onFocus={() => {}} />
    </QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
