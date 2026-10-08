import { expect, test } from "bun:test";

const homeData = await Bun.file(new URL("../src/pages/home/home-data.ts", import.meta.url)).text();
const router = await Bun.file(new URL("../src/router.tsx", import.meta.url)).text();
const entry = await Bun.file(new URL("../src/pages/editor/index.tsx", import.meta.url)).text();

test("smart editing opens the full editor instead of the canvas", () => {
    expect(homeData).toContain('id: "edit"');
    expect(homeData).toContain('to: "/editor"');
    expect(router).toContain('path: "/editor"');
    expect(router).toContain('element: deferred(<EditorPage />)');
    expect(router).toContain('element: deferred(<ProjectsPage />)');
    expect(router).not.toContain("if (localMode && projectId)");
    expect(entry).toContain('navigate("/projects/" + project.id + "/editor"');
});
