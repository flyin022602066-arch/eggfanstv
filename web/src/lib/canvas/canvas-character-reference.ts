import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectAsset } from "@/services/api/projects";
import type { CanvasNodeData } from "@/types/canvas";

export type CharacterLookDefinition = { name: string; clothing: string; appearance?: string; ageStage?: string; hairstyle?: string; state?: string; matchHints?: string; excludeHints?: string; changeReason?: string; sourceEvidence?: string };
export type CharacterBreakdown = {
    name: string;
    aliases: string[];
    role: string;
    appearance: string;
    clothing: string;
    physique: string;
    personality: string;
    props: string;
    consistencyPrompt: string;
    multiViewPrompt: string;
    voiceLanguage: string;
    voiceAge: string;
    voiceTimbre: string;
    looks?: CharacterLookDefinition[];
};

export function refreshCanvasCharacterReferenceNodes(nodes: CanvasNodeData[], assets: ProjectAsset[]) {
    const characters = new Map(assets.filter((asset) => asset.category === "character" && asset.character).map((asset) => [asset.id, asset]));
    let changed = false;
    const next = nodes.map((node) => {
        const metadata = node.metadata;
        const assetId = metadata?.workflowKind === "character" ? metadata.characterAssetId : "";
        const asset = assetId ? characters.get(assetId) : undefined;
        if (!metadata || !asset?.character || metadata.characterVersionPolicy === "pinned") return node;
        const card = asset.character;
        const cover = card.representations.find((item) => item.role === "turnaround_sheet") || card.representations.find((item) => item.role === "primary") || card.representations.find((item) => item.role === "front");
        const aliases = Array.isArray(card.definition.aliases) ? card.definition.aliases.filter((value): value is string => typeof value === "string") : [];
        const patch = {
            characterVersionId: card.versionId,
            characterName: asset.title,
            characterPrompt: compileCharacterReferencePrompt(asset.title, card.definition),
            characterAliases: aliases,
            characterDefinition: card.definition,
            characterCoverUrl: cover ? resourceFileUrl(cover.resourceId) : undefined,
            characterVisualStatus: card.visualStatus,
            characterVoiceStatus: card.voiceStatus,
            characterVoiceName: card.voice?.profile.name,
            characterVoiceProfile: card.voice ? {
                name: card.voice.profile.name,
                provider: card.voice.profile.provider,
                language: card.voice.profile.language,
                timbre: card.voice.profile.timbre,
            } : undefined,
            characterVoiceInstructions: card.voice?.instructions,
        };
        if (node.title === asset.title
            && metadata.characterVersionId === patch.characterVersionId
            && metadata.characterPrompt === patch.characterPrompt
            && metadata.characterCoverUrl === patch.characterCoverUrl
            && metadata.characterVisualStatus === patch.characterVisualStatus
            && metadata.characterVoiceStatus === patch.characterVoiceStatus
            && metadata.characterVoiceName === patch.characterVoiceName
            && JSON.stringify(metadata.characterDefinition) === JSON.stringify(patch.characterDefinition)
            && JSON.stringify(metadata.characterVoiceProfile) === JSON.stringify(patch.characterVoiceProfile)
            && metadata.characterVoiceInstructions === patch.characterVoiceInstructions
            && (metadata.characterAliases || []).join("\u0000") === aliases.join("\u0000")) return node;
        changed = true;
        return { ...node, title: asset.title, metadata: { ...metadata, ...patch } };
    });
    return changed ? next : nodes;
}

export function compileCharacterReferencePrompt(name: string, definition: Record<string, unknown>) {
    const parts = [definition.role, definition.appearance, definition.physique, definition.clothing, definition.personality, definition.props, definition.consistencyPrompt]
        .map((value) => typeof value === "string" ? value.trim() : "")
        .filter(Boolean);
    return [`【角色卡：${name}】`, ...parts].join("\n");
}

export function normalizeCharacterName(value?: string) {
    return (value || "").toLocaleLowerCase("zh-CN").replace(/^角色[：:]\s*/, "").replace(/[\s·•・._-]+/g, "").trim();
}

function findJsonValueEnd(source: string, start: number) {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === "{" || character === "[") {
            stack.push(character);
            continue;
        }
        if (character !== "}" && character !== "]") continue;
        const opener = stack.pop();
        if ((character === "}" && opener !== "{") || (character === "]" && opener !== "[")) return -1;
        if (!stack.length) return index;
    }
    return -1;
}

// 角色卡数组的最小特征：至少有一个元素带 name 字段。用于把真正的角色数组和模型正文里的
// 旁枝数组（角色名列表、aliases 片段等）区分开，避免提取阶段命中错误片段。
function isCharacterCardArray(value: unknown): value is unknown[] {
    if (!Array.isArray(value) || !value.length) return false;
    return value.some((item) => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string");
}

// 模型偶尔把角色数组再包一层，或把 characters 写成以角色名为键的对象，这里统一摊平成候选列表。
function flattenCharacterCandidates(value: unknown): unknown[] | undefined {
    if (Array.isArray(value)) {
        const result: unknown[] = [];
        value.forEach((item) => {
            if (Array.isArray(item)) {
                result.push(...(flattenCharacterCandidates(item) ?? []));
                return;
            }
            result.push(item);
        });
        return result;
    }
    if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
    return undefined;
}

function normalizeChapterAssetLineWraps(raw: string) {
    let normalized = "";
    let inString = false;
    let escaped = false;
    for (const character of raw) {
        if (inString) {
            if (!escaped && (character === "\n" || character === "\r" || character === "\t")) continue;
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') inString = false;
        } else if (character === '"') {
            inString = true;
        }
        normalized += character;
    }
    return normalized;
}

function extractChapterAssetRootJson(raw: string) {
    const incompleteMessage = "模型未返回完整的章节资产 JSON，不能回填部分角色、场景或道具";
    let result: Record<string, unknown> | undefined;
    let failureMessage = incompleteMessage;
    for (let start = 0; start < raw.length; start += 1) {
        if (raw[start] !== "{" && raw[start] !== "[") continue;
        const end = findJsonValueEnd(raw, start);
        if (end < start) throw new Error(incompleteMessage);
        const source = raw.slice(start, end + 1);
        start = end;
        let parsed: unknown;
        try {
            parsed = JSON.parse(normalizeChapterAssetLineWraps(source));
        } catch {
            result = undefined;
            failureMessage = incompleteMessage;
            continue;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const value = parsed as Record<string, unknown>;
        if (!("characters" in value) && !("scenes" in value) && !Array.isArray(value.props)) continue;
        if (Array.isArray(value.characters) && Array.isArray(value.scenes) && Array.isArray(value.props)) {
            result = value;
        } else {
            result = undefined;
            failureMessage = "章节资产结果缺少角色、场景或道具数组，请重新提取";
        }
    }
    if (result) return result;
    throw new Error(failureMessage);
}

export function extractCharacterBreakdownJson(raw: string, allowEmptyCharacters = false) {
    if (allowEmptyCharacters) return extractChapterAssetRootJson(raw);
    for (let start = 0; start < raw.length; start += 1) {
        if (raw[start] !== "{" && raw[start] !== "[") continue;
        const end = findJsonValueEnd(raw, start);
        if (end < start) continue;
        try {
            const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
            // 顶层角色数组是常见的契约偏离，先判数组再判对象，两者都视为合法载荷。
            if (isCharacterCardArray(parsed)) return parsed;
            // 模型的推理文字可能包含 aliases: [] 等合法 JSON 片段；角色契约只接受带 characters 字段的对象。
            const candidates = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? flattenCharacterCandidates((parsed as { characters?: unknown }).characters) : undefined;
            if (Array.isArray(candidates) && candidates.length) return parsed;
        } catch {
            // Ignore unrelated braces in model prose and continue to the next complete JSON value.
        }
    }
    throw new Error("角色拆解没有返回符合契约的 JSON");
}

export function parseCharacterBreakdown(raw: string): CharacterBreakdown[] {
    const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = extractCharacterBreakdownJson(unfenced);
    const candidates = Array.isArray(parsed) ? flattenCharacterCandidates(parsed) : flattenCharacterCandidates((parsed as { characters?: unknown }).characters);
    if (!Array.isArray(candidates)) throw new Error("角色拆解结果缺少 characters 数组");

    const seen = new Set<string>();
    const aliasOwners = new Map<string, Set<string>>();
    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const value = candidate as Record<string, unknown>;
        const name = normalizeCharacterName(String(value.name || ""));
        for (const alias of Array.isArray(value.aliases) ? value.aliases : []) {
            const key = normalizeCharacterName(String(alias));
            const owners = aliasOwners.get(key) || new Set<string>();
            owners.add(name);
            aliasOwners.set(key, owners);
        }
    }
    const characters: CharacterBreakdown[] = [];
    candidates.forEach((candidate) => {
        if (!candidate || typeof candidate !== "object") return;
        const value = candidate as Record<string, unknown>;
        const name = String(value.name || "").trim();
        const key = normalizeCharacterName(name);
        const aliases = Array.isArray(value.aliases) ? value.aliases.map((alias) => String(alias).trim()).filter((alias) => alias && aliasOwners.get(normalizeCharacterName(alias))?.size === 1) : [];
        const identityKeys = [key, ...aliases.map(normalizeCharacterName)].filter(Boolean);
        if (!name || !key || identityKeys.some((identityKey) => seen.has(identityKey))) return;
        const role = String(value.role || "").trim();
        const descriptiveFields = [value.appearance, value.clothing, value.physique, value.personality, value.consistencyPrompt, value.multiViewPrompt]
            .map((field) => String(field || "").trim())
            .filter(Boolean);
        const voiceLanguage = String(value.voiceLanguage || "").trim();
        const voiceAge = String(value.voiceAge || "").trim();
        const voiceTimbre = String(value.voiceTimbre || "").trim();
        // AI 提取属于角色写入路径：只有名称不足以建立角色卡，避免空设定进入项目后再由用户猜测补全。
        if (!role || descriptiveFields.length < 3 || !voiceLanguage || !voiceAge || !voiceTimbre) throw new Error(`角色“${name}”缺少剧情定位、稳定设定或声音画像，请重新提取`);
        identityKeys.forEach((identityKey) => seen.add(identityKey));
        let looks: CharacterLookDefinition[] | undefined;
        if (value.looks !== undefined) {
            if (!Array.isArray(value.looks) || !value.looks.length || value.looks.length > 24) throw new Error("角色造型数组无效：" + name);
            const names = new Set<string>();
            looks = value.looks.map((item: unknown) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("角色造型格式无效：" + name);
                const source = item as Record<string, unknown>;
                if (typeof source.name !== "string" || !source.name.trim() || typeof source.clothing !== "string" || !source.clothing.trim() || names.has(source.name.trim())) throw new Error("角色造型缺少名称、服装或名称重复：" + name);
                names.add(source.name.trim());
                return Object.fromEntries(Object.entries(source).filter(([key, field]) => ["name", "clothing", "appearance", "ageStage", "hairstyle", "state", "matchHints", "excludeHints", "changeReason", "sourceEvidence"].includes(key) && typeof field === "string").map(([key, field]) => [key, (field as string).trim()])) as CharacterLookDefinition;
            });
        }
        characters.push({
            name,
            aliases: Array.from(new Set(aliases.filter((alias) => normalizeCharacterName(alias) !== key))),
            role,
            appearance: String(value.appearance || "").trim(),
            clothing: String(value.clothing || "").trim(),
            physique: String(value.physique || "").trim(),
            personality: String(value.personality || "").trim(),
            props: String(value.props || "").trim(),
            consistencyPrompt: String(value.consistencyPrompt || "").trim(),
            multiViewPrompt: String(value.multiViewPrompt || "").trim(),
            voiceLanguage,
            voiceAge,
            voiceTimbre,
            ...(looks ? { looks } : {}),
        });
    });
    if (!characters.length) throw new Error("没有从章节正文中识别到可用角色");
    return characters;
}
