import type { SunoField, SunoOperation } from "@/lib/suno-contract";

export function fieldValue(values: Record<string, unknown>, key: string): unknown {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, values);
}

export function fieldVisible(field: SunoField, values: Record<string, unknown>) {
    return !field.visibleWhen || field.visibleWhen.values.includes(String(fieldValue(values, field.visibleWhen.key) ?? ""));
}

export function updateStudioValues(operation: SunoOperation, values: Record<string, unknown>, key: string, value: unknown) {
    const next = { ...values, [key]: value };
    const changedMode = key === "mode" && values.mode !== value;
    if (changedMode) next.task = "";
    if (key === "task" && value) {
        next.mode = "custom";
        delete next.gpt_description_prompt;
    }
    if ((key === "task" && values.task !== value) || changedMode) {
        for (const field of operation.fields) {
            if (field.key.startsWith("metadata") || field.visibleWhen?.key === "task") delete next[field.key];
        }
    }
    for (const field of operation.fields) {
        if (!fieldVisible(field, next)) delete next[field.key];
    }
    return next;
}
