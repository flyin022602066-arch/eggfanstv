export interface SunoField {
    key: string;
    label: string;
    type: "text" | "textarea" | "number" | "boolean" | "select" | "json";
    required?: boolean;
    options?: { label: string; value: string }[];
    min?: number;
    max?: number;
    step?: number;
    defaultValue?: unknown;
    visibleWhen?: { key: string; values: string[] };
}

export interface SunoOperation {
    id: string;
    label: string;
    group: "create" | "edit" | "voice" | "tools" | "library";
    method: "GET" | "POST";
    path: string;
    fields: SunoField[];
    poll: "task" | "mp4" | "none";
    result: "music" | "text" | "data";
}

export const SUNO_MODELS: { label: string; value: string }[] = [
    { label: "Suno v3.0", value: "chirp-v3-0" },
    { label: "Suno v3.5", value: "chirp-v3-5" },
    { label: "Suno v4.0", value: "chirp-v4" },
    { label: "Suno v4.5", value: "chirp-v4-5" },
    { label: "Suno v5.0", value: "chirp-v5" },
    { label: "Suno v5.5", value: "chirp-v5-5" },
    { label: "Suno v6.0", value: "chirp-v6" },
    { label: "Suno v6 Wild", value: "chirp-v6-wild" },
    { label: "Suno v6 Mini", value: "chirp-v6-mini" },
    { label: "Suno v3.5 歌手风格", value: "chirp-v3-5-tau" },
    { label: "Suno v4.0 歌手风格", value: "chirp-v4-tau" },
];

const extendTasks = ["extend", "upload_extend", "cover_extend"];
const infillTasks = ["infill", "fixed_infill", "infill_intro", "infill_outro", "cover_infill", "artist_infill"];
const artistTasks = ["artist_consistency", "artist_infill"];
const taskOptions = [
    { label: "普通生成", value: "" },
    { label: "续写／延伸", value: "extend" },
    { label: "上传后续写", value: "upload_extend" },
    { label: "局部编辑／补段", value: "infill" },
    { label: "固定区间补段", value: "fixed_infill" },
    { label: "片头补段", value: "infill_intro" },
    { label: "片尾补段", value: "infill_outro" },
    { label: "翻唱局部编辑", value: "cover_infill" },
    { label: "翻唱延伸", value: "cover_extend" },
    { label: "歌手风格局部编辑", value: "artist_infill" },
    { label: "歌手风格一致", value: "artist_consistency" },
    { label: "翻唱／改编", value: "cover" },
    { label: "图生曲", value: "image_to_song" },
    { label: "视频生曲", value: "video_to_song" },
    { label: "拼接", value: "concat" },
    { label: "音效生成", value: "sound" },
    { label: "添加伴奏", value: "underpainting" },
    { label: "重制／变奏", value: "remaster" },
    { label: "哼唱成曲", value: "vox" },
    { label: "双曲混搭", value: "mashup_condition" },
];

const musicFields: SunoField[] = [
    { key: "mode", label: "创作模式", type: "select", required: true, defaultValue: "description", options: [{ label: "描述模式", value: "description" }, { label: "自定义模式", value: "custom" }] },
    { key: "task", label: "任务类型", type: "select", defaultValue: "", options: taskOptions },
    { key: "mv", label: "模型版本", type: "select", required: true, defaultValue: "chirp-v5", options: SUNO_MODELS },
    { key: "make_instrumental", label: "纯音乐（无人声）", type: "boolean", defaultValue: false },
    { key: "gpt_description_prompt", label: "音乐灵感描述", type: "textarea", visibleWhen: { key: "mode", values: ["description"] } },
    { key: "prompt", label: "歌词／创作提示", type: "textarea", visibleWhen: { key: "mode", values: ["custom"] } },
    { key: "title", label: "歌曲标题", type: "text" },
    { key: "tags", label: "音乐风格标签", type: "textarea" },
    { key: "task_id", label: "关联原任务 ID（task_id，非歌曲片段 ID）", type: "text" },
    { key: "continue_clip_id", label: "续写／补段源歌曲片段 ID（clip_id，非任务 ID）", type: "text", visibleWhen: { key: "task", values: [...extendTasks, ...infillTasks] } },
    { key: "continue_at", label: "续写起始时间（秒）", type: "number", min: 0, step: 0.1, visibleWhen: { key: "task", values: extendTasks } },
    { key: "persona_id", label: "歌手风格 ID（persona_id）", type: "text", visibleWhen: { key: "task", values: artistTasks } },
    { key: "artist_clip_id", label: "歌手／哼唱源歌曲片段 ID（clip_id）", type: "text", visibleWhen: { key: "task", values: [...artistTasks, "vox"] } },
    { key: "metadata_params.clip_id", label: "翻唱／重制源歌曲片段 ID（clip_id）", type: "text", required: true, visibleWhen: { key: "task", values: ["cover", "remaster"] } },
    { key: "metadata_params.variation_category", label: "重制变化类别", type: "text", visibleWhen: { key: "task", values: ["remaster"] } },
    { key: "metadata_params.persona_id", label: "扩展歌手风格 ID（与顶层二选一）", type: "text", visibleWhen: { key: "task", values: artistTasks } },
    { key: "metadata_params.artist_clip_id", label: "扩展歌手源片段 ID（与顶层二选一）", type: "text", visibleWhen: { key: "task", values: [...artistTasks, "vox"] } },
    { key: "metadata_params.continue_clip_id", label: "扩展补段源片段 ID（与顶层二选一）", type: "text", visibleWhen: { key: "task", values: infillTasks } },
    { key: "metadata_params.continued_aligned_prompt", label: "补段对齐提示", type: "textarea", visibleWhen: { key: "task", values: infillTasks } },
    { key: "metadata_params.infill_start_s", label: "替换片段开始时间（秒）", type: "number", required: true, min: 0, step: 0.1, visibleWhen: { key: "task", values: infillTasks } },
    { key: "metadata_params.infill_end_s", label: "替换片段结束时间（秒）", type: "number", required: true, min: 0, step: 0.1, visibleWhen: { key: "task", values: infillTasks } },
    { key: "metadata_params.infill_context_start_s", label: "补段上下文开始时间（秒）", type: "number", min: 0, step: 0.1, visibleWhen: { key: "task", values: infillTasks } },
    { key: "metadata_params.infill_context_end_s", label: "补段上下文结束时间（秒）", type: "number", min: 0, step: 0.1, visibleWhen: { key: "task", values: infillTasks } },
    { key: "metadata_params.metadata.infill_lyrics", label: "局部替换后的新歌词", type: "textarea", visibleWhen: { key: "task", values: infillTasks } },
    { key: "metadata_params.mashup_clip_ids", label: "混搭参考歌曲片段 ID 列表（JSON 数组）", type: "json", required: true, visibleWhen: { key: "task", values: ["mashup_condition"] } },
    { key: "metadata_params.sound", label: "音效描述", type: "textarea", required: true, visibleWhen: { key: "task", values: ["sound"] } },
    { key: "metadata_params.type", label: "音效类型（如 loop）", type: "text", required: true, visibleWhen: { key: "task", values: ["sound"] } },
    { key: "metadata_params.underpainting_clip_id", label: "伴奏源歌曲片段 ID（clip_id）", type: "text", required: true, visibleWhen: { key: "task", values: ["underpainting"] } },
    { key: "metadata_params.underpainting_start_s", label: "添加伴奏开始时间（秒）", type: "number", required: true, min: 0, step: 0.1, visibleWhen: { key: "task", values: ["underpainting"] } },
    { key: "metadata_params.underpainting_end_s", label: "添加伴奏结束时间（秒）", type: "number", required: true, min: 0, step: 0.1, visibleWhen: { key: "task", values: ["underpainting"] } },
    { key: "metadata_params", label: "高级扩展参数（JSON 对象）", type: "json", visibleWhen: { key: "task", values: taskOptions.map((option) => option.value).filter(Boolean) } },
];

function clipField(): SunoField {
    return { key: "clip_id", label: "歌曲片段 ID（clip_id，非任务 ID）", type: "text", required: true };
}

function urlField(): SunoField {
    return { key: "url", label: "音频／资源地址", type: "text", required: true };
}

export const SUNO_OPERATIONS: SunoOperation[] = [
    { id: "post-suno-submit-music", label: "创建音乐", group: "create", method: "POST", path: "/suno/submit/music", fields: musicFields, poll: "task", result: "music" },
    { id: "get-suno-fetch-id", label: "查询单个任务", group: "library", method: "GET", path: "/suno/fetch/{id}", fields: [{ key: "id", label: "任务 ID（task_id）", type: "text", required: true }], poll: "none", result: "music" },
    { id: "post-suno-uploads-audio", label: "上传版权歌曲", group: "create", method: "POST", path: "/suno/uploads/audio", fields: [
        urlField(),
        { key: "name", label: "歌曲名称", type: "text", required: true },
        { key: "upload_type", label: "上传类型", type: "select", required: true, defaultValue: "MUSIC_COPYRIGHT", options: [{ label: "普通上传", value: "NORMAL" }, { label: "版权上传", value: "MUSIC_COPYRIGHT" }] },
        { key: "speed_multiplier", label: "上传速度倍率", type: "number", required: true, min: 0.25, max: 2, step: 0.05, defaultValue: 1 },
        { key: "speed_multiplier_fix", label: "上传后修复回原速", type: "boolean", required: true, defaultValue: true },
    ], poll: "none", result: "music" },
    { id: "post-suno-submit-lyrics", label: "生成歌词", group: "create", method: "POST", path: "/suno/submit/lyrics", fields: [{ key: "prompt", label: "歌词主题／关键词", type: "textarea", required: true }], poll: "task", result: "text" },
    { id: "post-suno-submit-persona", label: "创建歌手风格", group: "voice", method: "POST", path: "/suno/submit/persona", fields: [
        { key: "root_clip_id", label: "源歌曲片段 ID（clip_id，非任务 ID）", type: "text", required: true },
        { key: "vocal_start_s", label: "人声片段开始时间（秒）", type: "number", required: true, min: 0, step: 1 },
        { key: "vocal_end_s", label: "人声片段结束时间（秒）", type: "number", required: true, min: 0, step: 1 },
        { key: "user_input_styles", label: "歌手风格描述", type: "textarea", required: true },
    ], poll: "task", result: "data" },
    { id: "get-suno-account-integral", label: "账户积分余额", group: "library", method: "GET", path: "/suno/account/integral", fields: [], poll: "none", result: "data" },
    { id: "get-suno-act-midi", label: "生成 MIDI", group: "tools", method: "GET", path: "/suno/act/midi", fields: [
        { key: "clipId", label: "歌曲片段 ID（clipId）", type: "text", required: true },
        { key: "stemClipId", label: "分轨片段 ID（stemClipId）", type: "text", required: true },
    ], poll: "none", result: "data" },
    { id: "get-suno-act-mp4-state", label: "查询 MP4 生成状态", group: "tools", method: "GET", path: "/suno/act/mp4-state", fields: [{ key: "taskBatchId", label: "任务批次 ID（taskBatchId）", type: "text", required: true }], poll: "none", result: "data" },
    { id: "get-suno-act-music-style", label: "获取音乐风格", group: "library", method: "GET", path: "/suno/act/music-style", fields: [], poll: "none", result: "data" },
    { id: "get-suno-act-my-musics", label: "我的音乐列表", group: "library", method: "GET", path: "/suno/act/my-musics", fields: [
        { key: "pageNum", label: "页码", type: "number", min: 1, step: 1, defaultValue: 1 },
        { key: "pageSize", label: "每页条数", type: "number", min: 1, step: 1, defaultValue: 10 },
    ], poll: "none", result: "music" },
    { id: "get-suno-act-timing-id", label: "歌词与音频时间线", group: "tools", method: "GET", path: "/suno/act/timing/{id}", fields: [{ key: "id", label: "歌曲片段 ID（clip_id，非任务 ID）", type: "text", required: true }], poll: "none", result: "data" },
    { id: "get-suno-act-wav-clip-id", label: "获取 WAV 音频", group: "library", method: "GET", path: "/suno/act/wav/{clip_id}", fields: [clipField()], poll: "none", result: "music" },
    { id: "get-suno-act-waveform", label: "获取波形图数据", group: "tools", method: "GET", path: "/suno/act/waveform", fields: [{ key: "clipId", label: "歌曲片段 ID（clipId）", type: "text", required: true }], poll: "none", result: "data" },
    { id: "post-suno-fetch", label: "批量查询任务／歌曲", group: "library", method: "POST", path: "/suno/fetch", fields: [
        { key: "ids", label: "任务 ID／歌曲片段 ID 列表（JSON 数组）", type: "json", required: true },
        { key: "action", label: "查询动作（可选）", type: "text" },
    ], poll: "none", result: "music" },
    { id: "post-suno-submit-adjust-speed", label: "调整播放速度", group: "edit", method: "POST", path: "/suno/submit/adjust-speed", fields: [
        clipField(),
        { key: "speed", label: "播放速度倍率", type: "number", required: true, min: 0.25, max: 4, step: 0.05 },
        { key: "keep_pitch", label: "保持音调", type: "boolean" },
    ], poll: "none", result: "music" },
    { id: "post-suno-submit-concat", label: "拼接完整歌曲", group: "edit", method: "POST", path: "/suno/submit/concat", fields: [clipField()], poll: "task", result: "music" },
    { id: "post-suno-submit-fade", label: "淡入淡出", group: "edit", method: "POST", path: "/suno/submit/fade", fields: [
        clipField(),
        { key: "fade_in_s", label: "淡入时间（秒）", type: "number", min: 0, step: 0.1 },
        { key: "fade_out_s", label: "淡出时间（秒）", type: "number", min: 0, step: 0.1 },
    ], poll: "none", result: "music" },
    { id: "post-suno-submit-mp4", label: "生成 MP4 视频", group: "tools", method: "POST", path: "/suno/submit/mp4", fields: [clipField()], poll: "mp4", result: "data" },
    { id: "post-suno-submit-regen-img", label: "重新生成封面图", group: "edit", method: "POST", path: "/suno/submit/regen-img", fields: [{ key: "task_batch_id", label: "原任务批次 ID（task_batch_id，非歌曲片段 ID）", type: "text", required: true }], poll: "task", result: "data" },
    { id: "post-suno-submit-set-metadata", label: "修改标题／封面", group: "edit", method: "POST", path: "/suno/submit/set-metadata", fields: [
        clipField(),
        { key: "title", label: "新歌曲标题", type: "text", required: true },
        { key: "image_url", label: "新封面地址", type: "text", required: true },
    ], poll: "none", result: "music" },
    { id: "post-suno-submit-stems", label: "人声／伴奏分离（片段）", group: "voice", method: "POST", path: "/suno/submit/stems", fields: [clipField()], poll: "task", result: "music" },
    { id: "post-suno-submit-stems-all", label: "全轨十二路分离（片段）", group: "voice", method: "POST", path: "/suno/submit/stems-all", fields: [clipField()], poll: "task", result: "music" },
    { id: "post-suno-submit-stems-all-by-url", label: "全轨十二路分离（地址）", group: "voice", method: "POST", path: "/suno/submit/stems-all-by-url", fields: [urlField()], poll: "task", result: "music" },
    { id: "post-suno-submit-stems-by-url", label: "人声／伴奏分离（地址）", group: "voice", method: "POST", path: "/suno/submit/stems-by-url", fields: [urlField()], poll: "task", result: "music" },
    { id: "post-suno-submit-upsample-tags", label: "扩展音乐风格", group: "tools", method: "POST", path: "/suno/submit/upsample-tags", fields: [{ key: "original_tags", label: "原始风格描述", type: "textarea", required: true }], poll: "none", result: "text" },
    { id: "post-suno-submit-url-transfer", label: "资源转临时地址", group: "tools", method: "POST", path: "/suno/submit/url-transfer", fields: [urlField()], poll: "none", result: "data" },
];

export function sunoOperation(id: string): SunoOperation {
    const operation = SUNO_OPERATIONS.find((candidate) => candidate.id === id);
    if (operation) return operation;
    throw new Error(`未知 Suno 操作：${id}`);
}

export function sunoDefaultValues(id: string): Record<string, unknown> {
    return Object.fromEntries(sunoOperation(id).fields.filter((field) => field.defaultValue !== undefined).map((field) => [field.key, structuredClone(field.defaultValue)]));
}

function missing(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function visible(field: SunoField, values: Record<string, unknown>): boolean {
    return !field.visibleWhen || field.visibleWhen.values.includes(String(values[field.visibleWhen.key]));
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function cloneJson(value: unknown, ancestors = new Set<object>()): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!Array.isArray(value) && !record(value)) throw new Error("扩展参数必须是有效 JSON 数据");
    if (ancestors.has(value)) throw new Error("扩展参数不能循环引用");
    ancestors.add(value);
    const cloned = Array.isArray(value) ? value.map((item) => cloneJson(item, ancestors)) : Object.fromEntries(Object.entries(value).map(([key, item]) => {
        if (key !== key.trim() || ["__proto__", "prototype", "constructor"].includes(key)) throw new Error("扩展参数包含受保护或拼写无效的键");
        return [key, cloneJson(item, ancestors)];
    }));
    ancestors.delete(value);
    return cloned;
}

function parseJson(value: unknown, label: string): unknown {
    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            throw new Error(`${label}不是有效 JSON`);
        }
    }
    return cloneJson(parsed);
}

function fieldValue(field: SunoField, value: unknown): unknown {
    if (missing(value)) {
        if (field.required) throw new Error(`请填写${field.label}`);
        return undefined;
    }
    if (field.type === "json") {
        const parsed = parseJson(value, field.label);
        if (field.key === "ids" || field.key === "metadata_params.mashup_clip_ids") {
            const min = field.key === "ids" ? 1 : 2;
            if (!Array.isArray(parsed) || parsed.length < min || parsed.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${field.label}至少需要 ${min} 个非空字符串 ID`);
        }
        if (field.key === "metadata_params" && !record(parsed)) throw new Error(`${field.label}必须是 JSON 对象`);
        return parsed;
    }
    if (field.type === "number") {
        const numeric = typeof value === "string" ? Number(value.trim()) : value;
        if (typeof numeric !== "number" || !Number.isFinite(numeric)) throw new Error(`${field.label}必须是有限数字`);
        if ((field.min !== undefined && numeric < field.min) || (field.max !== undefined && numeric > field.max)) throw new Error(`${field.label}超出允许范围`);
        if (field.step === 1 && !Number.isInteger(numeric)) throw new Error(`${field.label}必须是整数`);
        return numeric;
    }
    if (field.type === "boolean") {
        if (typeof value !== "boolean") throw new Error(`${field.label}必须是布尔值`);
        return value;
    }
    if (typeof value !== "string") throw new Error(`${field.label}必须是文本`);
    if (field.type === "select" && !field.options?.some((option) => option.value === value)) throw new Error(`${field.label}选项无效`);
    return value;
}

function getPath(values: Record<string, unknown>, path: string): unknown {
    let current: unknown = values;
    for (const key of path.split(".")) {
        if (!record(current) || !Object.hasOwn(current, key)) return undefined;
        current = current[key];
    }
    return current;
}

function setPath(values: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split(".");
    const last = keys.pop()!;
    let current = values;
    for (const key of keys) {
        if (!record(current[key])) current[key] = {};
        current = current[key] as Record<string, unknown>;
    }
    current[last] = value;
}

function removePath(values: Record<string, unknown>, path: string): void {
    const [key, ...rest] = path.split(".");
    if (!rest.length) {
        delete values[key];
    } else if (record(values[key])) {
        removePath(values[key], rest.join("."));
        if (!Object.keys(values[key]).length) delete values[key];
    }
}

function mergeMetadata(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(source)) {
        if (!Object.hasOwn(target, key)) target[key] = value;
        else if (record(target[key]) && record(value)) mergeMetadata(target[key], value);
        else if (JSON.stringify(target[key]) !== JSON.stringify(value)) throw new Error("顶层与嵌套扩展参数存在冲突值");
    }
}

function prepareMusicValues(values: Record<string, unknown>): Record<string, unknown> {
    const prepared = { ...sunoDefaultValues("post-suno-submit-music"), ...values };
    const wrapper = missing(values.metadata) ? {} : values.metadata;
    if (!record(wrapper) || Object.keys(wrapper).some((key) => !["task", "metadata_params", "metadataParams"].includes(key))) throw new Error("metadata 仅支持文档中的任务类型与扩展参数");
    if (values.task !== undefined && wrapper.task !== undefined && values.task !== wrapper.task) throw new Error("顶层与嵌套任务类型不一致");
    prepared.task = values.task !== undefined ? values.task : wrapper.task ?? "";
    if (values.mode === undefined) {
        if (!missing(values.prompt) && !missing(values.gpt_description_prompt)) throw new Error("请选择创作模式，歌词与灵感描述不能同时提交");
        prepared.mode = missing(values.prompt) ? "description" : "custom";
    }
    const taskField = musicFields.find((field) => field.key === "task")!;
    prepared.task = fieldValue(taskField, prepared.task) ?? "";
    const extensionField = musicFields.find((field) => field.key === "metadata_params")!;
    if (!visible(extensionField, prepared)) return prepared;
    const extension: Record<string, unknown> = {};
    for (const source of [values.metadata_params, wrapper.metadata_params, wrapper.metadataParams]) {
        if (!missing(source)) mergeMetadata(extension, fieldValue(extensionField, source) as Record<string, unknown>);
    }
    const metadataFields = musicFields.filter((candidate) => candidate.key.startsWith("metadata_params."));
    const protectedKeys = new Set(musicFields.filter((field) => !field.key.includes(".")).map((field) => field.key));
    for (const field of metadataFields) protectedKeys.delete(field.key.split(".")[1]);
    for (const key of Object.keys(extension)) if (protectedKeys.has(key)) throw new Error("高级扩展参数不能覆盖顶层字段");
    for (const field of metadataFields) {
        const path = field.key.slice("metadata_params.".length);
        const nested = getPath(extension, path);
        if (nested !== undefined && visible(field, prepared)) {
            if (!missing(prepared[field.key]) && JSON.stringify(fieldValue(field, prepared[field.key])) !== JSON.stringify(fieldValue(field, nested))) throw new Error(`${field.label}存在冲突值`);
            if (missing(prepared[field.key])) prepared[field.key] = nested;
        }
        removePath(extension, path);
    }
    prepared.metadata_params = extension;
    return prepared;
}

function requireMusicValue(body: Record<string, unknown>, key: string, alternative?: string): void {
    if (missing(getPath(body, key)) && (!alternative || missing(getPath(body, alternative)))) throw new Error(`请填写${musicFields.find((field) => field.key === key)?.label ?? key}`);
}

function validateInterval(body: Record<string, unknown>, startKey: string, endKey: string, required = false): void {
    const start = getPath(body, startKey);
    const end = getPath(body, endKey);
    if (!required && start === undefined && end === undefined) return;
    if (typeof start !== "number" || typeof end !== "number") throw new Error("请填写完整的开始和结束时间");
    if (end <= start) throw new Error("结束时间必须大于开始时间");
}

function validateMusic(body: Record<string, unknown>, mode: unknown): void {
    const task = String(body.task ?? "");
    if (!task) {
        if (mode === "description") requireMusicValue(body, "gpt_description_prompt");
        else if (body.make_instrumental !== true) requireMusicValue(body, "prompt");
    }
    for (const key of ["artist_clip_id", "persona_id", "continue_clip_id"]) {
        const nested = getPath(body, `metadata_params.${key}`);
        if (body[key] !== undefined && nested !== undefined && body[key] !== nested) throw new Error("顶层与扩展参数中的源片段／歌手风格 ID 不一致");
    }
    if (extendTasks.includes(task)) requireMusicValue(body, "continue_clip_id");
    if (infillTasks.includes(task)) {
        requireMusicValue(body, "continue_clip_id", "metadata_params.continue_clip_id");
        validateInterval(body, "metadata_params.infill_start_s", "metadata_params.infill_end_s", true);
        validateInterval(body, "metadata_params.infill_context_start_s", "metadata_params.infill_context_end_s");
    }
    if (["artist_consistency", "remaster", "mashup_condition"].includes(task)) requireMusicValue(body, "prompt");
    if (task === "artist_consistency") {
        requireMusicValue(body, "persona_id", "metadata_params.persona_id");
        requireMusicValue(body, "artist_clip_id", "metadata_params.artist_clip_id");
        if (!["chirp-v3-5-tau", "chirp-v4-tau"].includes(String(body.mv))) throw new Error("歌手风格一致任务仅支持 chirp-v3-5-tau 或 chirp-v4-tau");
    }
    if (task === "vox") requireMusicValue(body, "artist_clip_id", "metadata_params.artist_clip_id");
    if (task === "underpainting") validateInterval(body, "metadata_params.underpainting_start_s", "metadata_params.underpainting_end_s", true);
}

export function buildSunoRequest(id: string, values: Record<string, unknown>): { method: "GET" | "POST"; path: string; body?: Record<string, unknown> } {
    const operation = sunoOperation(id);
    const prepared = id === "post-suno-submit-music" ? prepareMusicValues(values) : { ...sunoDefaultValues(id), ...values };
    const body: Record<string, unknown> = {};
    if (id === "post-suno-submit-music" && prepared.task && record(prepared.metadata_params) && Object.keys(prepared.metadata_params).length) body.metadata_params = prepared.metadata_params;
    for (const field of operation.fields) {
        if (!visible(field, prepared)) continue;
        const value = fieldValue(field, prepared[field.key]);
        if (value === undefined || (id === "post-suno-submit-music" && ["mode", "metadata_params"].includes(field.key))) continue;
        setPath(body, field.key, value);
    }
    if (id === "post-suno-submit-music") validateMusic(body, prepared.mode);
    if (id === "post-suno-submit-persona") validateInterval(body, "vocal_start_s", "vocal_end_s", true);
    if (operation.method === "POST") return { method: "POST", path: operation.path, body };
    let path = operation.path;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
        const placeholder = `{${key}}`;
        if (path.includes(placeholder)) path = path.replace(placeholder, encodeURIComponent(String(value)));
        else query.set(key, String(value));
    }
    const suffix = query.toString();
    return { method: "GET", path: suffix ? `${path}?${suffix}` : path };
}
