import { expect, test } from "bun:test";
import { recoverCreationTextTask } from "@/services/creation-text-task-recovery";
import { pendingCreationTaskIds } from "@/services/creation-conversation-store";
import type { GenerationTask } from "@/services/api/task-center";

const succeeded: GenerationTask = {
    id: "task-text", type: "canvas_text", status: "succeeded", prompt: "写剧本", attempts: 1,
    createdAt: "2026-10-28T01:42:00Z", updatedAt: "2026-10-28T01:42:51Z",
    resultJson: JSON.stringify({ mode: "text", text: "已经保存的完整剧本" }),
};

test("a local message error recovers the completed text and clears its false model error", () => {
    expect(recoverCreationTextTask({ mode: "text", status: "error", content: "生成失败", error: "当前模型或接口不可用", generationErrorCode: "model_missing", taskIds: [succeeded.id] }, [succeeded])).toEqual({
        status: "done", content: "已经保存的完整剧本", error: undefined, generationErrorCode: undefined, taskIds: [succeeded.id],
    });
});

test("failed upstream tasks do not become successful through text recovery", () => {
    expect(recoverCreationTextTask({ mode: "text", status: "error", content: "生成失败", taskIds: [succeeded.id] }, [{ ...succeeded, status: "failed", resultJson: undefined, error: "上游失败" }])).toBeNull();
});

test("completed messages are left intact", () => {
    expect(recoverCreationTextTask({ mode: "text", status: "done", content: "用户保留的版本", taskIds: [succeeded.id] }, [succeeded])).toBeNull();
});

test("text messages with a local error are included in result recovery", () => {
    expect(pendingCreationTaskIds([{ id: "conversation", messages: [{ id: "message", role: "assistant", mode: "text", status: "error", taskIds: [succeeded.id] }] }])).toEqual([succeeded.id]);
});
