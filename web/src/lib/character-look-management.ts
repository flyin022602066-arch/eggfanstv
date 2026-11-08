import { characterLookDisplayVersions, characterLookDraft, characterReferenceImage } from "./character-look-selection";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";
import type { GenerationTask } from "@/services/api/task-center";

export function characterLookKey(version: CharacterReferenceVersion, versions: CharacterReferenceVersion[]) {
    return `${version.assetId}:${characterLookDraft(version, versions).lookId || version.versionId}`;
}

export function characterLookGroups(versions: CharacterReferenceVersion[], focusedVersionId?: string) {
    const grouped = new Map<string, CharacterReferenceVersion[]>();
    for (const version of versions.slice().sort((left, right) => right.version - left.version)) {
        const key = characterLookKey(version, versions);
        const history = grouped.get(key) || [];
        history.push(version);
        grouped.set(key, history);
    }
    const visible = new Set(characterLookDisplayVersions(versions, false, focusedVersionId).map((version) => characterLookKey(version, versions)));
    return [...grouped.entries()].filter(([key]) => visible.has(key)).map(([key, history]) => {
        const confirmed = history.find((version) => version.referenceProfile?.preferred && characterReferenceImage(version));
        const current = history.find((version) => version.versionId === focusedVersionId) || confirmed || history.find((version) => characterReferenceImage(version)) || history[0]!;
        const pending = history.filter((version) => characterReferenceImage(version) && !version.referenceProfile?.preferred && (!confirmed || version.version > confirmed.version));
        return { key, current, confirmed, pending, history };
    }).sort((left, right) => Math.min(...left.history.map((version) => version.version)) - Math.min(...right.history.map((version) => version.version)));
}

export function characterLookTask(task: GenerationTask, versions: CharacterReferenceVersion[]) {
    if (!task.clientContext?.nodeId?.startsWith("character-turnaround:")) return undefined;
    const assetId = task.clientContext.nodeId.slice("character-turnaround:".length);
    let versionId: unknown = task.clientContext.characterVersionId;
    try {
        const input = JSON.parse(task.inputJson || "{}");
        versionId ||= input?.metadata?.characterVersionId;
    } catch {}
    const version = versions.find((item) => item.assetId === assetId && item.versionId === versionId);
    return { assetId, key: version ? characterLookKey(version, versions) : undefined };
}

export function activeCharacterLookKeys(tasks: GenerationTask[], versions: CharacterReferenceVersion[]) {
    const keys = new Set<string>();
    for (const task of tasks) {
        if (task.status !== "queued" && task.status !== "running") continue;
        const target = characterLookTask(task, versions);
        if (!target) continue;
        if (target.key) keys.add(target.key);
        else for (const version of versions.filter((item) => item.assetId === target.assetId)) keys.add(characterLookKey(version, versions));
    }
    return keys;
}

export function newCharacterLookDefinition(base: CharacterReferenceVersion, differences: string, overrides: Record<string, unknown>) {
    return { ...base.definition, clothing: differences.trim(), state: "", ...overrides };
}
