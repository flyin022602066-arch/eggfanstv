import type { StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { CHARACTER_VISUAL_DESIGN_RULE } from "@/lib/asset-visual-design";
import { characterAssetType, GROUP_CHARACTER_DESIGN_RULE } from "@/lib/character-asset-type";
import { characterDesignTemplate, characterReferenceLayout } from "@/lib/character-reference-templates";
import type { ProjectAssetImagePreset } from "@/lib/project-asset-image-preferences";

export type CharacterProjectStyle = { id: string; title: string; prompt: string; profile?: StyleProfileSnapshot };

export function hasCombinedCharacterLooks(definition: Record<string, unknown>) {
    const clothing = String(definition.clothing || "");
    const numbered = clothing.match(/(?:造型|服装|形态)\s*[一二三四五六七八九十0-9]+\s*(?:[（(][^）)]+[）)]\s*)?[：:]/gu) || [];
    return (Array.isArray(definition.looks) && definition.looks.length > 1) || numbered.length > 1 || /[；;]\s*(?:后|随后|之后|接着|再)?\s*(?:换为|换成|换上|换穿|改穿|更换为)/u.test(clothing);
}

export function characterTurnaroundVariables(name: string, definition: Record<string, unknown>, promptOverride = "", projectStyle?: CharacterProjectStyle, template?: Pick<ProjectAssetImagePreset, "characterLayoutId" | "characterDesignTemplateId">) {
    const group = characterAssetType(name, definition) === "group";
    if (!group && hasCombinedCharacterLooks(definition)) throw new Error("当前设定包含多套造型，请先到造型与版本中拆分，再按单套生成图片");
    const supplements = group
        ? [groupDesignSupplement(definition.consistencyPrompt), promptOverride.trim() || groupDesignSupplement(definition.multiViewPrompt)]
        : [definition.consistencyPrompt, promptOverride.trim() || definition.multiViewPrompt];
    const visual = [definition.appearance, definition.physique, definition.ageStage, definition.hairstyle, definition.state, definition.clothing, definition.personality, definition.props, ...supplements]
        .map((value) => String(value || "").trim()).filter(Boolean).join("；");
    const role = String(definition.role || "").trim();
    if (!visual && !role) throw new Error(group ? "请先填写群体身份、成员构成或服饰，再生成群体设定图" : "请先填写剧情定位、角色外貌、体型或服装，再生成角色设定图");
    return { 角色名称: name, 角色类型: group ? "group" : "individual", 角色参考图格式: characterReferenceLayout(template?.characterLayoutId).id, 角色形象模板: characterDesignTemplate(template?.characterDesignTemplateId).id, 项目画风: characterStyleConstraint(projectStyle) || "项目尚未指定画风，保持角色媒介中性。", 角色设定: [role ? `【剧情定位（仅理解身份，不作为服装或同框指令）】${role}` : "", visual, group ? GROUP_CHARACTER_DESIGN_RULE : CHARACTER_VISUAL_DESIGN_RULE].filter(Boolean).join("\n\n"), 同项目角色设计参考: "" };
}

function groupDesignSupplement(value: unknown) {
    const prompt = String(value || "").trim();
    return prompt.split(/(?<=[，,；;。.!！\n])/u).filter((part) => {
        const singlePersonRule = part.search(/三视图|无头|独立头像|独立头部|单人|同一张脸|同一人|锁脸|同脸/u);
        return singlePersonRule < 0 || /不使用|不用|不采用|不要|不得|禁止|严禁|避免|不做|不能|无需|不应|杜绝/u.test(part.slice(0, singlePersonRule));
    }).join("").trim();
}

function characterStyleConstraint(projectStyle?: CharacterProjectStyle) {
    if (!projectStyle) return "";
    // 三视图仅继承角色规范，避免建筑、运镜规则进入静态设定表。
    const sections = new Set(["风格组合", "项目定位", "题材世界观", "视觉媒介", "角色设计系统", "地域选角与文化语境", "项目色彩与光影", "服饰、材质与场景", "资产一致性", "全局禁用"]);
    const rules = projectStyle.prompt.split("\n").filter((line) => { const title = line.match(/^【([^】]+)】/)?.[1]; return title ? sections.has(title) : false; });
    return [`项目画风：${projectStyle.title}。角色造型、配色、服装材质与最终渲染媒介必须遵循以下规范：`, ...rules].join("\n");
}
