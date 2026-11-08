import type { ProjectAssetCandidate } from "@/services/api/projects";

export function characterCandidateReview(candidate: ProjectAssetCandidate) {
    let details: Record<string, unknown> = {};
    try { details = JSON.parse(candidate.detailsJson); } catch { details = {}; }
    const match = details?._characterMatch;
    if (!match || typeof match !== "object" || Array.isArray(match)) return { label:"确认角色（自动核对总库）", description:"确认时自动核对项目已有角色，同名角色不会重复新建", ambiguous:false };
    const value = match as Record<string,unknown>;
    const title = typeof value.title === "string" ? value.title : candidate.name;
    const description = typeof value.description === "string" ? value.description : "";
    return { label:value.mode === "new_look" ? `归入${title}的新造型` : value.mode === "ambiguous" ? "请选择归并目标" : "沿用已有角色", description, ambiguous:value.mode === "ambiguous" };
}
