import type { ProjectAsset } from "@/services/api/projects";
import { extractChapterSystemInterfaceProps, systemInterfaceIdentity } from "./chapter-system-interface";
import { normalizeProjectAssetMentions, projectCharacterAppearances } from "./project-asset-mentions";

export type ShotAssetMatchInput = {
    plotDescription?: string;
    action?: string;
    dialogue?: string;
    imagePrompt?: string;
    videoPrompt?: string;
    continuityNotes?: string;
    negativePrompt?: string;
    characters?: unknown[];
    assetBindings?: Array<{ nodeId: string; selectionSource?: "manual" | "auto" | "rule"; selectionLocked?: boolean }>;
    sceneAssetId?: string;
    sceneName?: string;
    sceneChange?: boolean;
    propNames?: string[];
    systemElements?: string[];
    systemPresentation?: import("./chapter-system-presentation").SystemPresentationSettings;
    chapterSourceText?: string;
};

export type MatchedShotAsset = { asset: ProjectAsset; assetVersionId: string; selectionSource?: "manual" | "auto" | "rule"; selectionLocked?: boolean };
export type MissingShotAsset = { name: string; category: "environment" | "prop" };
export type ShotAssetAmbiguity = { key: string; name: string; assets: ProjectAsset[] };
export type ShotAssetMatchOptions = {
    includeUnlistedProps?: boolean;
    assetSelections?: Record<string, string>;
    onAmbiguousAsset?: (issue: ShotAssetAmbiguity) => void;
};

export function matchProjectShotCharacters(assets: ProjectAsset[], input: ShotAssetMatchInput) {
    return matchProjectShotAssets(assets.filter((asset) => asset.category === "character"), { ...input, sceneAssetId: undefined, sceneName: undefined, propNames: [] });
}

export function matchProjectShotAssets(assets: ProjectAsset[], input: ShotAssetMatchInput, options: ShotAssetMatchOptions = {}): MatchedShotAsset[] {
    const candidates = assets.filter((asset) => asset.primaryVersionId);
    const byId = new Map(candidates.map((asset) => [asset.id, asset]));
    const text = normalizeProjectAssetMentions([input.plotDescription, input.action, input.imagePrompt, input.videoPrompt, input.continuityNotes].filter(Boolean).join("\n"), assets).normalize("NFKC");
    const appearanceSource = normalizeProjectAssetMentions([input.plotDescription, input.action, input.imagePrompt, input.videoPrompt].filter(Boolean).join("\n"), assets, text);
    const characterIdentities = candidates.filter((asset) => asset.category === "character").map((asset) => ({ assetId: asset.id, name: asset.title, aliases: assetNames(asset).slice(1) }));
    const chapterCharacters = input.chapterSourceText?.trim() ? new Set(projectCharacterAppearances(input.chapterSourceText, characterIdentities).map((character) => character.assetId)) : undefined;
    const visibleCharacters = new Set(projectCharacterAppearances(appearanceSource, characterIdentities).filter((character) => !chapterCharacters || chapterCharacters.has(character.assetId)).map((character) => character.assetId));
    if (input.systemPresentation?.mode === "character" && input.systemElements?.length) {
        for (const asset of candidates) if (asset.category === "character" && assetNames(asset).some((name) => normalizeName(name) === normalizeName(input.systemPresentation!.characterName))) visibleCharacters.add(asset.id);
    }
    const hasAppearanceContext = Boolean(appearanceSource.trim() || input.dialogue?.trim() || input.continuityNotes?.trim() || input.chapterSourceText?.trim());
    const matches = new Map<string, MatchedShotAsset>();
    const requestedNames = new Set<string>();
    const add = (asset: ProjectAsset | undefined, versionId?: string) => {
        if (!asset?.primaryVersionId) return;
        if (input.systemPresentation?.mode === "character" && asset.category === "prop" && systemInterfaceIdentity(asset.title)) return;
        const previous = matches.get(asset.id);
        matches.set(asset.id, { asset, assetVersionId: versionId || previous?.assetVersionId || asset.primaryVersionId });
    };
    const matchName = (name: string, category?: string) => {
        requestedNames.add(`${category}:${normalizeName(name)}`);
        const bound = candidates.filter((asset) => (!category || asset.category === category) && matches.has(asset.id) && assetNames(asset).some((value) => normalizeName(value) === normalizeName(name)));
        if (category === "prop" && bound.length) {
            for (const asset of bound) add(asset);
            return;
        }
        const named = findNamedAsset(candidates, name, category, options);
        if (named && (category !== "character" || !hasAppearanceContext || visibleCharacters.has(named.id))) add(named);
        else if (category === "environment") {
            for (const location of sceneLocations(name, candidates)) add(findNamedAsset(candidates, location, category, options));
        }
    };

    if (input.sceneAssetId) {
        const scene = byId.get(input.sceneAssetId);
        if (scene?.category !== "environment") throw new Error(`场景“${input.sceneName || input.sceneAssetId}”不在本项目可绑定资产中，请确认场景资产`);
        add(scene);
    }
    if (input.sceneName && (!input.sceneAssetId || sceneLocations(input.sceneName, candidates).length > 1)) {
        matchName(input.sceneName, "environment");
    }
    for (const binding of input.assetBindings || []) {
        const asset = byId.get(binding.nodeId);
        if (asset?.category !== "character" || binding.selectionSource === "manual" || binding.selectionLocked || visibleCharacters.has(asset.id)) add(asset);
    }
    for (const name of input.propNames || []) matchName(name, "prop");
    const systemText = input.systemElements?.length ? input.systemElements.join("\n") : [input.action, input.imagePrompt, input.videoPrompt].filter(Boolean).join("\n");
    const interfaceAssets = candidates.filter((asset) => asset.category === "prop" && systemInterfaceIdentity(asset.title));
    for (const panel of input.systemPresentation?.mode === "character" ? [] : extractChapterSystemInterfaceProps(systemText)) {
        if (interfaceAssets.some((asset) => matches.has(asset.id))) break;
        const identity = systemInterfaceIdentity(panel.name);
        const exact = interfaceAssets.filter((asset) => systemInterfaceIdentity(asset.title) === identity);
        const compatible = exact.length ? exact : interfaceAssets.filter((asset) => identity === "系统" || systemInterfaceIdentity(asset.title) === "系统");
        if (compatible.length === 1) add(compatible[0]);
    }
    for (const value of input.characters || []) {
        if (typeof value === "string") {
            matchName(value, "character");
            continue;
        }
        if (!value || typeof value !== "object") continue;
        const character = value as Record<string, unknown>;
        const asset = typeof character.characterAssetId === "string" ? byId.get(character.characterAssetId) : undefined;
        if (asset?.category === "character" && (!hasAppearanceContext || visibleCharacters.has(asset.id))) add(asset, typeof character.characterVersionId === "string" ? character.characterVersionId : undefined);
        else if (typeof character.characterName === "string") matchName(character.characterName, "character");
    }

    for (const token of text.matchAll(/@\[asset:([^\]]+)\]/g)) {
        const asset = byId.get(token[1]!);
        if (asset?.category !== "character" || visibleCharacters.has(asset.id)) add(asset);
    }
    const named = candidates.filter((asset) => {
        if (!["character", "environment", "prop"].includes(asset.category)) return false;
        if (asset.category === "environment" && (input.sceneAssetId || input.sceneName)) return false;
        if (asset.category === "prop" && input.propNames && !options.includeUnlistedProps) return false;
        if (asset.category === "character") return visibleCharacters.has(asset.id);
        const visibleText = asset.category === "prop" && options.includeUnlistedProps
            ? [input.plotDescription, input.action, input.imagePrompt, input.videoPrompt].filter(Boolean).join("\n").normalize("NFKC")
            : text;
        return assetNames(asset).some((name) => containsName(visibleText, name));
    });
    for (const asset of named) {
        if (matches.has(asset.id)) continue;
        const duplicates = named.filter((candidate) => candidate.category === asset.category && normalizeName(candidate.title) === normalizeName(asset.title));
        if (duplicates.length > 1) {
            const key = `${asset.category}:${normalizeName(asset.title)}`;
            if (requestedNames.has(key) || duplicates.some((candidate) => matches.has(candidate.id))) continue;
            requestedNames.add(key);
            add(resolveAmbiguousAsset(duplicates, asset.title, asset.category, options));
            continue;
        }
        add(asset);
    }
    return Array.from(matches.values());
}

export function missingProjectShotAssets(assets: ProjectAsset[], input: ShotAssetMatchInput): MissingShotAsset[] {
    const missing = new Map<string, MissingShotAsset>();
    const check = (name: string, category: MissingShotAsset["category"]) => {
        const value = name.trim();
        if (value && !namedProjectAssets(assets, value, category).length) missing.set(`${category}:${normalizeName(value)}`, { name: value, category });
    };
    const explicitScene = assets.find((asset) => asset.id === input.sceneAssetId && asset.category === "environment");
    if (input.sceneName && (!explicitScene || sceneLocations(input.sceneName, assets).length > 1) && !namedProjectAssets(assets, input.sceneName, "environment").length) {
        for (const location of sceneLocations(input.sceneName, assets)) check(location, "environment");
    }
    for (const name of input.propNames || []) check(name, "prop");
    return [...missing.values()];
}

export function matchProjectShotSequenceAssets(assets: ProjectAsset[], shots: Array<{ script: ShotAssetMatchInput; existing?: MatchedShotAsset[] }>, options: ShotAssetMatchOptions = {}): MatchedShotAsset[][] {
    let previousScenes: MatchedShotAsset[] = [];
    return shots.map(({ script, existing = [] }) => {
        const matched = matchProjectShotAssets(assets, { ...script, assetBindings: [...(script.assetBindings || []), ...existing.filter(({ asset }) => asset.category === "prop").map(({ asset }) => ({ nodeId: asset.id }))] }, options);
        const currentExisting = existing.filter((match) => match.asset.category !== "character" || !isAutomaticShotAssetReference(match) || matched.some(({ asset }) => asset.id === match.asset.id)).map((match) => ({
            ...match,
            assetVersionId: match.asset.category === "environment" || match.asset.category === "prop" ? match.asset.primaryVersionId || match.assetVersionId : match.assetVersionId,
        }));
        const pinnedScenes = currentExisting.filter(({ asset }) => asset.category === "environment");
        const declaredScenes = matched.filter(({ asset }) => asset.category === "environment");
        const transition = script.sceneChange || Boolean(script.sceneName) || /(?:^|\n)\s*(?:转场|切至|切到|场景切换|闪回|回忆画面|换景|外景)[：:，,\s]/.test([script.plotDescription, script.imagePrompt, script.continuityNotes].filter(Boolean).join("\n"));
        const scenes = pinnedScenes.length ? [...pinnedScenes, ...(sceneLocations(script.sceneName || "", assets).length > 1 ? declaredScenes : [])] : declaredScenes.length ? declaredScenes : transition ? [] : previousScenes;
        previousScenes = scenes;
        const byId = new Map([...matched.filter(({ asset }) => asset.category !== "environment" || scenes.some((scene) => scene.asset.id === asset.id)), ...scenes, ...currentExisting].map((match) => [match.asset.id, match]));
        return Array.from(byId.values());
    });
}

export function isAutomaticShotAssetReference(reference: { selectionSource?: string; selectionLocked?: boolean }) {
    return !reference.selectionLocked && (reference.selectionSource === "auto" || reference.selectionSource === "rule");
}

export function shotActionBeats(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
    if (typeof value !== "string") return [];
    try { return shotActionBeats(JSON.parse(value)); } catch { return []; }
}

export function shotAssetContext(value: unknown): Pick<ShotAssetMatchInput, "sceneAssetId" | "sceneName" | "sceneChange" | "propNames" | "systemPresentation" | "systemElements"> {
    const system = shotActionBeats(value).find((beat) => beat.type === "system_elements");
    const context = shotActionBeats(value).find((beat) => beat.type === "asset_context");
    const presentation = {
        ...(system?.presentation && typeof system.presentation === "object" && (system.presentation as { mode?: unknown }).mode === "character" ? { systemPresentation: system.presentation as ShotAssetMatchInput["systemPresentation"] } : {}),
        ...(Array.isArray(system?.elements) ? { systemElements: system.elements.filter((element): element is string => typeof element === "string") } : {}),
    };
    if (!context) return presentation;
    return {
        ...presentation,
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
    const names = [asset.title, ...(asset.category === "character" && typeof definition?.name === "string" ? [definition.name] : []), ...(Array.isArray(aliases) ? aliases.filter((value): value is string => typeof value === "string") : [])].map((value) => value.trim()).filter(Boolean);
    return [...new Set(names.flatMap((name) => asset.category === "character" && /^(?:其余|其餘|其他|另外|剩余|剩餘)[一二三四五六七八九十百两兩\d]+(?:位|名|个|個)/u.test(name) ? [name, name.replace(/^((?:其余|其餘|其他|另外|剩余|剩餘))[一二三四五六七八九十百两兩\d]+(?:位|名|个|個)/u, "$1")] : [name]))];
}

function normalizeName(value: string) {
    return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function namedProjectAssets(assets: ProjectAsset[], name: string, category?: string) {
    const key = normalizeName(name);
    let named = assets.filter((asset) => (!category || asset.category === category) && assetNames(asset).some((value) => normalizeName(value) === key));
    if (category === "prop" || category === "environment") {
        const exact = named.filter((asset) => normalizeName(asset.title) === key);
        if (exact.length) named = exact;
    }
    if (!named.length && category === "environment" && sceneLocations(name).length === 1) named = assets.filter((asset) => asset.category === category && assetNames(asset).some((value) => sceneNamesEquivalent(name, value)));
    return named;
}

function findNamedAsset(assets: ProjectAsset[], name: string, category: string | undefined, options: ShotAssetMatchOptions) {
    const named = namedProjectAssets(assets, name, category);
    if (named.length > 1) return resolveAmbiguousAsset(named, name, category, options);
    return named[0];
}

function resolveAmbiguousAsset(assets: ProjectAsset[], name: string, category: string | undefined, options: ShotAssetMatchOptions) {
    const key = `${category || assets[0]?.category || ""}:${normalizeName(name)}`;
    const selected = assets.find((asset) => asset.id === options.assetSelections?.[key]);
    if (selected) return selected;
    if (options.onAmbiguousAsset) {
        options.onAmbiguousAsset({ key, name, assets });
        return undefined;
    }
    throw new Error(`资产“${name}”存在重名（多个同名资产），请在镜头资产列表按名称和资产 ID 绑定正确资产后再生成`);
}

function sceneLocations(value: string, assets: ProjectAsset[] = []) {
    return value.split(/\s*(?:→|、|；|;)\s*/u).flatMap((location) => {
        if (assets.some((asset) => asset.category === "environment" && assetNames(asset).some((name) => normalizeName(name) === normalizeName(location)))) return [location.trim()];
        return location.split(/\s*(?:与|以及|及)\s*/u).map((name) => name.trim());
    }).filter(Boolean);
}

function sceneNamesEquivalent(left: string, right: string) {
    const normalizeSceneName = (value: string) => normalizeName(value).replace(/[\s\p{P}\p{S}]/gu, "").replace(/(?:核心班|普通班|基础班|少年班)(?=教室$)/u, "").replace(/[厅堂室处殿院屋房]$/u, "");
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
