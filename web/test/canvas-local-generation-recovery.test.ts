import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-generation.ts"), "utf8");
const projectSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");

describe("local canvas generation recovery", () => {
    test("resource reload reads the existing task in desktop mode without regenerating", () => {
        const start = projectSource.indexOf("const reloadCanvasNodeResource = useCallback(");
        const reload = projectSource.slice(start, projectSource.indexOf("const reconcileImageBatchRootNode", start));
        expect(reload).toContain("queryGenerationTask(taskId)");
        expect(reload).toContain("applyGenerationTaskResult(node.id, task)");
        expect(reload).not.toContain("isLocalWorkspaceMode()");
        expect(reload).not.toContain("createGenerationTask");
        expect(reload).not.toContain("runBackendCanvasGenerationTask");
    });
    test("reconciles persisted task IDs in local workspaces after page reload", () => {
        const start = source.indexOf("const coordinator = recoveryCoordinatorRef.current!");
        const end = source.indexOf("}, [localMode, projectId, projectLoaded, recoverInterruptedGenerationTasks]);", start);
        const recoveryEffect = source.slice(start, end);

        expect(recoveryEffect).toContain("if (!projectLoaded)");
        expect(recoveryEffect).not.toContain("if (localMode)");
    });

    test("only marks orphaned local loads interrupted when they have no task to reconcile", () => {
        const start = source.indexOf("// 本地任务同样持久化在任务表中");
        const end = source.indexOf("}, [localMode, projectLoaded, setNodes]);", start);
        const interruptedFallback = source.slice(start, end);

        expect(interruptedFallback).toContain("metadata.taskId");
    });
});
