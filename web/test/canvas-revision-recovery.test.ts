import { afterEach, describe, expect, test } from "bun:test";

import { rebaseCanvasProjects, type CanvasStorageDocument } from "@/lib/canvas/canvas-storage-revision";
import { apiClient } from "@/services/api/request";
import { syncLocalCanvasGenerationProjectToBackend, syncLocalCanvasProjectToBackend } from "@/services/local-workspace-repository";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

function node(id: string, status: string, extra: Record<string, unknown> = {}) {
    return { id, type: "image", title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { status, ...extra } } as never;
}

function project(revision: number, nodes: unknown[], updatedAt: string): CanvasProject {
    return { id: "p1", title: "画布", revision, updatedAt, createdAt: updatedAt, nodes, connections: [], chatSessions: [] } as unknown as CanvasProject;
}

function document_(storageRevision: number, projects: CanvasProject[]): CanvasStorageDocument {
    return { version: 1, storageRevision, tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} }, state: { projects } };
}

// 场景来源（2026-10-12 实测）：同一画布开了两个窗口，窗口 A 把服务端版本推到 669，
// 窗口 B 还停在 668 并在本地生成了结果。旧实现在这种情况下整份返回本地分支，
// 会把 A 新增的节点一起丢掉；现在改为内容 3-way 合并、但保留本地 revision。
describe("画布本地合并：另一窗口写过时的处理", () => {
    const baseProject = project(668, [node("n1", "success"), node("n2", "loading")], "t0");
    const localProject = project(668, [node("n1", "success"), node("n2", "success", { content: "img" })], "t1");
    const durable = document_(900, [project(669, [node("n1", "success"), node("n2", "loading"), node("n3", "success")], "t2")]);

    test("既保留本地生成结果，也不吃掉另一窗口新增的节点", () => {
        const rebased = rebaseCanvasProjects({ document: durable, baseProjects: [baseProject], localProjects: [localProject], baseRevision: 900 });
        const merged = rebased.document.state.projects[0];
        expect(merged.nodes.map((item: { id: string }) => item.id)).toEqual(["n1", "n2", "n3"]);
        const n2 = merged.nodes.find((item: { id: string }) => item.id === "n2") as { metadata: { status: string } };
        expect(n2.metadata.status).toBe("success");
    });

    test("不采纳对方的 revision（版本号由服务端仲裁）", () => {
        const rebased = rebaseCanvasProjects({ document: durable, baseProjects: [baseProject], localProjects: [localProject], baseRevision: 900 });
        expect(rebased.document.state.projects[0].revision).toBe(668);
    });

    test("本地没有改动时直接采用对方版本", () => {
        const rebased = rebaseCanvasProjects({ document: durable, baseProjects: [baseProject], localProjects: [baseProject], baseRevision: 900 });
        expect(rebased.document.state.projects[0].revision).toBe(669);
        expect(rebased.document.state.projects[0].nodes.map((item: { id: string }) => item.id)).toEqual(["n1", "n2", "n3"]);
    });
});

// 场景来源（2026-10-12 实测）：draw 保存日志里 base_revision 卡在旧值、一路 409，
// 于是生成结果永远写不回画布。这里锁死「409 → 读最新版本 → 采纳 → 重试一次」。
describe("画布保存 409 自愈", () => {
    const originalRequest = apiClient.request;
    const originalAssets = useAssetStore.getState().assets;
    afterEach(() => {
        apiClient.request = originalRequest;
        useCanvasStore.setState({ projects: [] });
        useAssetStore.setState({ assets: originalAssets });
    });

    function stubSave(behaviour: { putStatuses: number[]; serverRevision: number }) {
        const calls: Array<{ method: string; url: string; revision?: number }> = [];
        let puts = 0;
        apiClient.request = (async (config: { method?: string; url?: string; data?: unknown }) => {
            const method = String(config.method || "get").toLowerCase();
            const body = typeof config.data === "string" ? JSON.parse(config.data) : (config.data as { project?: { revision?: number } } | undefined);
            calls.push({ method, url: String(config.url || ""), revision: body?.project?.revision });
            if (method === "put") {
                const status = behaviour.putStatuses[puts] ?? 200;
                puts += 1;
                if (status === 409) {
                    throw Object.assign(new Error("画布版本冲突"), { isAxiosError: true, response: { status: 409, data: { code: 40001, msg: "画布版本冲突" } } });
                }
                return { status: 200, data: { code: 0, data: { project: { id: "p1", title: "画布", createdAt: "t0", updatedAt: "t9", revision: 700 } } } };
            }
            return { status: 200, data: { code: 0, data: { project: { id: "p1", revision: behaviour.serverRevision } } } };
        }) as unknown as typeof apiClient.request;
        return calls;
    }

    test("409 后读到服务端版本、采纳并重试一次（重试带上新基准）", async () => {
        useCanvasStore.setState({ projects: [project(668, [node("n1", "success")], "t0")] });
        const calls = stubSave({ putStatuses: [409, 200], serverRevision: 699 });

        await syncLocalCanvasGenerationProjectToBackend("p1");

        expect(calls.map((call) => call.method)).toEqual(["put", "get", "put"]);
        expect(calls[0].revision).toBe(668);
        expect(calls[2].revision).toBe(699);
        expect(useCanvasStore.getState().projects[0].revision).toBe(700);
    });

    test("没有冲突时只发一次保存", async () => {
        useCanvasStore.setState({ projects: [project(668, [node("n1", "success")], "t0")] });
        const calls = stubSave({ putStatuses: [200], serverRevision: 699 });
        await syncLocalCanvasGenerationProjectToBackend("p1");
        expect(calls.map((call) => call.method)).toEqual(["put"]);
    });

    test("普通保存遇到 409 时保留自动媒体绑定和请求期间的新编辑", async () => {
        useAssetStore.setState({ assets: [] });
        useCanvasStore.setState({ projects: [project(668, [node("n1", "success", { storageKey: "resource:image-one" })], "t0")] });
        const writes: Array<{ url: string; project: CanvasProject; assets: Array<{ id: string }> }> = [];
        apiClient.request = (async (config: { method?: string; url?: string; data?: unknown }) => {
            const method = String(config.method || "get").toLowerCase();
            if (method === "get") {
                useCanvasStore.setState((state) => ({
                    projects: state.projects.map((item) => ({ ...item, title: "请求中修改", updatedAt: "t5", nodes: [...item.nodes, node("n2", "success")] })),
                }));
                return { status: 200, data: { code: 0, data: { project: { id: "p1", revision: 699 } } } };
            }
            const body = (typeof config.data === "string" ? JSON.parse(config.data) : config.data) as { project: CanvasProject; assets: Array<{ id: string }> };
            writes.push({ url: String(config.url), ...body });
            if (writes.length === 1) {
                throw Object.assign(new Error("画布版本冲突"), { isAxiosError: true, response: { status: 409, data: { code: 40001, msg: "画布版本冲突" } } });
            }
            return { status: 200, data: { code: 0, data: { project: { id: "p1", revision: 700, updatedAt: "t9" } } } };
        }) as unknown as typeof apiClient.request;

        await syncLocalCanvasProjectToBackend("p1");

        expect(writes.map((write) => write.url)).toEqual(["/canvas-projects/p1/generated-assets", "/canvas-projects/p1/generated-assets"]);
        expect(writes[1].project.revision).toBe(699);
        expect(writes[1].project.nodes.map((item) => item.id)).toEqual(["n1", "n2"]);
        expect(writes[1].project.title).toBe("请求中修改");
        expect(writes[1].assets).toHaveLength(1);
        expect(writes[1].assets[0].id).toBe(writes[0].assets[0].id);
        const saved = useCanvasStore.getState().projects[0];
        expect(saved.revision).toBe(700);
        expect(saved.nodes[0].metadata?.assetId).toBe(writes[1].assets[0].id);
        expect(saved.nodes.map((item) => item.id)).toEqual(["n1", "n2"]);
        expect(useAssetStore.getState().assets).toHaveLength(1);
    });

    test("重试仍失败时向上抛错，不吞掉", async () => {
        useCanvasStore.setState({ projects: [project(668, [node("n1", "success")], "t0")] });
        stubSave({ putStatuses: [409, 409], serverRevision: 699 });
        await expect(syncLocalCanvasGenerationProjectToBackend("p1")).rejects.toThrow();
    });
});
