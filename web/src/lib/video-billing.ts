export type VideoBilling = {
    enabled: true;
    unit: "per_item" | "per_second";
    default_resolution?: string;
    tiers: Array<{ key: string; price_per_item?: number; price_per_second?: number }>;
};

export function sanitizeVideoBilling(value: unknown, quotaType?: unknown, modelPrice?: unknown): VideoBilling | null {
    if (value === undefined || value === null) {
        if ((quotaType !== 1 && quotaType !== 2) || typeof modelPrice !== "number" || !Number.isFinite(modelPrice) || modelPrice < 0) return null;
        return { enabled: true, unit: quotaType === 1 ? "per_item" : "per_second", tiers: [{ key: "", ...(quotaType === 1 ? { price_per_item: modelPrice } : { price_per_second: modelPrice }) }] };
    }
    if (typeof value !== "object") return null;
    const billing = value as Partial<VideoBilling>;
    if (billing.enabled !== true || !["per_item", "per_second"].includes(billing.unit || "") || !Array.isArray(billing.tiers)) return null;
    const field = billing.unit === "per_item" ? "price_per_item" : "price_per_second";
    const tiers = billing.tiers.filter((tier) => tier && typeof tier.key === "string" && typeof tier[field] === "number" && Number.isFinite(tier[field]) && tier[field]! >= 0)
        .map((tier) => ({ key: tier.key.trim(), [field]: tier[field] }));
    if (!tiers.length) return null;
    return { enabled: true, unit: billing.unit!, ...(typeof billing.default_resolution === "string" ? { default_resolution: billing.default_resolution } : {}), tiers };
}

export function videoBillingLines(value: unknown): string[] {
    const billing = sanitizeVideoBilling(value);
    if (!billing) return [];
    const field = billing.unit === "per_item" ? "price_per_item" : "price_per_second";
    const unit = billing.unit === "per_item" ? "条" : "秒";
    return billing.tiers.map((tier) => `${tier.key ? `${tier.key}：` : ""}${tier[field]} / ${unit}`);
}

export function videoBillingSummary(value: unknown): string {
    const billing = sanitizeVideoBilling(value);
    if (!billing) return "";
    const field = billing.unit === "per_item" ? "price_per_item" : "price_per_second";
    const prices = billing.tiers.map((tier) => tier[field]!);
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    return `${lowest}${lowest !== highest ? `–${highest}` : ""} / ${billing.unit === "per_item" ? "条" : "秒"}`;
}
