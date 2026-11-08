import type { StyleProfileSnapshot } from "@/lib/canvas/style-profile";

export type CharacterProjectStyle = { id: string; title: string; prompt: string; profile?: StyleProfileSnapshot };

export function hasCombinedCharacterLooks(definition: Record<string, unknown>) {
    const clothing = String(definition.clothing || "");
    const numbered = clothing.match(/(?:造型|服装|形态)\s*[一二三四五六七八九十0-9]+\s*(?:[（(][^）)]+[）)]\s*)?[：:]/gu) || [];
    return (Array.isArray(definition.looks) && definition.looks.length > 1) || numbered.length > 1 || /[；;]\s*(?:后|随后|之后|接着|再)?\s*(?:换为|换成|换上|换穿|改穿|更换为)/u.test(clothing);
}

export function characterTurnaroundVariables(name: string, definition: Record<string, unknown>, promptOverride = "", projectStyle?: CharacterProjectStyle) {
    const clothing = String(definition.clothing || "");
    if (hasCombinedCharacterLooks(definition)) throw new Error("当前设定包含多套造型，请先到造型与版本中拆分，再按单套生成图片");
    const role = clothing.trim() ? (String(definition.role || "").includes("【拟人化系统角色】") ? "【拟人化系统角色】" : "") : definition.role;
    const visual = [role, definition.appearance, definition.physique, definition.ageStage, definition.hairstyle, definition.state, definition.clothing, definition.personality, definition.props, definition.consistencyPrompt, promptOverride.trim() || definition.multiViewPrompt]
        .map((value) => String(value || "").trim()).filter(Boolean).join("；");
    if (!visual) throw new Error("请先填写剧情定位、角色外貌、体型或服装，再初始化三视图");
    return { 角色名称: name, 项目画风: characterStyleConstraint(projectStyle) || "项目尚未指定画风，保持角色媒介中性。", 角色设定: visual };
}

function characterStyleConstraint(projectStyle?: CharacterProjectStyle) {
    if (!projectStyle) return "";
    // 三视图仅继承角色规范，避免建筑、运镜规则进入静态设定表。
    const sections = new Set(["风格组合", "项目定位", "题材世界观", "视觉媒介", "角色设计系统", "项目色彩与光影", "服饰、材质与场景", "资产一致性", "全局禁用"]);
    const rules = projectStyle.prompt.split("\n").filter((line) => { const title = line.match(/^【([^】]+)】/)?.[1]; return title ? sections.has(title) : false; });
    return [`项目画风：${projectStyle.title}。角色造型、配色、服装材质与最终渲染媒介必须遵循以下规范：`, ...rules].join("\n");
}
