import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/projects/detail.tsx", import.meta.url), "utf8");

test("project detail creates canvases through the central local workspace boundary", () => {
    expect(source).toContain('import { isLocalWorkspaceMode } from "@/services/workspace-mode";');
    expect(source).toContain("if (isLocalWorkspaceMode()) {");
    expect(source).not.toContain('if (import.meta.env.VITE_CANVAS_LOCAL_MODE !== "false")');
});

test("editor loads all episodes rather than reusing the last chapter workspace", () => {
    const query = source.slice(source.indexOf("const editorQuery = useQuery({"), source.indexOf("const project = coreQuery.data?.project;"));
    expect(query).toContain('queryKey: ["project", projectId, "editor-workspace"]');
    expect(query).toContain("queryFn: () => getProject(projectId)");
    expect(query).toContain('enabled: Boolean(projectId) && activeView === "editor"');
    expect(query).toContain('refetchOnMount: "always"');
    expect(source).toContain("<ProjectEditorView detail={editorQuery.data} />");
    expect(source).not.toContain("<ProjectEditorView detail={detail} />");
    expect(source).toContain("onRetry={() => void editorQuery.refetch()}");
});
