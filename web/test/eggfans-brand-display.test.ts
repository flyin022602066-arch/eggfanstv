import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("bootstrap and route loading screens use the Eggfans TV logo and name", () => {
    const html = source("../index.html");
    const loader = source("../src/components/ui/aceternity/full-screen-loader.tsx");
    const css = source("../src/styles/globals.css");
    expect(html).toContain('content: "Eggfans TV"');
    expect(html).toContain("url('/eggfans-logo.png')");
    expect(html).not.toContain("beef-logo.png");
    expect(loader).toContain('src="/eggfans-logo.png"');
    expect(loader).toContain("Eggfans TV");
    expect(loader).not.toContain("beeftv-loading-logo");
    expect(css).not.toContain("beef-logo.png");
});

test("MCP and Agent screens present Eggfans TV instead of the upstream product", () => {
    for (const path of [
        "../src/pages/agents/index.tsx",
        "../src/pages/agents/agent-connect-panel.tsx",
        "../src/pages/agents/agent-client-presentation.ts",
        "../src/pages/canvas/canvas-assistant-sidebar.tsx",
        "../src/pages/canvas/canvas-assistant-copy.ts",
        "../src/components/layout/app-changelog.zh.ts",
    ]) {
        expect(source(path)).not.toMatch(/\bBeefTV\b/);
    }
    expect(source("../src/pages/agents/index.tsx")).toContain('title="Eggfans TV MCP"');
});
