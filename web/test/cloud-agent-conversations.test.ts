import { describe, expect, it } from "bun:test";

import { buildCanvasAgentMentionReferences } from "@/lib/canvas/canvas-resource-references";
import { cloudAgentConversationTitle, migrateCloudAgentConversationDocument } from "@/services/cloud-agent-conversations";
import { CanvasNodeType } from "@/types/canvas";

describe("cloud Agent conversations", () => {
    it("exposes every canvas node through stable @ mention tokens", () => {
        const references = buildCanvasAgentMentionReferences([
            { id: "frame-1", type: CanvasNodeType.Frame, title: "第一幕", position: { x: 0, y: 0 }, width: 640, height: 360 },
            { id: "config-1", type: CanvasNodeType.Config, title: "生成配置", position: { x: 700, y: 0 }, width: 320, height: 240, metadata: { prompt: "电影感" } },
        ]);

        expect(references).toHaveLength(2);
        expect(references[0]).toMatchObject({ nodeId: "frame-1", label: "第一幕", active: true, mentionToken: "@[node:frame-1]" });
        expect(references[1]).toMatchObject({ nodeId: "config-1", text: "电影感", mentionToken: "@[node:config-1]" });
    });

    it("uses the first user prompt as a compact history title", () => {
        expect(cloudAgentConversationTitle([{ id: "1", role: "assistant", text: "你好" }])).toBe("新对话");
        expect(cloudAgentConversationTitle([{ id: "2", role: "user", text: "  帮我整理分镜  " }])).toBe("帮我整理分镜");
        expect(cloudAgentConversationTitle([{ id: "3", role: "user", text: "一".repeat(40) }])).toBe(`${"一".repeat(28)}...`);
        expect(cloudAgentConversationTitle([{ id: "4", role: "user", text: "规划短剧 @[skill:internal-skill-id]" }])).toBe("规划短剧 技能包");
    });

    it("migrates saved conversations to canvas editing permissions without dropping history", () => {
        const legacy = {
            version: 1,
            activeId: "conversation-1",
            conversations: [{
                id: "conversation-1", title: "整理分镜", messages: [{ id: "message-1", role: "user", text: "整理分镜" }],
                run: null, permissionMode: "request_approval", createdAt: "2026-10-01", updatedAt: "2026-10-01",
            }],
        };

        expect(migrateCloudAgentConversationDocument(legacy)).toMatchObject({
            version: 2,
            activeId: "conversation-1",
            conversations: [{ id: "conversation-1", permissionMode: "auto", messages: [{ id: "message-1", text: "整理分镜" }] }],
        });
        expect(migrateCloudAgentConversationDocument({ version: 3, activeId: null, conversations: [] })).toBeNull();
    });
});
