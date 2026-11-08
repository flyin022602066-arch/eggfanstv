import { extractCharacterBreakdownJson, normalizeCharacterName, parseCharacterBreakdown, type CharacterBreakdown } from "./canvas-character-reference";
import { extractChapterSystemInterfaceProps, missingChapterSystemInterfaceProps, systemInterfaceIdentity } from "../chapter-system-interface";
import { extractSystemElementBlocks } from "../chapter-storyboard-mode";
import { normalizeSystemPresentationSettings, systemCharacterDefinition, type SystemPresentationSettings } from "../chapter-system-presentation";

export type ChapterAssetDefinition = { name: string; description: string; prompt: string; aliases?: string[] };
export type ChapterAssetBreakdown = { characters: CharacterBreakdown[]; scenes: ChapterAssetDefinition[]; props: ChapterAssetDefinition[] };

function withSystemCharacter(candidates: unknown[], sourceText: string, settings: SystemPresentationSettings): unknown[] {
    const blockSource = sourceText.replace(/([【〔\[［])/gu, "\n$1").replace(/([】〕\]］])/gu, "$1\n");
    const blocks = extractSystemElementBlocks(blockSource);
    const interfaces = extractChapterSystemInterfaceProps(sourceText);
    const ordinarySystemContext = /(?:操作|办公|供电|供水|监控|门禁|管理|后台|支付|业务|报名|登记)系统|登录|登陆|密码|服务器|数据库|浏览器|软件|程序|报名表|登记表|表单/u;
    const evidence = [
        ...blocks,
        ...(interfaces.length ? sourceText.split(/[\r\n。！？]/u).filter((line) => systemInterfaceIdentity(line)) : []),
    ].filter((block) => !ordinarySystemContext.test(block) && (
        /宿主|系统(?:提示|播报|通知|消息|启动|激活|绑定|开启|加载|[：:])/u.test(block)
        || /叮|滴/u.test(block) && /系统|宿主|任务|奖励|进化|解锁/u.test(block)
        || /恭喜|警告|获得奖励/u.test(block) && /任务|奖励|进化|解锁|血脉|灵气/u.test(block)
        || systemInterfaceIdentity(block)
    ));
    if (!evidence.length) return candidates;

    const definition = systemCharacterDefinition(settings);
    const normalizedName = normalizeCharacterName(definition.name);
    const identities = (candidate: unknown): string[] => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const character = candidate as Record<string, unknown>;
        return [character.name, ...(Array.isArray(character.aliases) ? character.aliases : [])]
            .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
            .map((name) => name.trim());
    };
    const matches = candidates.map((candidate) => identities(candidate).some((name) => {
        const normalized = normalizeCharacterName(name);
        return normalized === normalizedName || normalized === "系统" || normalized === "系统精灵" || Boolean(systemInterfaceIdentity(name))
            || normalized.endsWith("系统") && evidence.some((block) => normalizeCharacterName(block).includes(normalized));
    }));
    const ordinaryIdentities = new Set(candidates.flatMap((candidate, index) => matches[index] ? [] : identities(candidate).map(normalizeCharacterName)));
    const aliases = new Map<string, string>();
    for (const name of [...definition.aliases, ...candidates.flatMap((candidate, index) => matches[index] ? identities(candidate) : [])]) {
        const normalized = normalizeCharacterName(name);
        if (normalized && normalized !== normalizedName && !ordinaryIdentities.has(normalized) && !aliases.has(normalized)) aliases.set(normalized, name);
    }
    const character = { ...definition, aliases: [...aliases.values()] };
    let inserted = false;
    const result = candidates.flatMap((candidate, index) => {
        if (!matches[index]) return [candidate];
        if (inserted) return [];
        inserted = true;
        return [character];
    });
    if (!inserted) result.push(character);
    return result;
}

export function parseChapterAssetBreakdown(raw: string, sourceText = "", systemPresentation?: SystemPresentationSettings): ChapterAssetBreakdown {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const value: unknown = extractCharacterBreakdownJson(text, true);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("章节资产结果必须是 JSON 对象");
    const payload = value as Record<string, unknown>;
    if (!Array.isArray(payload.characters) || !Array.isArray(payload.scenes) || !Array.isArray(payload.props)) {
        throw new Error("章节资产结果缺少角色、场景或道具数组，请重新提取");
    }
    const parseAssets = (items: unknown[], label: string): ChapterAssetDefinition[] => items.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label}资产格式无效`);
        const asset = item as Record<string, unknown>;
        for (const key of ["name", "description", "prompt"]) {
            if (typeof asset[key] !== "string" || !asset[key].trim()) throw new Error(`${label}资产缺少有效的 ${key}`);
        }
        const aliases = Array.isArray(asset.aliases) ? [...new Set(asset.aliases.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))] : [];
        return { name: (asset.name as string).trim(), description: (asset.description as string).trim(), prompt: (asset.prompt as string).trim(), ...(aliases.length ? { aliases } : {}) };
    });
    const props = parseAssets(payload.props, "道具");
    const settings = normalizeSystemPresentationSettings(systemPresentation);
    const characters = settings.mode === "character" ? withSystemCharacter(payload.characters, sourceText, settings) : payload.characters;
    const parsedCharacters = characters.length ? parseCharacterBreakdown(JSON.stringify({ characters })) : [];
    return {
        characters: parsedCharacters,
        scenes: parseAssets(payload.scenes, "场景"),
        props: settings.mode === "character" ? props.filter((asset) => !systemInterfaceIdentity(asset.name)) : [...props, ...missingChapterSystemInterfaceProps(sourceText, props)],
    };
}
