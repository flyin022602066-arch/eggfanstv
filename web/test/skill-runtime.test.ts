import { describe, expect, test } from "bun:test";

import type { Skill, SkillPackageFile, SkillPackageFileContent } from "../src/services/api/skills";
import { createSkillRuntime, resolveCanvasAgentSkillIds, resolveSkillMentions, SKILL_RUNTIME_PROFILES } from "../src/services/skill-runtime";

function skill(overrides: Partial<Skill> = {}): Skill {
    return {
        skillId: "director",
        skillName: "AI导演",
        description: "导演工作流",
        versionId: "version-2",
        version: "2.0.0",
        contentHash: "hash",
        fileCount: 5,
        totalBytes: 1024,
        sourceType: "zip",
        sourceUrl: "",
        sourceRef: "",
        sourceSubdir: "",
        sourceCommit: "",
        syncStatus: "synced",
        autoUpdate: false,
        lastCheckedAt: "2026-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        status: 1,
        markdownUrl: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        source: 0,
        tag: "影视",
        sortWeight: 0,
        isPrivate: true,
        likeCount: 0,
        isLike: false,
        ownerUid: "user",
        effectiveUser: { name: "用户", avatarUrl: "", uid: "user" },
        originalSkillId: null,
        showcaseMedia: [],
        addedCount: 1,
        isTest: false,
        extraInfo: "",
        isAdded: true,
        isOwner: true,
        ...overrides,
    };
}

function file(path: string, content: string, kind: SkillPackageFile["kind"] = "markdown"): SkillPackageFileContent {
    return {
        file: { path, kind, mimeType: "text/markdown", size: content.length, sha256: `sha-${path}` },
        content,
        binary: false,
    };
}

describe("skill runtime", () => {
    test("failed skill preparation retains successful and failed outcomes without submitting partial context", async () => {
        const runtime = createSkillRuntime({
            listFiles: async () => ({ files: [] }),
            getFile: async (id) => {
                if (id === "lighting") throw new Error("connection unavailable");
                return { file: file("SKILL.md", "# Camera rules") };
            },
        });
        let failure: unknown;
        try {
            await runtime.prepare({ profile: "shortDrama", prompt: "story", skills: [skill(), skill({ skillId: "lighting", skillName: "Lighting" })], selectedSkillIds: ["director", "lighting"] });
        } catch (error) { failure = error; }
        expect((failure as Error)?.name).toBe("SkillRuntimePreparationError");
        expect((failure as Error & { report: unknown }).report).toMatchObject([
            { skillId: "director", status: "loaded", files: ["SKILL.md"], version: "2.0.0" },
            { skillId: "lighting", status: "failed", reason: "file_read_failed" },
        ]);
    });

    test("unavailable selected skills cannot silently disappear from the request", async () => {
        const runtime = createSkillRuntime({ listFiles: async () => ({ files: [] }), getFile: async () => ({ file: file("SKILL.md", "# Rules") }) });
        let failure: unknown;
        try {
            await runtime.prepare({ profile: "shortDrama", prompt: "story", skills: [skill({ isAdded: false })], selectedSkillIds: ["director", "missing"] });
        } catch (error) { failure = error; }
        expect((failure as Error | undefined)?.name).toBe("SkillRuntimePreparationError");
        expect((failure as Error & { report: unknown }).report).toMatchObject([
            { skillId: "director", status: "failed", reason: "unavailable" },
            { skillId: "missing", status: "failed", reason: "unavailable" },
        ]);
    });

    test("empty skill entries fail and selected skills beyond the limit are explicitly skipped", async () => {
        const skills = ["a", "b", "c", "d", "e", "f"].map((id) => skill({ skillId: id }));
        const runtime = createSkillRuntime({ listFiles: async () => ({ files: [] }), getFile: async (id) => ({ file: file("SKILL.md", id === "b" ? "  " : "# Rules") }) });
        let failure: unknown;
        try { await runtime.prepare({ profile: "shortDrama", prompt: "story", skills, selectedSkillIds: skills.map((item) => item.skillId) }); }
        catch (error) { failure = error; }
        expect((failure as Error)?.name).toBe("SkillRuntimePreparationError");
        expect((failure as Error & { report: unknown }).report).toMatchObject([
            { skillId: "a", status: "loaded" }, { skillId: "b", status: "failed", reason: "empty_entry" },
            { skillId: "c", status: "loaded" }, { skillId: "d", status: "loaded" },
            { skillId: "e", status: "loaded" },
            { skillId: "f", status: "skipped", reason: "selection_limit" },
        ]);
    });

    test("successful preparation persists actual files and warns when context was truncated", async () => {
        const budget = SKILL_RUNTIME_PROFILES.shortDrama.maxContextChars;
        const runtime = createSkillRuntime({ listFiles: async () => ({ files: [] }), getFile: async () => ({ file: file("SKILL.md", "x".repeat(budget + 1_000)) }) });
        const result = await runtime.prepare({ profile: "shortDrama", prompt: "story", skills: [skill()], selectedSkillIds: ["director"] });
        expect(result.metadata.skillLoadReport).toMatchObject([{ skillId: "director", skillName: "AI导演", status: "loaded", files: ["SKILL.md"], truncated: true }]);
        expect(result.prompt).not.toContain("x".repeat(budget + 1));
    });

    test("视频生成使用技能的专用规则而不发送整份 Agent 工作流", async () => {
        const entry = "# 导演工作流\n" + "分析世界观并输出表格。".repeat(1800);
        const guidance = "保持参考图身份与服装，按已确认节拍连续表演。";
        const readPaths: string[] = [];
        const runtime = createSkillRuntime({
            getFile: async (_id, path) => {
                readPaths.push(path);
                return { file: file(path, path === "references/video-generation.md" ? guidance : entry) };
            },
            listFiles: async () => ({ files: [file("SKILL.md", entry).file, file("references/video-generation.md", guidance).file] }),
        });
        const result = await runtime.prepare({ profile: "shortDrama", purpose: "video", prompt: "0–30秒：角色说“我们回家。”", skills: [skill()], selectedSkillIds: ["director"] });
        expect(result.prompt).toContain(guidance);
        expect(result.prompt).toContain("0–30秒：角色说“我们回家。”");
        expect(result.prompt).not.toContain(entry);
        expect(result.prompt).not.toContain("<skill-context");
        expect(result.prompt).not.toContain("权限边界");
        expect(readPaths).toEqual(["references/video-generation.md"]);
        expect(result.metadata.skillFiles).toEqual([{ skillId: "director", path: "references/video-generation.md", sha256: "sha-references/video-generation.md" }]);
        const original = await runtime.prepare({ profile: "canvas", prompt: "拆解故事", skills: [skill()], selectedSkillIds: ["director"] });
        expect(original.prompt).toContain(entry);
    });

    test("画布小说改编自动选择已安装技能并保留既有选择", () => {
        const novel = skill({ skillId: "eggfans-novel-screenplay", skillName: "小说拆解剧本" });
        expect(resolveCanvasAgentSkillIds("将画布小说改编为短剧剧本", [skill(), novel], ["director"])).toEqual(["director", novel.skillId]);
        expect(resolveCanvasAgentSkillIds("继续写第2集", [novel], [novel.skillId])).toEqual([novel.skillId]);
        expect(resolveCanvasAgentSkillIds("@[skill:eggfans-novel-screenplay] 分析这段文字", [novel], [])).toEqual([novel.skillId]);
        expect(resolveCanvasAgentSkillIds("给图片调色", [novel], [])).toEqual([]);
        expect(resolveCanvasAgentSkillIds("将小说拆解成剧本", [skill({ ...novel, isAdded: false })], [])).toEqual([]);
        expect(resolveCanvasAgentSkillIds("将小说拆解成剧本", [skill({ ...novel, status: 0 })], [])).toEqual([]);
        expect(resolveCanvasAgentSkillIds("将小说拆解成剧本", [novel], ["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
    });

    test("技能引用解析由统一规则同时支持稳定 token 和自然提及", () => {
        const director = skill();
        const storyboard = skill({ skillId: "storyboard", skillName: "小说转分镜" });

        expect(resolveSkillMentions("用 @[skill:director] 处理", [director, storyboard]).map((item) => item.skillId)).toEqual(["director"]);
        expect(resolveSkillMentions("请用 @小说转分镜。", [director, storyboard]).map((item) => item.skillId)).toEqual(["storyboard"]);
        expect(resolveSkillMentions("请用 /小说转分镜 处理。", [director, storyboard]).map((item) => item.skillId)).toEqual(["storyboard"]);
        expect(resolveSkillMentions("@AI导演增强版", [director])).toEqual([]);
        expect(resolveSkillMentions("/AI导演增强版", [director])).toEqual([]);
    });

    test("普通生成只加载入口和与当前任务最相关的直接引用文本", async () => {
        const entry = [
            "# AI导演",
            "视频提示词读取 `references/prompt_templates.md`。",
            "角色资产读取 [角色规则](references/character_assets.md)。",
            "维护脚本见 `scripts/audit_skill.py`。",
            "项目模板见 `assets/project-ledger-template.md`。",
        ].join("\n");
        const files: SkillPackageFile[] = [
            file("SKILL.md", entry).file,
            file("references/prompt_templates.md", "视频提示词模板正文").file,
            file("references/character_assets.md", "角色资产正文").file,
            file("scripts/audit_skill.py", "print('audit')", "code").file,
            file("assets/project-ledger-template.md", "台账模板").file,
        ];
        const readPaths: string[] = [];
        const runtime = createSkillRuntime({
            getFile: async (_id, path) => {
                readPaths.push(path);
                if (path === "SKILL.md") return { file: file(path, entry) };
                return { file: file(path, path.includes("prompt_templates") ? "视频提示词模板正文" : "角色资产正文") };
            },
            listFiles: async () => ({ files }),
        });

        const result = await runtime.prepare({ profile: "canvas", prompt: "@[skill:director] 帮我生成视频提示词", skills: [skill()] });

        expect(result.prompt).toContain('<skill-file path="SKILL.md">');
        expect(result.prompt).toContain('<skill-file path="references/prompt_templates.md">');
        expect(readPaths).not.toContain("references/character_assets.md");
        expect(readPaths).not.toContain("scripts/audit_skill.py");
        expect(readPaths).not.toContain("assets/project-ledger-template.md");
        expect(result.prompt).toContain("【用户任务】\n@AI导演 帮我生成视频提示词");
        expect(result.metadata.skillIds).toEqual(["director"]);
    });

    test("云端 Agent 只准备已加入技能的上下文并保留来源", async () => {
        const runtime = createSkillRuntime({
            getFile: async () => ({ file: file("SKILL.md", "# AI导演") }),
            listFiles: async () => ({ files: [] }),
        });

        const result = await runtime.prepare({ profile: "canvas", prompt: "@[skill:director] 开始", skills: [skill()] });
        expect(result.selectedSkills.map((item) => item.skillId)).toEqual(["director"]);
        expect(result.prompt).toContain('<skill-context skill-id="director"');
        expect(result.metadata.skillIds).toEqual(["director"]);
    });
});
