import { expect, test } from "bun:test";

async function source(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

test("Skill marketplace routes open the skill library in the workspace", async () => {
    const [router, sidebar] = await Promise.all([
        source("../src/router.tsx"),
        source("../src/components/layout/workspace-sidebar-nav.tsx"),
    ]);
    expect(router).toContain('{ path: "/skills", element: deferred(<SkillsPage />) }');
    expect(router).toContain('{ path: "/skill", element: <Navigate to="/skills" replace /> }');
    expect(router).toContain("const SkillsPage = lazy(loadSkillsPage);");
    expect(sidebar).toContain('id: "skills", title: "技能库"');
    expect(await source("../src/pages/skills/index.tsx")).toContain('searchParams.get("create") !== "1"');
});

test("Desktop Agent loads local skills from the bundled API", async () => {
    const panel = await source("../src/components/canvas/canvas-cloud-agent-panel.tsx");
    expect(panel).toContain("listAddedSkills()");
    expect(panel).toContain("listSkills({");
    expect(panel).not.toContain('setSkills([]);\n            return () => { active = false; };');
});
