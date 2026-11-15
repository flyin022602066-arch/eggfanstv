import type { RemoteResource } from "@/services/api/resources";

export function temporaryImageLink(resource: Pick<RemoteResource, "temporaryImageUrl" | "temporaryImageUploadedAt" | "temporaryImageExpiresAt">, now = Date.now()) {
    if (!resource.temporaryImageUrl) return { status: "missing" as const };
    const uploadedAt = Date.parse(resource.temporaryImageUploadedAt || "");
    const expiresAt = Date.parse(resource.temporaryImageExpiresAt || "");
    try {
        const parsed = new URL(resource.temporaryImageUrl);
        const backup = !parsed.search && (parsed.hostname === "u.pone.rs" && parsed.pathname !== "/" || parsed.hostname === "leopard.hosting.pecon.us" && /^\/dl\/[^/]+\/[^/]+$/.test(parsed.pathname));
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || (parsed.port && parsed.port !== "443") || !(parsed.hostname === "uguu.se" || parsed.hostname.endsWith(".uguu.se") || backup)) return { status: "invalid" as const };
    } catch {
        return { status: "invalid" as const };
    }
    if (!Number.isFinite(uploadedAt) || !Number.isFinite(expiresAt) || expiresAt <= uploadedAt) return { status: "invalid" as const };
    if (now >= expiresAt) return { status: "expired" as const };
    return { status: "ready" as const, url: resource.temporaryImageUrl, uploadedAt, expiresAt };
}
