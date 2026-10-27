import type { ProjectAsset } from "@/services/api/projects";

export type ShotAssetMatchInput = {
    plotDescription?: string;
    action?: string;
    dialogue?: string;
    imagePrompt?: string;
    videoPrompt?: string;
    continuityNotes?: string;
    negativePrompt?: string;
    characters?: unknown[];
    assetBindings?: Array<{ nodeId: string }>;
    sceneAssetId?: string;
    sceneName?: string;
    sceneChange?: boolean;
    propNames?: string[];
};

export type MatchedShotAsset = { asset: ProjectAsset; assetVersionId: string };
type ShotAssetMatchOptions = { includeUnlistedProps?: boolean };

export function matchProjectShotAssets(assets: ProjectAsset[], input: ShotAssetMatchInput, options: ShotAssetMatchOptions = {}): MatchedShotAsset[] {
    const candidates = assets.filter((asset) => asset.primaryVersionId);
    const byId = new Map(candidates.map((asset) => [asset.id, asset]));
    const matches = new Map<string, MatchedShotAsset>();
    const add = (asset: ProjectAsset | undefined, versionId?: string) => {
        if (!asset?.primaryVersionId) return;
        const previous = matches.get(asset.id);
        matches.set(asset.id, { asset, assetVersionId: versionId || previous?.assetVersionId || asset.primaryVersionId });
    };
    const matchName = (name: string, category?: string) => {
        const key = normalizeName(name);
        let named = candidates.filter((asset) => (!category || asset.category === category) && assetNames(asset).some((value) => normalizeName(value) === key));
        if (!named.length && category === "environment") {
            named = candidates.filter((asset) => asset.category === "environment" && assetNames(asset).some((value) => sceneNamesEquivalent(name, value)));
        }
        if (named.length > 1) throw new Error(`资产“${name}”存在重名，请手动选择对应版本后再生成`);
        add(named[0]);
    };

    if (input.sceneAssetId) {
        const scene = byId.get(input.sceneAssetId);
        if (scene?.category !== "environment") throw new Error(`场景“${input.sceneName || input.sceneAssetId}”不在本项目可绑定资产中，请确认场景资产`);
        add(scene);
    } else if (input.sceneName) {
        matchName(input.sceneName, "environment");
    }
    for (const binding of input.assetBindings || []) add(byId.get(binding.nodeId));
    for (const name of input.propNames || []) matchName(name, "prop");
    for (const value of input.characters || []) {
        if (typeof value === "string") {
            matchName(value, "character");
            continue;
        }
        if (!value || typeof value !== "object") continue;
        const character = value as Record<string, unknown>;
        const asset = typeof character.characterAssetId === "string" ? byId.get(character.characterAssetId) : undefined;
        if (asset) add(asset, typeof character.characterVersionId === "string" ? character.characterVersionId : undefined);
        else if (typeof character.characterName === "string") matchName(character.characterName, "character");
    }

    const text = [input.plotDescription, input.action, input.imagePrompt, input.videoPrompt, input.continuityNotes].filter(Boolean).join("\n").normalize("NFKC");
    for (const token of text.matchAll(/@\[asset:([^\]]+)\]/g)) add(byId.get(token[1]!));
    const named = candidates.filter((asset) => {
        if (!["character", "environment", "prop"].includes(asset.category)) return false;
        if (asset.category === "environment" && (input.sceneAssetId || input.sceneName)) return false;
        if (asset.category === "prop" && input.propNames && !options.includeUnlistedProps) return false;
        if (asset.category === "character" && input.characters?.length) return false;
        const visibleText = asset.category === "prop" && options.includeUnlistedProps
            ? [input.plotDescription, input.action, input.imagePrompt, input.videoPrompt].filter(Boolean).join("\n").normalize("NFKC")
            : asset.category === "character" ? text.split("\n").filter((line) => !/画外音|仅声音|场外声音/.test(line)).join("\n") : text;
        return assetNames(asset).some((name) => containsName(visibleText, name));
    });
    for (const asset of named) {
        if (matches.has(asset.id)) continue;
        const duplicates = named.filter((candidate) => candidate.category === asset.category && normalizeName(candidate.title) === normalizeName(asset.title));
        if (duplicates.length > 1) throw new Error(`资产“${asset.title}”存在重名，请手动选择对应版本后再生成`);
        add(asset);
    }
    return Array.from(matches.values());
}

export function matchProjectShotSequenceAssets(assets: ProjectAsset[], shots: Array<{ script: ShotAssetMatchInput; existing?: MatchedShotAsset[] }>, options: ShotAssetMatchOptions = {}): MatchedShotAsset[][] {
    let previousScenes: MatchedShotAsset[] = [];
    return shots.map(({ script, existing = [] }) => {
        const matched = matchProjectShotAssets(assets, script, options);
        const pinnedScenes = existing.filter(({ asset }) => asset.category === "environment");
        const declaredScenes = matched.filter(({ asset }) => asset.category === "environment");
        const transition = script.sceneChange || Boolean(script.sceneName) || /(?:^|\n)\s*(?:转场|切至|切到|场景切换|闪回|回忆画面|换景|外景)[：:，,\s]/.test([script.plotDescription, script.imagePrompt, script.continuityNotes].filter(Boolean).join("\n"));
        const scenes = pinnedScenes.length ? pinnedScenes : declaredScenes.length ? declaredScenes : transition ? [] : previousScenes;
        previousScenes = scenes;
        const byId = new Map([...matched.filter(({ asset }) => asset.category !== "environment" || scenes.some((scene) => scene.asset.id === asset.id)), ...scenes, ...existing].map((match) => [match.asset.id, match]));
        return Array.from(byId.values());
    });
}

export function shotActionBeats(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
    if (typeof value !== "string") return [];
    try { return shotActionBeats(JSON.parse(value)); } catch { return []; }
}

export function shotAssetContext(value: unknown): Pick<ShotAssetMatchInput, "sceneAssetId" | "sceneName" | "sceneChange" | "propNames"> {
    const context = shotActionBeats(value).find((beat) => beat.type === "asset_context");
    if (!context) return {};
    return {
        ...(typeof context.sceneAssetId === "string" ? { sceneAssetId: context.sceneAssetId } : {}),
        ...(typeof context.sceneName === "string" ? { sceneName: context.sceneName } : {}),
        ...(typeof context.sceneChange === "boolean" ? { sceneChange: context.sceneChange } : {}),
        ...(Array.isArray(context.propNames) ? { propNames: context.propNames.filter((name): name is string => typeof name === "string") } : {}),
    };
}

function assetNames(asset: ProjectAsset) {
    let definition = asset.character?.definition;
    if (!definition && asset.definitionJson) {
        try {
            definition = JSON.parse(asset.definitionJson) as Record<string, unknown>;
        } catch {
            definition = undefined;
        }
    }
    const aliases = definition?.aliases;
    return [asset.title, ...(Array.isArray(aliases) ? aliases.filter((value): value is string => typeof value === "string") : [])].map((value) => value.trim()).filter(Boolean);
}

function normalizeName(value: string) {
    return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function sceneNamesEquivalent(left: string, right: string) {
    const normalizeSceneName = (value: string) => normalizeName(value).replace(/[\s\p{P}\p{S}]/gu, "").replace(/[厅堂室处殿院屋房]$/u, "");
    const leftName = normalizeSceneName(left);
    const rightName = normalizeSceneName(right);
    if (!leftName || !rightName) return false;
    if (leftName === rightName) return true;
    const leftCharacters = Array.from(leftName);
    const rightCharacters = Array.from(rightName);
    let suffixLength = 0;
    while (suffixLength < leftCharacters.length && suffixLength < rightCharacters.length && leftCharacters[leftCharacters.length - suffixLength - 1] === rightCharacters[rightCharacters.length - suffixLength - 1]) suffixLength += 1;
    const suffix = leftCharacters.slice(leftCharacters.length - suffixLength).join("");
    return suffixLength >= 4 && /^\p{Script=Han}+$/u.test(suffix);
}

function containsName(text: string, name: string) {
    const key = normalizeName(name);
    if (!key) return false;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "iu").test(text);
}
