import { expect, test } from "bun:test";
import { captureUserScope } from "@/lib/user-scope-guard";
import { ensureCanvasResourceAssetBindings } from "@/services/project-asset-sync";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const reference = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: "姿势参考", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { storageKey: "resource:pose", referenceTemplateMediaId: "pose" } });

test("template resource assets are confirmed before a canvas snapshot can reference them", async () => {
    const calls: string[] = [];
    const nodes = [reference("pose"), reference("shared-pose")];
    const bound = await ensureCanvasResourceAssetBindings({ canvasId: "canvas", nodes, expectedScope: captureUserScope() }, async options => {
        calls.push(options.node.id);
        expect(options.source).toBe("canvas-upload");
        return { assetId: "asset-pose", created: true, linkedToProject: false, confirmed: true };
    });
    expect(calls).toEqual(["pose"]);
    expect(bound.map(node => node.metadata?.assetId)).toEqual(["asset-pose", "asset-pose"]);
    expect(nodes[0].metadata?.assetId).toBeUndefined();
});

test("unconfirmed resource binding cannot pretend that template media was saved", async () => {
    await expect(ensureCanvasResourceAssetBindings({ canvasId: "canvas", nodes: [reference("pose")], expectedScope: captureUserScope() }, async () => ({ assetId: "pending", created: true, linkedToProject: false, confirmed: false }))).rejects.toThrow("姿势参考");
});

test("cancellation during asset registration cannot publish template bindings", async () => {
    const controller = new AbortController();
    await expect(ensureCanvasResourceAssetBindings({ canvasId: "canvas", nodes: [reference("pose")], expectedScope: captureUserScope(), signal: controller.signal }, async () => {
        controller.abort();
        return { assetId: "asset", created: true, linkedToProject: false, confirmed: true };
    })).rejects.toMatchObject({ name: "AbortError" });
});
