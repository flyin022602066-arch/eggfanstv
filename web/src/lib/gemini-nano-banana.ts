export const GEMINI_NANO_BANANA_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2", "4:5", "5:4", "1:4", "4:1", "1:8", "8:1", "21:9"];

export function isGeminiNanoBananaModel(model = "") {
    return /^(?:models\/)?gemini-nano-banana-2\.1(?:-(?:thinking|nothinking))?$/u.test(model.trim().toLowerCase().split("::").pop() || "");
}

export function geminiNanoBananaThinkingLevel(model: string, value?: string) {
    if (!isGeminiNanoBananaModel(model)) return undefined;
    return value === "minimal" || value === "high" ? value : undefined;
}
