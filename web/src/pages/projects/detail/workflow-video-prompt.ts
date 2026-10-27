import { skillRuntime, type SkillRuntimeMetadata } from "@/services/skill-runtime";
import type { Skill } from "@/services/api/skills";
import { resolveShotAssetMentionPrompt, type ShotAssetReferenceContext } from "./workflow-shot-references";

type VideoPromptValues = {
    videoPrompt?: string;
    plotDescription?: string;
    action?: string;
    dialogue?: string;
    continuityNotes?: string;
    negativePrompt?: string;
    shotSize?: string;
    cameraAngle?: string;
    cameraMovement?: string;
};

type PromptSection = { label: string; chars: number };
type PreparedPrompt = { prompt: string; chars: number; sections: PromptSection[]; metadata: SkillRuntimeMetadata };

export function resolveWorkflowVideoSubmissionPrompt(autoPrompt: string, editedPrompt?: string) {
    return editedPrompt === undefined ? autoPrompt : editedPrompt;
}

export function buildWorkflowVideoPrompt(values: VideoPromptValues, context: ShotAssetReferenceContext, interfaceType?: string) {
    let script = (values.videoPrompt || values.plotDescription || "").trim();
    const append = (label: string, value?: string) => {
        const text = value?.trim();
        if (text && !script.includes(text)) script = [script, `${label}：${text}`].filter(Boolean).join("\n");
    };
    const hasShotSequence = /(?:^|\n)\s*镜头\s*\d+\s*[:：]/u.test(script);
    const action = values.action?.split(/\n(?=(?:叙事意图|表演调度|镜头序列|时间节拍|情绪|光线与氛围|声音)\s*[:：])/u).filter((section) => {
        if (hasShotSequence && /^(?:镜头序列|时间节拍)\s*[:：]/u.test(section)) return false;
        const content = section.replace(/^(?:叙事意图|表演调度|镜头序列|时间节拍|情绪|光线与氛围|声音)\s*[:：]\s*/u, "").trim();
        return content && !script.includes(content);
    }).join("\n");
    append("表演与动作", action);
    append("接戏", values.continuityNotes);
    append("景别", values.shotSize);
    append("机位", values.cameraAngle);
    append("运镜", values.cameraMovement);
    append("排除内容", values.negativePrompt);
    const resolvedScript = resolveShotAssetMentionPrompt(script, { ...context, assetReferences: [] }, { interfaceType });
    const prompt = resolveShotAssetMentionPrompt(script, context, { interfaceType, dialogue: missingScriptDialogue(script, values.dialogue) });
    const chars = Array.from(prompt).length;
    const scriptChars = Array.from(resolvedScript).length;
    return { prompt, chars, sections: [{ label: "镜头与表演", chars: scriptChars }, { label: "资产与声音", chars: chars - scriptChars }] };
}

function missingScriptDialogue(script: string, dialogue?: string) {
    const normalize = (value: string) => value.replace(/<([^<>\n]+)>/gu, "$1").replace(/[“”"‘’「」『』\s]/gu, "").replace(/：/gu, ":");
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const normalizedScript = normalize(script);
    const usedMatches = new Set<string>();
    return dialogue?.split(/\r?\n/u).filter((line) => {
        const value = normalize(line);
        if (!value) return false;
        const separator = value.indexOf(":");
        const pattern = separator > 0
            ? `(?<![\\p{L}\\p{N}_])${escape(value.slice(0, separator))}(?:[（(][^）)\n]*[）)]|[^:。！？；\n]{0,12})?:${escape(value.slice(separator + 1))}`
            : escape(value);
        const matched = [...normalizedScript.matchAll(new RegExp(pattern, "gu"))].find((match) => !usedMatches.has(`${match.index}:${match[0]}`));
        if (!matched) return true;
        usedMatches.add(`${matched.index}:${matched[0]}`);
        return false;
    }).join("\n");
}

export async function prepareWorkflowVideoPrompt(input: { values: VideoPromptValues; context: ShotAssetReferenceContext; interfaceType?: string; skills: Skill[]; selectedSkillIds: string[] }, runtime: { prepare: (input: { profile: "shortDrama"; purpose: "video"; prompt: string; skills: Skill[]; selectedSkillIds: string[] }) => Promise<{ prompt: string; metadata: SkillRuntimeMetadata }> } = skillRuntime): Promise<PreparedPrompt> {
    const base = buildWorkflowVideoPrompt(input.values, input.context, input.interfaceType);
    const execution = await runtime.prepare({ profile: "shortDrama", purpose: "video", prompt: base.prompt, skills: input.skills, selectedSkillIds: input.selectedSkillIds });
    const chars = Array.from(execution.prompt).length;
    return { prompt: execution.prompt, chars, sections: [...base.sections, { label: "技能规则", chars: chars - base.chars }], metadata: execution.metadata };
}
