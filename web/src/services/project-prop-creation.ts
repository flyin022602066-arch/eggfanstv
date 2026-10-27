import { confirmProjectAssetCandidate, createProjectAssetCandidates, listProjectAssetCandidates, listProjectAssets } from "@/services/api/projects";

const defaultApi = { confirmProjectAssetCandidate, createProjectAssetCandidates, listProjectAssetCandidates, listProjectAssets };

export async function createProjectPropAsset(input: { projectId: string; unitId?: string; name: string; description?: string; aliases?: string }, api = defaultApi) {
    const name = input.name.trim();
    if (!name) throw new Error("请输入道具名称");
    const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
    const aliases = Array.from(new Set((input.aliases || "").split(/[\n,，、;；]/).map((value) => value.trim()).filter(Boolean)));
    const names = new Set([name, ...aliases].map(normalize));
    const matches = (title: string, definitionJson?: string) => {
        let otherAliases: unknown;
        try { otherAliases = JSON.parse(definitionJson || "{}").aliases; } catch { otherAliases = undefined; }
        return [title, ...(Array.isArray(otherAliases) ? otherAliases.filter((value): value is string => typeof value === "string") : [])].some((value) => names.has(normalize(value)));
    };
    const { assets } = await api.listProjectAssets(input.projectId);
    const existing = assets.filter((asset) => asset.category === "prop" && matches(asset.title, asset.definitionJson));
    if (existing.length > 1) throw new Error(`道具“${name}”存在重名，请在角色与资产中选择对应道具`);
    if (existing[0]) return { asset: existing[0], reused: true };

    const pending = [];
    for (let page = 1; ; page += 1) {
        const result = await api.listProjectAssetCandidates(input.projectId, { page, pageSize: 200, category: "prop", status: "pending_confirmation" });
        pending.push(...result.candidates.filter((candidate) => matches(candidate.name, candidate.detailsJson)));
        if (!result.hasMore) break;
    }
    if (pending.length > 1) throw new Error(`道具“${name}”有多个待确认版本，请先在角色与资产中确认`);
    let candidate = pending[0];
    if (!candidate) {
        const result = await api.createProjectAssetCandidates(input.projectId, [{
            name,
            category: "prop",
            ...(input.unitId ? { unitId: input.unitId } : {}),
            details: { description: input.description?.trim() || "", aliases },
        }], "manual");
        candidate = result.candidates[0];
    }
    if (!candidate) throw new Error("道具已存在或正在保存，请刷新角色与资产后重试");
    const result = await api.confirmProjectAssetCandidate(input.projectId, candidate.id);
    return { asset: result.asset, reused: false };
}
