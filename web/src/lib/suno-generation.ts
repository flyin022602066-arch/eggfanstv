import { buildSunoRequest, SUNO_MODELS, sunoDefaultValues } from "@/lib/suno-contract";

export function isSunoModel(model = "") {
    const name = model.split("::").at(-1)?.trim().toLowerCase() || "";
    return /^suno(?:$|[-_])/.test(name) || SUNO_MODELS.some((item) => item.value === name) || ["chirp-auk", "chirp-fenix"].includes(name);
}

export function sunoMusicSettings(serialized = "", model = ""): Record<string, unknown> {
    const name = model.split("::").at(-1)?.trim() || "";
    const defaults = { ...sunoDefaultValues("post-suno-submit-music"), ...(SUNO_MODELS.some((item) => item.value === name) ? { mv: name } : {}) };
    if (!serialized.trim()) return defaults;
    let values: unknown;
    try { values = JSON.parse(serialized); } catch { throw new Error("Suno 音乐参数记录不是有效 JSON，请重新设置"); }
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Suno 音乐参数必须是对象");
    return { ...defaults, ...values };
}

export function canvasSunoBody(config: { model?: string; audioSunoParams?: string }, prompt: string) {
    const values = sunoMusicSettings(config.audioSunoParams, config.model);
    const promptKey = values.mode === "custom" ? "prompt" : "gpt_description_prompt";
    return buildSunoRequest("post-suno-submit-music", { ...values, [promptKey]: prompt }).body!;
}

export function sunoSettingsSummary(config: { model?: string; audioSunoParams?: string }) {
    const values = sunoMusicSettings(config.audioSunoParams, config.model);
    const label = SUNO_MODELS.find((item) => item.value === values.mv)?.label || String(values.mv);
    return `${label} · ${values.mode === "custom" ? "自定义" : "描述"}${values.make_instrumental ? " · 纯音乐" : ""}`;
}
