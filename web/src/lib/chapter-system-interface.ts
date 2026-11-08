import { extractSystemElementBlocks } from "./chapter-storyboard-mode";

export type SystemInterfaceProp = { name: string; description: string; prompt: string };

const interfaceNamePattern = /(?:系统|属性|状态|宿主|任务|技能)(?:信息)?(?:面板|界面|窗口|弹窗)|状态栏|全息(?:面板|界面)/u;
const statusFieldPattern = /(?:^|[\n【〔\[［])\s*(宿主|状态|形态|等级|血脉(?:进化)?模板|进化点|灵气|属性|经验|积分|技能|天赋)\s*[：:]/gu;
const namedSystemPattern = /(?:^|[【〔\[［\s：:，,。！!——])([\p{Script=Han}A-Za-z0-9]{1,18}系统)(?=启动|激活|绑定|开启|加载|面板|界面|[】〕\]］：:])/gu;

export const systemInterfaceReferenceRule = "系统面板参考图只约束外框、配色、材质和布局；不得照抄参考图中的文字或数值。本镜显示的姓名、形态、等级、进度、资源和任务状态以本镜原文及系统/界面元素为准，按本镜出现顺序更新；未给出的数值留空，不从其他章节或参考图补造。无文字要求不删除剧情所需的系统界面文字。";

export function systemInterfaceTemplatePrompt(name: string, sourceText: string): string {
    const fields = [...new Set(Array.from(sourceText.matchAll(statusFieldPattern), (match) => match[1]!))];
    return [
        `设计可复用的${name}界面道具参考图。单独正视展示完整面板的边框、信息分区、层级和布局。`,
        "具体视觉造型服从项目画风，原文未明确的颜色与材质由项目美术统一设计；背景简洁，不画宿主、人物、蛋或其他主体形象，不附加场景，不把系统拟人化。",
        fields.length ? `仅按以下字段标签设计布局：${fields.join("、")}。` : "预留状态、属性与提示信息的分区。",
        "数值区域留空，进度条保持空槽，不填写姓名、形态、等级、百分比、资源数量或任务结果；仅可保留系统标题与固定字段标签。",
        "具体文字、数值及亮起变化由分镜逐镜提供，参考图仅作为界面模板，不将任何章节的状态固定为所有镜头的状态。",
    ].join("\n");
}

export function systemInterfaceIdentity(name: string): string | null {
    const normalized = name.normalize("NFKC").trim();
    if (!interfaceNamePattern.test(normalized)) return null;
    const system = normalized.match(/^(.+?系统)/u)?.[1];
    return system && system !== "系统" ? system : "系统";
}

export function extractChapterSystemInterfaceProps(sourceText: string): SystemInterfaceProp[] {
    const source = sourceText.replace(/\r\n?/g, "\n").replace(/([】〕\]］])\s*(?=[【〔\[［])/gu, "$1\n");
    const namedSystems = [...new Set(Array.from(source.matchAll(namedSystemPattern), (match) => match[1]!))];
    const blocks = [...extractSystemElementBlocks(source), ...source.split("\n").filter((line) => interfaceNamePattern.test(line))];
    let statusLines: string[] = [];
    const collectStatusLines = () => {
        const block = statusLines.join("\n").trim();
        const fields = new Set(Array.from(block.matchAll(statusFieldPattern), (match) => match[1]!));
        if (fields.size >= 2 && (fields.has("宿主") || namedSystems.length || interfaceNamePattern.test(source))) blocks.push(block);
        statusLines = [];
    };
    for (const line of source.split("\n")) {
        if (!line.trim()) continue;
        if (Array.from(line.matchAll(statusFieldPattern)).length) statusLines.push(line);
        else collectStatusLines();
    }
    collectStatusLines();
    const grouped = new Map<string, string[]>();
    for (const block of blocks) {
        if (/(?:没有|并无|未曾|从未|不曾|不显示|不出现)[^。！？\n]{0,8}(?:面板|界面|状态栏)/u.test(block)) continue;
        const fields = new Set(Array.from(block.matchAll(statusFieldPattern), (match) => match[1]!));
        if (!interfaceNamePattern.test(block) && fields.size < 2) continue;
        if (!interfaceNamePattern.test(block) && !/[【〔\[［]/u.test(block) && !fields.has("宿主") && !namedSystems.length && !interfaceNamePattern.test(source)) continue;
        const blockSystem = Array.from(block.matchAll(namedSystemPattern), (match) => match[1]!)[0];
        const name = `${blockSystem || (namedSystems.length === 1 ? namedSystems[0] : "系统")}面板`;
        const evidence = grouped.get(name) || [];
        if (!evidence.includes(block.trim())) evidence.push(block.trim());
        grouped.set(name, evidence);
    }
    return Array.from(grouped, ([name, evidence]) => ({
        name,
        description: `系统界面道具：用于呈现小说中的状态、属性与提示信息；同一系统复用同一面板，具体文字和数值逐镜沿用原文。原文依据：\n${evidence.join("\n")}`,
        prompt: systemInterfaceTemplatePrompt(name, evidence.join("\n")),
    }));
}

export function missingChapterSystemInterfaceProps<T extends { name: string }>(sourceText: string, existing: T[]): SystemInterfaceProp[] {
    const detected = extractChapterSystemInterfaceProps(sourceText);
    const existingIdentities = existing.flatMap((asset) => {
        const identity = systemInterfaceIdentity(asset.name);
        return identity ? [identity] : [];
    });
    return detected.filter((asset) => {
        const identity = systemInterfaceIdentity(asset.name);
        if (existingIdentities.includes(identity!)) return false;
        return !(detected.length === 1 && (identity === "系统" && existingIdentities.length === 1 || existingIdentities.includes("系统")));
    });
}
