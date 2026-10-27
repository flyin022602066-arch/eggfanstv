import { expect, test } from "bun:test";
import { temporaryImageLink } from "../src/lib/temporary-image-url";

const uploadedAt = "2026-10-08T05:00:00Z";
const expiresAt = "2026-10-08T08:00:00Z";
const resource = { temporaryImageUrl: "https://h.uguu.se/reference.png", temporaryImageUploadedAt: uploadedAt, temporaryImageExpiresAt: expiresAt };

test("uploaded URL survives reload and uses original expiry", () => {
    expect(temporaryImageLink(JSON.parse(JSON.stringify(resource)), Date.parse(uploadedAt))).toEqual({ status: "ready", url: resource.temporaryImageUrl, uploadedAt: Date.parse(uploadedAt), expiresAt: Date.parse(expiresAt) });
    expect(temporaryImageLink(resource, Date.parse(expiresAt) - 1).status).toBe("ready");
    expect(temporaryImageLink(resource, Date.parse(expiresAt))).toEqual({ status: "expired" });
});

test("missing, invalid and expired URLs are not offered for copying", () => {
    expect(temporaryImageLink({})).toEqual({ status: "missing" });
    for (const url of ["http://h.uguu.se/a.png", "javascript:alert(1)", "https://uguu.se.attacker.example/a.png", "https://secret@h.uguu.se/a.png", "https://h.uguu.se:444/a.png"]) {
        expect(temporaryImageLink({ ...resource, temporaryImageUrl: url }, Date.parse(uploadedAt))).toEqual({ status: "invalid" });
    }
    expect(temporaryImageLink({ ...resource, temporaryImageExpiresAt: "unknown" })).toEqual({ status: "invalid" });
});
