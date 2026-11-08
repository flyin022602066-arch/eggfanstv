import { expect, test } from "bun:test";
import type { Skill, SkillPackageFileContent } from "../src/services/api/skills";
import { createSkillRuntime } from "../src/services/skill-runtime";

const root = new URL("../../skill-packages/novel-adaptation/advanced-novel-screenplay/", import.meta.url);

test("advanced adaptation instructions load completely beside three other selected skills", async () => {
    const paths = ["SKILL.md", "references/novel-screenplay-spec.md"];
    const contents = new Map<string, SkillPackageFileContent>();
    for (const path of paths) {
        const content = await Bun.file(new URL(path, root)).text();
        contents.set(path, { file: { path, kind: "markdown", mimeType: "text/markdown", size: new TextEncoder().encode(content).length, sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex") }, content, binary: false });
    }
    const skill = { skillId: "advanced-novel-screenplay", skillName: "Advanced novel screenplay", isAdded: true, status: 1, versionId: "offline-v1", version: "1.0.0" } as Skill;
    const others = ["camera", "lighting", "continuity"].map((id) => ({ ...skill, skillId: id }));
    const runtime = createSkillRuntime({
        listFiles: async (id) => ({ files: id === skill.skillId ? [...contents.values()].map((item) => item.file) : [] }),
        getFile: async (id, path) => ({ file: id === skill.skillId ? contents.get(path)! : { file: { path, kind: "markdown", mimeType: "text/markdown", size: 8 }, content: "# Rules", binary: false } }),
    });
    for (const profile of ["canvas", "shortDrama"] as const) {
        const result = await runtime.prepare({ profile, prompt: "Adapt this provided chapter using project requirements", skills: [skill, ...others], selectedSkillIds: [skill, ...others].map((item) => item.skillId) });
        for (const item of contents.values()) expect(result.prompt).toContain(item.content);
        expect(result.selectedSkills).toHaveLength(4);
        expect(result.metadata.skillLoadReport?.find((item) => item.skillId === skill.skillId)).toEqual({ skillId: skill.skillId, skillName: skill.skillName, version: skill.version, status: "loaded", files: paths, truncated: false });
        expect(result.metadata.skillFiles?.filter((item) => item.skillId === skill.skillId)).toEqual([...contents.values()].map((item) => ({ skillId: skill.skillId, path: item.file.path, sha256: item.file.sha256 })));
    }
});
