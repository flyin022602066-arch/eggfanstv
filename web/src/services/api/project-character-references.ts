import { compactApiParams, http } from "./request";
import type { CharacterCardSummary } from "./projects";
import type { CapturedUserScope } from "@/lib/user-scope-guard";

export type CharacterReferenceProfile = {
    lookId: string;
    name: string;
    description: string;
    matchHints: string;
    excludeHints: string;
    enabled: boolean;
    preferred: boolean;
    default: boolean;
};

export type CharacterReferenceVersion = CharacterCardSummary & {
    assetId: string;
    title: string;
    referenceProfile?: CharacterReferenceProfile;
    updatedAt: string;
};

export type CharacterReferenceCatalog = { versions: CharacterReferenceVersion[]; revision: number };
export type CharacterReferenceChoice = {
    shotId: string;
    assetId: string;
    versionId: string;
    status: "resolved" | "pending";
    source: "manual" | "auto" | "rule";
    locked: boolean;
    reason: string;
    expectedShotRevisionId: string;
};

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;

export function getCharacterReferenceCatalog(projectId: string, expectedScope?: CapturedUserScope) {
    return http.get<CharacterReferenceCatalog>(`${projectPath(projectId)}/character-versions`, { expectedScope });
}

export function saveCharacterReferenceProfile(projectId: string, version: CharacterReferenceVersion, profile: CharacterReferenceProfile, expectedScope?: CapturedUserScope) {
    return http.patch<{ saved: boolean }>(`${projectPath(projectId)}/characters/${encodeURIComponent(version.assetId)}/versions/${encodeURIComponent(version.versionId)}/reference-profile`, { profile, expectedUpdatedAt: version.updatedAt }, { expectedScope });
}

export function deleteCharacterLookVersion(projectId: string, version: CharacterReferenceVersion, expectedScope?: CapturedUserScope) {
    return http.delete<{ deleted: true }>(`${projectPath(projectId)}/characters/${encodeURIComponent(version.assetId)}/versions/${encodeURIComponent(version.versionId)}`, { params: compactApiParams({ expectedUpdatedAt: version.updatedAt }), expectedScope });
}

export function createCharacterLook(projectId: string, assetId: string, input: { baseVersionId: string; profile: CharacterReferenceProfile; definition: Record<string, unknown> }, expectedScope?: CapturedUserScope) {
    return http.post<{ version: { id: string; assetId: string; version: number } }>(`${projectPath(projectId)}/characters/${encodeURIComponent(assetId)}/looks`, input, { expectedScope });
}

export function extractCharacterLooks(projectId: string, version: CharacterReferenceVersion, expectedScope?: CapturedUserScope) {
    return http.post<{ versions: { id: string; version: number }[] }>(`${projectPath(projectId)}/characters/${encodeURIComponent(version.assetId)}/looks/extract`, { baseVersionId: version.versionId, expectedUpdatedAt: version.updatedAt }, { expectedScope });
}

export function uploadCharacterLookImage(projectId: string, assetId: string, baseVersionId: string, resourceId: string, expectedScope?: CapturedUserScope) {
    return http.put<{ character: CharacterCardSummary }>(`${projectPath(projectId)}/characters/${encodeURIComponent(assetId)}/representations`, { baseVersionId, representations: [{ role: "primary", resourceId }] }, { expectedScope });
}

export function saveCharacterReferenceChoices(projectId: string, unitId: string, input: { expectedRevision: number; choices: CharacterReferenceChoice[] }, expectedScope?: CapturedUserScope) {
    return http.put<{ saved: boolean }>(`${projectPath(projectId)}/units/${encodeURIComponent(unitId)}/character-references`, input, { expectedScope });
}
