import type { CharacterBreakdown } from "./canvas/canvas-character-reference";

export type SystemPresentationSettings = {
    mode: "panel" | "character";
    characterName: string;
    characterAppearance: string;
    characterVoice: string;
};

const defaultSettings: SystemPresentationSettings = {
    mode: "panel",
    characterName: "系统精灵",
    characterAppearance: "小巧的悬浮精灵",
    characterVoice: "清晰自然的中文普通话",
};

export function normalizeSystemPresentationSettings(value: unknown): SystemPresentationSettings {
    const settings = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const text = (key: "characterName" | "characterAppearance" | "characterVoice") => typeof settings[key] === "string" && settings[key].trim() ? settings[key].trim() : defaultSettings[key];
    return {
        mode: settings.mode === "character" ? "character" : "panel",
        characterName: text("characterName"),
        characterAppearance: text("characterAppearance"),
        characterVoice: text("characterVoice"),
    };
}

export function normalizeProjectSystemPresentations(value: unknown): Record<string, SystemPresentationSettings> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .filter(([projectId, settings]) => projectId.trim() && settings && typeof settings === "object" && !Array.isArray(settings))
        .map(([projectId, settings]) => [projectId, normalizeSystemPresentationSettings(settings)]));
}

export function systemPresentationRule(settings: SystemPresentationSettings): string {
    const presentation = normalizeSystemPresentationSettings(settings);
    if (presentation.mode === "panel") return [
        "【系统面板呈现】原文系统信息按面板、界面或声音播报呈现，不把系统拟人化。",
        "系统面板参考图仅约束外框、配色、材质和布局，不照抄参考图的文字或数值；姓名、形态、等级、进度、资源和任务状态逐镜按本镜原文及 systemElements 更新，保留原文顺序。",
        "未给出的数值留空，不从其他章节或参考图补造；资产参考图仅保留固定标题、字段标签和空白数值区域，不把任何章节状态固定到模板中。",
        "实际可见面板绑定对应道具，纯声音播报不强制显示面板；无文字要求不能删除原文系统信息。",
    ].join("\n");
    return [
        "【系统角色呈现】仅将原文实际出现的系统提示、状态和播报改编为配置角色的表达，没有系统内容时不新增角色或台词。",
        `统一名称：${presentation.characterName}；固定外形：${presentation.characterAppearance}；固定声线：${presentation.characterVoice}。`,
        "可采用动物或精灵形态，遵循配置的物种、完整身体结构与比例，不强行改成人类；同一名称、外形、体型与声线跨镜头、跨章节保持一致。",
        "原有台词与信息逐字沿用原文，标签、数值、单位、标点和出现顺序保留在 systemElements；不得编造台词、任务、奖励、情绪或剧情。只调整表达载体，不改变事实。",
        "不强制增加系统面板或界面道具，原文系统信息由该角色按配置声线传达；不得将普通 IT 系统或表单清单改编为角色。",
        "本章等级、进度、数值、宿主形态与任务状态仅作为当镜动态信息，不写入角色稳定外形，不固化到角色参考图，也不从其他章节补造。",
    ].join("\n");
}

export function systemCharacterDefinition(settings: SystemPresentationSettings): CharacterBreakdown {
    const presentation = normalizeSystemPresentationSettings(settings);
    return {
        name: presentation.characterName,
        aliases: presentation.characterName === "系统" ? [] : ["系统"],
        role: "【拟人化系统角色】承载原文系统提示、状态与播报的固定角色，只传达已有系统信息。",
        appearance: presentation.characterAppearance,
        physique: `${presentation.characterAppearance}；身体结构、体型和比例遵循配置的物种与形态，跨镜头保持一致。`,
        clothing: "服饰与附属结构遵循配置外形，未指定时不额外添加服饰。",
        personality: "表达清晰克制，只传达原文系统信息，不额外编造性格表现或剧情。",
        props: "不附加固定面板或额外道具。",
        consistencyPrompt: `角色始终名为${presentation.characterName}，外形始终为${presentation.characterAppearance}，声线始终为${presentation.characterVoice}；物种、身体比例、颜色及辨识特征跨章节保持一致。等级、进度、数值、宿主形态与任务状态属于逐镜原文，不画入角色参考图，不随章节改变稳定形态。`,
        multiViewPrompt: `按项目画风绘制${presentation.characterName}的全身正面、侧面、背面三视图，完整保留头部和整个身体；固定外形为${presentation.characterAppearance}。适用于动物或精灵，按实际物种展示自然姿态及身体结构，所有视图保持比例与辨识特征一致，简洁背景，不附带章节状态、等级、数值或面板。`,
        voiceLanguage: "遵循配置声线的语言设定",
        voiceAge: "固定同一声线，不限定人类年龄",
        voiceTimbre: presentation.characterVoice,
    };
}
