import { expect, test } from "bun:test";
import type { Skill, SkillPackageFileContent } from "../src/services/api/skills";
import { createSkillRuntime } from "../src/services/skill-runtime";

const root = new URL("../../skill-packages/cinematography/", import.meta.url);
const catalog: Array<{ directory: string; displayName: string; tag: string }> = await Bun.file(new URL("catalog.json", root)).json();
const entries = await Promise.all(catalog.map(async (item) => {
    const content = await Bun.file(new URL(item.directory + "/SKILL.md", root)).text();
    const link = content.match(/\]\((references\/[^)]+\.md)\)/)?.[1];
    if (!link) throw new Error("missing package reference: " + item.directory);
    const reference = await Bun.file(new URL(item.directory + "/" + link, root)).text();
    const files = new Map<string, SkillPackageFileContent>();
    for (const [path, body] of [["SKILL.md", content], [link, reference]]) {
        files.set(path!, { file: { path: path!, kind: "markdown", mimeType: "text/markdown", size: new TextEncoder().encode(body).length, sha256: new Bun.CryptoHasher("sha256").update(body!).digest("hex") }, content: body!, binary: false });
    }
    return { skill: { skillId: item.directory, skillName: item.displayName, description: item.displayName, status: 1, isAdded: true, versionId: item.directory + "-v1", version: "1.0.0" } as Skill, files };
}));

for (const profile of ["canvas", "creation", "shortDrama", "director"] as const) {
    test("all four cinematography packages and references load completely for " + profile, async () => {
        const runtime = createSkillRuntime({
            listFiles: async (id) => ({ files: [...entries.find((entry) => entry.skill.skillId === id)!.files.values()].map((file) => file.file) }),
            getFile: async (id, path) => ({ file: entries.find((entry) => entry.skill.skillId === id)!.files.get(path)! }),
        });
        const result = await runtime.prepare({ profile, prompt: "检查当前镜头摄影与光影，保留项目合同", skills: entries.map((entry) => entry.skill), selectedSkillIds: entries.map((entry) => entry.skill.skillId) });
        expect(result.selectedSkills).toHaveLength(4);
        expect(result.metadata.skillVersions).toHaveLength(4);
        expect(result.metadata.skillFiles).toHaveLength(8);
        for (const entry of entries) for (const file of entry.files.values()) expect(result.prompt).toContain(file.content);
        expect(result.prompt).not.toContain("文件内容超过本轮技能上下文预算");
    });
}
