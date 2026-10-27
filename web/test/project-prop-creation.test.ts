import { expect, test } from "bun:test";

import { createProjectPropAsset } from "../src/services/project-prop-creation";
import type { ProjectAsset, ProjectAssetCandidate, ProjectAssetCandidatePage } from "../src/services/api/projects";

function fixture() {
    const calls: unknown[] = [];
    const asset = { id: "prop-8", title: "残缺古籍", category: "prop", primaryVersionId: "prop-v1" } as ProjectAsset;
    const candidate = { id: "candidate-8", name: "残缺古籍", category: "prop", status: "pending_confirmation" } as ProjectAssetCandidate;
    const api = {
        listProjectAssets: async (_projectId: string) => ({ assets: [] as ProjectAsset[] }),
        listProjectAssetCandidates: async (_projectId: string, options?: unknown) => {
            calls.push(["list-candidates", options]);
            return { candidates: [], hasMore: false } as unknown as ProjectAssetCandidatePage;
        },
        createProjectAssetCandidates: async (_projectId: string, candidates: unknown, source?: string) => {
            calls.push(["create", candidates, source]);
            return { candidates: [candidate] };
        },
        confirmProjectAssetCandidate: async (_projectId: string, candidateId: string) => {
            calls.push(["confirm", candidateId]);
            return { asset };
        },
    };
    return { api, asset, candidate, calls };
}

test("manual prop creation confirms its definition and retains episode association", async () => {
    const { api, calls } = fixture();
    const result = await createProjectPropAsset({ projectId: "project", unitId: "episode-8", name: " 残缺古籍 ", description: " 泛黄的古代线装书 ", aliases: "古籍、旧书\n古籍" }, api);
    expect(result.asset.id).toBe("prop-8");
    expect(result.reused).toBe(false);
    expect(calls).toContainEqual(["create", [{ name: "残缺古籍", category: "prop", unitId: "episode-8", details: { description: "泛黄的古代线装书", aliases: ["古籍", "旧书"] } }], "manual"]);
    expect(calls.at(-1)).toEqual(["confirm", "candidate-8"]);
});

test("an existing prop is reused for missing-image repair instead of creating a duplicate", async () => {
    const { api, calls, asset } = fixture();
    api.listProjectAssets = async () => ({ assets: [{ ...asset, definitionJson: JSON.stringify({ aliases: ["旧书"] }) }] });
    const result = await createProjectPropAsset({ projectId: "project", unitId: "episode-8", name: "旧书" }, api);
    expect(result.reused).toBe(true);
    expect(result.asset.id).toBe(asset.id);
    expect(calls).toEqual([]);
});

test("a pending prop is confirmed on retry even when it is on a later candidate page", async () => {
    const { api, calls, candidate } = fixture();
    api.listProjectAssetCandidates = async (_projectId, options) => {
        const page = (options as { page: number }).page;
        return { candidates: page === 1 ? [] : [candidate], hasMore: page === 1 } as unknown as ProjectAssetCandidatePage;
    };
    await createProjectPropAsset({ projectId: "project", name: "残缺古籍" }, api);
    expect(calls).toEqual([["confirm", "candidate-8"]]);
});

test("blank names, ambiguous existing props and failed writes are surfaced", async () => {
    const { api, calls, asset } = fixture();
    await expect(createProjectPropAsset({ projectId: "project", name: " " }, api)).rejects.toThrow("道具名称");
    expect(calls).toEqual([]);
    api.listProjectAssets = async () => ({ assets: [asset, { ...asset, id: "duplicate" }] });
    await expect(createProjectPropAsset({ projectId: "project", name: asset.title }, api)).rejects.toThrow("重名");
    api.listProjectAssets = async () => ({ assets: [] });
    api.confirmProjectAssetCandidate = async () => { throw new Error("保存失败"); };
    await expect(createProjectPropAsset({ projectId: "project", name: asset.title }, api)).rejects.toThrow("保存失败");
});
