import { expect, test } from "bun:test";
import { resolvePackagedWindowsBuild } from "../desktop-build-mode";

test("only packaged Windows desktop builds restrict model settings", () => {
    expect(resolvePackagedWindowsBuild("build", "desktop", "win32")).toBe(true);
    expect(resolvePackagedWindowsBuild("serve", "desktop", "win32")).toBe(false);
    expect(resolvePackagedWindowsBuild("serve", "development", "win32")).toBe(false);
    expect(resolvePackagedWindowsBuild("build", "production", "win32")).toBe(false);
    expect(resolvePackagedWindowsBuild("build", "desktop", "darwin")).toBe(false);
    expect(resolvePackagedWindowsBuild("build", "desktop", "linux")).toBe(false);
});
