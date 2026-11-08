import type { SunoOperation } from "@/lib/suno-contract";
import type { SunoStudioClip, SunoStudioJob } from "@/stores/use-suno-studio-store";
import { fieldValue, fieldVisible } from "@/lib/suno-form";
export { fieldValue, fieldVisible, updateStudioValues } from "@/lib/suno-form";

export const STUDIO_GROUPS = [
    { value: "create", label: "创作" },
    { value: "edit", label: "编辑 / 分轨" },
    { value: "voice", label: "歌词 / 歌手" },
    { value: "tools", label: "工具" },
    { value: "library", label: "曲库" },
] as const;

export type MusicWritingOutput = "inspiration" | "lyrics" | "tags";

export type MusicWritingSkill = {
    id: string;
    name: string;
    description: string;
    instruction: string;
};

export const MUSIC_WRITING_SKILLS: MusicWritingSkill[] = [
    { id: "songwriter", name: "原创歌词创作", description: "围绕主题写有结构、画面和记忆点的原创歌词。", instruction: "创作原创歌词，先明确叙述视角、情绪弧线和核心意象，再组织主歌、预副歌、副歌与桥段。押韵自然，不为押韵牺牲语义；避免重复空泛句。" },
    { id: "soundtrack", name: "影视配乐灵感", description: "把剧情、人物关系和情绪转成可执行的音乐描述。", instruction: "将剧情转成可用于歌曲生成的音乐灵感描述，写清情绪推进、配器、节奏、动态变化、人声气质和结尾，不虚构剧情事实。" },
    { id: "style-tags", name: "曲风与编曲设计", description: "提炼流派、乐器、节奏、人声和制作质感。", instruction: "输出精炼、可执行的曲风标签和编曲说明，覆盖流派、速度感、核心乐器、人声表现、制作质感与动态；避免互相冲突的标签。" },
    { id: "lyric-polish", name: "歌词润色与结构", description: "保留原意，改善唱感、节奏和段落层次。", instruction: "在保留用户核心意思和叙事事实的前提下润色歌词。改善口语唱感、句长和段落递进；不要擅自删改关键情节或把对白切成不自然的短句。" },
    { id: "instrumental", name: "纯音乐主题设计", description: "设计无歌词的旋律主题、配器和情绪发展。", instruction: "为纯音乐设计主题动机、配器组合、节奏密度、情绪发展和收尾方式。不要生成歌词或人声哼唱词。" },
];

export function buildMusicWritingPrompt(skill: MusicWritingSkill, output: MusicWritingOutput, context: string) {
    const format = output === "lyrics"
        ? "只输出可演唱的原创歌词，使用清晰段落标记（如 [Verse]、[Pre-Chorus]、[Chorus]、[Bridge]）；不要添加解释或生成参数。"
        : output === "tags"
            ? "先输出一行逗号分隔的简洁风格标签，再用一小段说明编曲和演唱方向；不要输出歌词。"
            : "只输出一段可直接用于音乐生成的灵感描述，包含情绪、风格、节奏、配器、人声与动态变化；不要输出歌词或前言。";
    return [
        "你是专业的原创歌曲创作助手。只根据用户提供的信息创作，不照搬已发行歌曲的歌词或旋律，不虚构人物与剧情事实。",
        `当前创作 Skill：${skill.name}`,
        skill.instruction,
        `输出类型要求：${format}`,
        "保持结果具体、易唱或易执行；若信息不足，采用克制且自洽的创作选择，不反问用户。",
        `用户创作素材：\n${context.trim()}`,
    ].join("\n\n");
}

export function studioLibraryTracks(jobs: SunoStudioJob[], query = "") {
    const needle = query.trim().toLocaleLowerCase();
    return jobs
        .filter((job) => job.status === "succeeded")
        .flatMap((job) => job.clips
            .filter((clip) => Boolean(clip.audioUrl || (clip.storageKey && !clip.videoUrl)))
            .map((clip) => ({ clip, job })))
        .filter(({ clip, job }) => !needle || [clip.title, clip.tags, clip.lyrics, clip.id, job.label, job.taskId].join(" ").toLocaleLowerCase().includes(needle))
        .sort((left, right) => Date.parse(right.job.updatedAt) - Date.parse(left.job.updatedAt));
}

export function validateStudioValues(operation: SunoOperation, values: Record<string, unknown>) {
    const errors: Record<string, string> = {};
    for (const field of operation.fields) {
        if (!fieldVisible(field, values)) continue;
        const value = fieldValue(values, field.key);
        const empty = value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
        if (field.required && empty) errors[field.key] = `请填写${field.label}`;
        if (empty) continue;
        if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) errors[field.key] = "请输入有效数字";
        if (typeof value === "number" && field.min !== undefined && value < field.min) errors[field.key] = `不能小于 ${field.min}`;
        if (typeof value === "number" && field.max !== undefined && value > field.max) errors[field.key] = `不能大于 ${field.max}`;
        if (field.type === "json" && typeof value === "string") {
            try { JSON.parse(value); } catch { errors[field.key] = "JSON 格式无效"; }
        }
    }
    if (operation.id === "post-suno-submit-music" && !values.task) {
        const promptKey = values.mode === "custom" ? "prompt" : "gpt_description_prompt";
        if (!(values.mode === "custom" && values.make_instrumental === true) && !String(values[promptKey] || "").trim()) errors[promptKey] = promptKey === "prompt" ? "请填写歌词／创作提示" : "请填写音乐灵感描述";
    }
    for (const field of operation.fields.filter((item) => /start_s$/.test(item.key) && fieldVisible(item, values))) {
        const endKey = field.key.replace(/start_s$/, "end_s");
        const start = fieldValue(values, field.key);
        const end = fieldValue(values, endKey);
        if (typeof start === "number" && typeof end === "number" && end <= start) errors[endKey] = "结束时间必须大于开始时间";
    }
    return errors;
}

export function formatStudioTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function clampRange(start: number, end: number, duration: number): [number, number] {
    const limit = Math.max(0, Number.isFinite(duration) ? duration : 0);
    const from = Math.min(limit, Math.max(0, Number.isFinite(start) ? start : 0));
    return [from, Math.min(limit, Math.max(from, Number.isFinite(end) ? end : limit))];
}

export function clipSourceValues(operation: SunoOperation, values: Record<string, unknown>, clip: SunoStudioClip, job: SunoStudioJob) {
    const next = { ...values };
    for (const field of operation.fields) {
        if (!fieldVisible(field, next)) continue;
        const leaf = field.key.split(".").at(-1) || field.key;
        if (["clip_id", "clipId", "root_clip_id", "continue_clip_id", "artist_clip_id", "underpainting_clip_id", "stemClipId"].includes(leaf)) next[field.key] = clip.id;
        if (operation.id === "get-suno-act-midi" && job.operationId.includes("stems")) {
            if (leaf === "stemClipId") next[field.key] = clip.id;
            if (leaf === "clipId") next[field.key] = job.values.clip_id || "";
        }
        if (["url", "audio_url", "source_url"].includes(leaf) && clip.audioUrl) next[field.key] = clip.audioUrl;
        if (["task_id", "task_batch_id", "taskBatchId"].includes(leaf) && job.taskId) next[field.key] = job.taskId;
        if (leaf === "id") next[field.key] = operation.path.includes("/fetch/") ? job.taskId || "" : clip.id;
        if (leaf === "ids") next[field.key] = job.operationId === "post-suno-fetch" ? job.taskIds || [job.taskId || clip.id] : [clip.id];
        if (leaf === "mashup_clip_ids") {
            const previous = fieldValue(next, field.key);
            next[field.key] = [...new Set([...(Array.isArray(previous) ? previous : []), clip.id])].slice(-2);
        }
    }
    return next;
}

export function studioSourceSelection(job: SunoStudioJob, clip: SunoStudioClip) {
    return { jobId: job.id, clipId: clip.id };
}

export function rangeValues(operation: SunoOperation, values: Record<string, unknown>, range: [number, number]) {
    const next = { ...values };
    const startKeys = ["continue_at", "vocal_start_s", "infill_start_s", "infill_context_start_s", "underpainting_start_s"];
    const endKeys = ["vocal_end_s", "infill_end_s", "infill_context_end_s", "underpainting_end_s"];
    for (const field of operation.fields) {
        if (!fieldVisible(field, next)) continue;
        const leaf = field.key.split(".").at(-1) || field.key;
        if (startKeys.includes(leaf)) next[field.key] = range[0];
        if (endKeys.includes(leaf)) next[field.key] = range[1];
    }
    return next;
}

export type StudioTextResult = { path: string; text: string; kind: "lyrics" | "tags" | "text" };

export function studioResultLinks(result: unknown) {
    const links = new Map<string, { label: string; url: string }>();
    const visit = (value: unknown, path: string, depth: number) => {
        if (depth > 8) return;
        if (typeof value === "string") {
            try {
                const parsed = new URL(value);
                if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) links.set(value, { label: path || "资源链接", url: value });
            } catch { return; }
        } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
        else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key, depth + 1));
    };
    visit(result, "", 0);
    return [...links.values()];
}

export function studioPersonaId(result: unknown, depth = 0): string | undefined {
    if (!result || typeof result !== "object" || depth > 8) return undefined;
    const payload = result as Record<string, unknown>;
    for (const key of ["persona_id", "personaId"]) if (typeof payload[key] === "string" && payload[key].trim()) return payload[key].trim();
    for (const key of ["data", "result", "output"]) { const found = studioPersonaId(payload[key], depth + 1); if (found) return found; }
    return undefined;
}

export function studioTextResults(result: unknown): StudioTextResult[] {
    const output: StudioTextResult[] = [];
    const visit = (value: unknown, path: string, depth: number) => {
        if (depth > 6 || output.length >= 24) return;
        const leaf = path.split(".").at(-1) || "text";
        if (typeof value === "string" && value.trim() && (depth === 0 || /^(text|lyrics|prompt|tags|style|original_tags|upsampled_tags|result)$/i.test(leaf))) {
            output.push({ path: path || "text", text: value, kind: /tags|style/i.test(leaf) ? "tags" : /lyrics|prompt/i.test(leaf) ? "lyrics" : "text" });
        } else if (Array.isArray(value)) {
            value.slice(0, 24).forEach((entry, index) => visit(entry, `${path}.${index}`, depth + 1));
        } else if (value && typeof value === "object") {
            Object.entries(value).forEach(([key, entry]) => visit(entry, path ? `${path}.${key}` : key, depth + 1));
        }
    };
    visit(result, "", 0);
    return output;
}

export function studioResultDetails(result: unknown) {
    return JSON.stringify(result, (key, value) => /^(api[_-]?key|authorization|cookie|access_token|secret_key)$/i.test(key) ? "[已隐藏]" : value, 2);
}

export function playableUrl(value?: string) {
    if (!value) return undefined;
    try {
        const url = new URL(value, "https://local.invalid");
        return ["https:", "http:", "blob:"].includes(url.protocol) ? value : undefined;
    } catch { return undefined; }
}
