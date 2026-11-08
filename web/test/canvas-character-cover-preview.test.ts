import { describe, expect, test } from "bun:test";
import { canvasNodeCharacterCoverStorageKey } from "../src/lib/canvas/canvas-media-preview";
import { buildCanvasAgentMentionReferences, buildCanvasResourceReferences } from "../src/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function character(cover?: string): CanvasNodeData {
    return { id: "character", type: CanvasNodeType.Text, title: "Character", position: { x: 0, y: 0 }, width: 320, height: 260, metadata: { workflowKind: "character", characterAssetId: "character-asset", characterCoverUrl: cover, storageKey: "resource:unrelated-media" } };
}

describe("character cover preview identity", () => {
    test.each([
        ["http://127.0.0.1:17001/api/resources/cover/file", "resource:cover"],
        ["http://localhost:17002/api/resources/cover/file?proxy=1", "resource:cover"],
        ["wails://wails.localhost/api/resources/cover/file", "resource:cover"],
        ["/api/resources/cover/file", "resource:cover"],
        ["https://untrusted.example/api/resources/cover/file", undefined],
        ["data:image/png;base64,AAAA", undefined],
        ["blob:http://localhost/old-session", undefined],
        [undefined, undefined],
    ])("resolves %s without confusing external media or missing covers", (url, expected) => {
        expect(canvasNodeCharacterCoverStorageKey(character(url))).toBe(expected);
    });

    test("both composer and agent references resolve the cover instead of another media key", () => {
        const node = character("http://127.0.0.1:17001/api/resources/cover/file");
        for (const reference of [buildCanvasResourceReferences([node], [])[0], buildCanvasAgentMentionReferences([node])[0]]) {
            expect(reference.kind).toBe("character");
            expect(reference.storageKey).toBe("resource:cover");
        }
        expect(node.metadata?.storageKey).toBe("resource:unrelated-media");
    });
});
