import { describe, expect, test } from "bun:test";
import { defaultProjectCoverPrompt, generateProjectCover } from "../src/pages/projects/detail/project-settings-cover-generation";
import { captureUserScope } from "../src/lib/user-scope-guard";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";
import { defaultConfig } from "../src/stores/use-config-store";
import type { Project } from "../src/services/api/projects";
import type { GenerationTask } from "../src/services/api/task-center";
import type { ImageAsset } from "../src/stores/use-asset-store";

const project = {
    id: "project-1",
    name: "海边故事",
    description: "一段关于重逢的故事",
    aspectRatio: "16:9",
    stylePresetId: "",
    styleProfileJson: "",
} as Project;

const task = (patch: Partial<GenerationTask> = {}): GenerationTask => ({
    id: "task-1",
    projectId: project.id,
    type: "canvas_image",
    status: "succeeded",
    prompt: "",
    attempts: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-1" }],
    ...patch,
});

const imageAsset: ImageAsset = {
    id: "asset-1",
    kind: "image",
    title: "生成图片",
    coverUrl: "/api/resources/resource-1/file",
    tags: ["生成"],
    source: "生成任务",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    metadata: { source: "generation-task" },
    data: { dataUrl: "/api/resources/resource-1/file", storageKey: "resource:resource-1", width: 1280, height: 720, bytes: 100, mimeType: "image/png" },
};

type Dependencies = NonNullable<Parameters<typeof generateProjectCover>[1]>;

function dependencies(overrides: Partial<Dependencies> = {}) {
    const saved: Array<[string, string]> = [];
    const updated: unknown[] = [];
    let submitted: unknown;
    const value: Dependencies = {
        submit: async (input) => { submitted = input; return task({ status: "queued" }); },
        wait: async () => task(),
        materialize: async (value: GenerationTask) => value,
        findAsset: () => imageAsset,
        updateAsset: (_id, input) => updated.push(input),
        saveCover: async (projectId: string, resourceId: string) => { saved.push([projectId, resourceId]); },
        ...overrides,
    };
    return { value, saved, updated, get submitted() { return submitted; } };
}

describe("项目封面生成", () => {
    test("提示词带入项目简介和画幅，生成结果会入库并设置为主图", async () => {
        const deps = dependencies();
        const expectedScope = captureUserScope();
        const result = await generateProjectCover({
            project,
            prompt: "可编辑的封面描述",
            config: { ...defaultConfig, model: "image-model", count: "1" },
            expectedScope,
        }, deps.value);

        expect(defaultProjectCoverPrompt(project)).toContain("一段关于重逢的故事");
        expect(defaultProjectCoverPrompt(project)).toContain("16:9");
        expect(deps.submitted).toMatchObject({ projectId: project.id, mode: "image", prompt: "可编辑的封面描述" });
        expect((deps.submitted as { expectedScope?: unknown }).expectedScope).toBe(expectedScope);
        expect(result).toEqual({ assetId: "asset-1", resourceId: "resource-1" });
        expect(deps.updated).toMatchObject([{ title: "海边故事 · 项目封面", tags: ["生成", "项目封面"] }]);
        expect(deps.saved).toEqual([[project.id, "resource-1"]]);
    });

    test("缺少图片产物时不会更改项目主图", async () => {
        const deps = dependencies({ wait: async () => task({ outputs: [] }) });
        await expect(generateProjectCover({ project, prompt: "封面", config: defaultConfig }, deps.value)).rejects.toThrow("没有返回封面图");
        expect(deps.saved).toHaveLength(0);
        expect(deps.updated).toHaveLength(0);
    });

    test("生成等待中切换账号后不会写入另一个账号", async () => {
        const previous = getActiveUserScope();
        setActiveUserScope("cover-owner-a");
        const deps = dependencies({ wait: async () => { setActiveUserScope("cover-owner-b"); return task(); } });
        try {
            await expect(generateProjectCover({ project, prompt: "封面", config: defaultConfig }, deps.value)).rejects.toThrow();
            expect(deps.saved).toHaveLength(0);
            expect(deps.updated).toHaveLength(0);
        } finally {
            setActiveUserScope(previous);
        }
    });
});
