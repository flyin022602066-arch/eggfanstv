import { describe, expect, test } from "bun:test";
import { characterLookCandidates, characterLookDraft, characterLookDisplayVersions, characterLookImageTargets, characterReferenceImage, characterSelectionShots, characterSelectionTargets, parseCharacterSelectionResponse, validateCharacterSelections, type CharacterSelectionShot } from "@/lib/character-look-selection";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";
import { createAndBindProjectShotCharacter, identifyProjectCharacterReferences } from "@/services/project-character-references";
import type { ProjectAsset, ProjectUnitWorkspace, ShotAssetReference } from "@/services/api/projects";
import { setActiveUserScope } from "@/lib/user-scope";
import type { AiConfig } from "@/stores/use-config-store";

export function look(versionId = "daily", overrides: Partial<CharacterReferenceVersion> = {}): CharacterReferenceVersion {
    return { assetId: "hero", title: "苏卉", versionId, version: 1, definition: {}, updatedAt: "2026-11-02T00:00:00Z", visualStatus: "ready", voiceStatus: "missing",
        referenceProfile: { lookId: "daily", name: "白衣日常", description: "白衬衫", matchHints: "日常", excludeHints: "黑甲", enabled: true, preferred: true, default: true },
        representations: [{ id: "rep-" + versionId, resourceId: "image-" + versionId, role: "primary", mediaType: "image" }], ...overrides };
}

function shot(id = "shot-1", overrides: Partial<CharacterSelectionShot> = {}): CharacterSelectionShot {
    return { shotId: id, revisionId: "revision-" + id, position: 0, text: "苏卉穿着白衬衫推门进屋。", sceneAssetId: "room", assetIds: ["hero"], references: [], busy: false, ...overrides };
}
const response = (shotId = "shot-1", overrides = {}) => ({ shotId, assetId: "hero", versionId: "daily", status: "resolved", visible: true, reason: "原文明确白衬衫", evidence: "白衬衫", ...overrides });
const validate = (responses: ReturnType<typeof response>[], shots = [shot()], versions = [look()]) => validateCharacterSelections({ shots, versions, responses });

describe("character look selection", () => {
    test("prop alias collisions and scene declarations cannot break the character-only catalog", () => {
        const assets = [
            { id: "hero", title: "苏卉", category: "character", primaryVersionId: "daily" },
            { id: "phone-a", title: "苏卉的手机", category: "prop", primaryVersionId: "phone-a-v1", definitionJson: JSON.stringify({ aliases: ["手机"] }) },
            { id: "phone-b", title: "电话设备", category: "prop", primaryVersionId: "phone-b-v1", definitionJson: JSON.stringify({ aliases: ["手机"] }) },
        ] as ProjectAsset[];
        const workspace = {
            unit: { id: "unit", sourceText: "苏卉穿白衬衫拿起手机。" },
            shots: [{ id: "shot-1", position: 1, currentRevisionId: "rev-1" }],
            shotRevisions: [{ id: "rev-1", videoPrompt: "苏卉拿起手机。", actionBeatsJson: JSON.stringify([{ type: "asset_context", propNames: ["手机"], sceneAssetId: "missing-scene" }]) }],
            shotReferences: [], tasks: [],
        } as unknown as ProjectUnitWorkspace;
        expect(characterSelectionShots(workspace, assets)).toMatchObject([{ assetIds: ["hero"], visibleAssetIds: ["hero"], sceneAssetId: "missing-scene" }]);
        workspace.shotRevisions[0]!.actionBeatsJson = JSON.stringify([{ type: "asset_context", propNames: ["手机"] }]);
        expect(characterSelectionShots(workspace, assets)[0]?.assetIds).toEqual(["hero"]);
        workspace.shotRevisions[0]!.videoPrompt = "特写：手机在柜台上亮起。";
        expect(characterSelectionShots(workspace, assets)[0]?.assetIds).toEqual([]);
    });
    test("one default look stays one look after its first image and every missing alternate is scheduled", () => {
        const draft = look("draft", { representations: [], referenceProfile: { ...look().referenceProfile!, preferred: false, default: false } });
        const picture = look("picture", { version: 3, referenceProfile: draft.referenceProfile });
        const injured = look("injured", { version: 2, representations: [], referenceProfile: { ...draft.referenceProfile!, lookId: "injured", name: "三年前重伤造型" } });
        expect(characterLookDisplayVersions([draft, picture])).toHaveLength(1);
        expect(characterLookImageTargets([draft, picture, injured]).map((version) => version.versionId)).toEqual(["injured"]);
        expect(characterLookImageTargets([draft, injured]).map((version) => version.versionId)).toEqual(["draft", "injured"]);
        expect(characterLookImageTargets([draft, picture, injured], false).map((version) => version.versionId)).toEqual(["picture", "injured"]);
        injured.referenceProfile!.enabled = false;
        expect(characterLookImageTargets([draft, picture, injured]).map((version) => version.versionId)).toEqual(["injured"]);
    });
    test("compact look list hides empty history and groups redraws without hiding distinct unfinished looks", () => {
        const final = look("final", { version: 2 });
        const redraw = look("redraw", { version: 4, referenceProfile: { ...final.referenceProfile!, preferred: false, default: false } });
        const blank = look("blank", { version: 3, representations: [], referenceProfile: { ...final.referenceProfile!, preferred: false, default: false } });
        const unclassified = look("old", { referenceProfile: undefined, representations: [] });
        const unfinished = look("combat", { version: 5, representations: [], referenceProfile: { ...final.referenceProfile!, lookId: "combat", name: "战斗装", preferred: false, default: false } });
        expect(characterLookDisplayVersions([unclassified, blank, final, redraw, unfinished]).map((version) => version.versionId)).toEqual(["combat", "final"]);
        expect(characterLookDisplayVersions([unclassified, blank, final, redraw, unfinished], true)).toHaveLength(5);
        expect(characterLookDisplayVersions([unclassified, blank, final, redraw, unfinished], false, "redraw").map((version) => version.versionId)).toEqual(["combat", "redraw"]);
        expect(characterLookDisplayVersions([unclassified]).map((version) => version.versionId)).toEqual(["old"]);
    });
    test("unclassified history gets a draft group suggestion without becoming an automatic final", () => {
        const known = look("old", { definition: { clothing: "白衣", ageStage: "成年" } });
        const redraw = look("new", { referenceProfile: undefined, definition: known.definition });
        expect(characterLookDraft(redraw, [known])).toMatchObject({ lookId: "daily", preferred: false, default: false });
        expect(characterLookDraft({ ...redraw, definition: { clothing: "黑甲" } }, [known]).lookId).toBe("");
        expect(characterLookDraft(redraw, [{ ...known, assetId: "another-character" }]).lookId).toBe("");
    });
    test("uses only enabled reviewed look finals, never latest redraws or missing images", () => {
        expect(characterLookCandidates([look(), look("redraw", { version: 2, referenceProfile: { ...look().referenceProfile!, preferred: false } }), look("unclassified", { referenceProfile: undefined }), look("no-image", { representations: [] })]).map((v) => v.versionId)).toEqual(["daily"]);
    });
    test("selects a front image for closeups and excludes expression sheets", () => {
        const version = look("daily", { representations: [{ id: "expression", resourceId: "expression", mediaType: "image", role: "expression_sheet" }, ...look().representations, { id: "front", resourceId: "front", mediaType: "image", role: "front" }] });
        expect(characterReferenceImage(version, true)?.resourceId).toBe("front");
    });
    test("accepts real candidate and literal shot evidence", () => { expect(validate([response()])[0]?.status).toBe("resolved"); });
    test("rejects fabricated IDs, duplicate results, absent evidence, excluded looks and transformations", () => {
        for (const responses of [[response("shot-1", { versionId: "foreign" })], [response(), response()], [response("shot-1", { evidence: "从目录复制的描述" })], [response("shot-1", { visible: false })], [response("shot-1", { changeWithinShot: true })], []]) expect(validate(responses)[0]?.status).toBe("pending");
        expect(validate([response()], [shot("shot-1", { text: "苏卉穿着白衬衫并套上黑甲" })])[0]?.status).toBe("pending");
    });
    test("same-scene continuity requires a previous resolved exact version", () => {
        const shots = [shot(), shot("shot-2", { position: 1, text: "她走向窗边。" })];
        const results = validate([response(), response("shot-2", { evidence: "", continuityFromShotId: "shot-1" })], shots);
        expect(results.map((choice) => choice.status)).toEqual(["resolved", "resolved"]);
        shots.splice(1, 0, shot("intermediate", { position: 0.5, assetIds: [], sceneChange: true, text: "闪回少年时期" }));
        expect(validate([response(), response("shot-2", { evidence: "", continuityFromShotId: "shot-1" })], shots).at(-1)?.status).toBe("pending");
    });
    test("skips locked and generating shots, only-pending includes stale automatic choices", () => {
        const ref = { id: "r", shotId: "shot-1", assetVersionId: "daily", role: "reference", status: "linked", selectionStatus: "resolved", selectionSource: "auto", selectionRevisionId: "old", selectionLocked: false, referencedVersion: { id: "daily", assetId: "hero", version: 1, representations: [] }, createdAt: "" } satisfies ShotAssetReference;
        expect(characterSelectionTargets([shot("shot-1", { references: [ref] })], undefined, true)).toHaveLength(1);
        expect(characterSelectionTargets([shot("shot-1", { references: [{ ...ref, selectionLocked: true }] }), shot("busy", { busy: true })])).toHaveLength(0);
    });
    test("strict JSON parser rejects prose and accepts fenced responses", () => {
        expect(parseCharacterSelectionResponse('```json\n{"choices":[]}\n```')).toEqual([]);
        expect(() => parseCharacterSelectionResponse("我认为是日常装")).toThrow();
    });
});

describe("offline character look orchestration", () => {
    function setup() {
        setActiveUserScope("character-look-test");
        const asset = { id: "hero", title: "苏卉", category: "character", primaryVersionId: "daily", character: look() } as unknown as ProjectAsset;
        const workspace = { unit: { id: "unit", sourceText: "苏卉穿着白衬衫。" }, shots: [{ id: "shot-1", position: 0, description: "苏卉穿着白衬衫推门进屋。", currentRevisionId: "revision-shot-1" }], shotRevisions: [], shotReferences: [], tasks: [] } as unknown as ProjectUnitWorkspace;
        const calls: unknown[] = [];
        const api = { getProjectUnitWorkspace: async () => workspace, listProjectAssets: async () => ({ assets: [asset] }), getCharacterReferenceCatalog: async () => ({ revision: 8, versions: [look()] }), runBackendGenerationTask: async (input: unknown) => { calls.push(input); return { text: JSON.stringify({ choices: [response()] }) }; }, saveCharacterReferenceChoices: async (...args: unknown[]) => { calls.push(args); return { saved: true }; } };
        return { calls, api: api as unknown as Parameters<typeof identifyProjectCharacterReferences>[1] };
    }
    test("saves validated choices at captured project/script revision and only invokes text model", async () => {
        const { calls, api } = setup();
        expect(await identifyProjectCharacterReferences({ projectId: "p", unitId: "unit", config: { textModel: "text-test" } as AiConfig }, api)).toMatchObject({ resolved: 1, pending: 0 });
        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({ mode: "text" });
        expect((calls[1] as unknown[])[2]).toMatchObject({ expectedRevision: 8, choices: [{ versionId: "daily", expectedShotRevisionId: "revision-shot-1" }] });
    });
    test("cancel after text completion preserves original binding", async () => {
        const { calls, api } = setup();
        const controller = new AbortController();
        api!.runBackendGenerationTask = (async () => { controller.abort(); return { text: JSON.stringify([response()]) }; }) as typeof api.runBackendGenerationTask;
        await expect(identifyProjectCharacterReferences({ projectId: "p", unitId: "unit", config: { textModel: "text-test" } as AiConfig, signal: controller.signal }, api)).rejects.toThrow();
        expect(calls).toHaveLength(0);
    });
    test("no look finals records pending without a model call", async () => {
        const { calls, api } = setup();
        api!.getCharacterReferenceCatalog = async () => ({ revision: 8, versions: [look("daily", { referenceProfile: undefined })] });
        expect(await identifyProjectCharacterReferences({ projectId: "p", unitId: "unit", config: {} as AiConfig }, api)).toMatchObject({ pending: 1 });
        expect(calls).toHaveLength(1);
    });
});

describe("manual missing cast creation", () => {
    const input = { projectId: "p", unitId: "unit", shotId: "shot-1", expectedShotRevisionId: "revision-shot-1", name: "陈尧", appearance: "青衣青年" };
    function setup() {
        setActiveUserScope("manual-missing-cast-test");
        const workspace = { unit: { id: "unit" }, shots: [{ id: "shot-1", unitId: "unit", position: 0, currentRevisionId: "revision-shot-1" }], shotRevisions: [], shotReferences: [], tasks: [] } as unknown as ProjectUnitWorkspace;
        const versions = [look()];
        const character = { asset: { id: "chen", category: "character", title: "陈尧", primaryVersionId: "chen-v1" } as ProjectAsset, character: look("chen-v1", { assetId: "chen", title: "陈尧", representations: [] }) };
        let revision = 8;
        const writes: Array<{ operation: string; data: unknown }> = [];
        const api = {
            getProjectUnitWorkspace: async () => workspace,
            getCharacterReferenceCatalog: async () => ({ revision, versions }),
            createProjectCharacter: async (_projectId: string, data: unknown) => { writes.push({ operation: "create", data }); revision++; versions.push(character.character); return character; },
            saveCharacterReferenceChoices: async (_projectId: string, _unitId: string, data: unknown) => { writes.push({ operation: "bind", data }); return { saved: true }; },
        };
        return { api: api as Parameters<typeof createAndBindProjectShotCharacter>[1], workspace, versions, writes };
    }
    test("creates once, then binds only the requested shot as manually locked pending at the new revision", async () => {
        const { api, writes } = setup();
        expect((await createAndBindProjectShotCharacter(input, api)).bindingError).toBeUndefined();
        expect(writes).toEqual([{ operation: "create", data: { name: "陈尧", definition: { appearance: "青衣青年" } } }, { operation: "bind", data: { expectedRevision: 9, choices: [expect.objectContaining({ shotId: "shot-1", assetId: "chen", versionId: "chen-v1", status: "pending", source: "manual", locked: true, expectedShotRevisionId: "revision-shot-1" })] } }]);
    });
    test("existing names and aliases never create duplicate characters", async () => {
        for (const version of [look("existing", { title: "陈尧" }), look("existing", { definition: { aliases: ["陈尧"] } })]) {
            const { api, versions, writes } = setup(); versions.push(version);
            await expect(createAndBindProjectShotCharacter(input, api)).rejects.toThrow("已有这个角色");
            expect(writes).toHaveLength(0);
        }
    });
    test("stale scripts and active tasks are rejected before creation", async () => {
        const stale = setup();
        await expect(createAndBindProjectShotCharacter({ ...input, expectedShotRevisionId: "old" }, stale.api)).rejects.toThrow("镜头已变化");
        expect(stale.writes).toHaveLength(0);
        const busy = setup();
        busy.workspace.tasks.push({ id: "active", status: "running", clientContext: { shotId: "shot-1" } } as ProjectUnitWorkspace["tasks"][number]);
        await expect(createAndBindProjectShotCharacter(input, busy.api)).rejects.toThrow("正在生成");
        expect(busy.writes).toHaveLength(0);
    });
    test("failed binding retains the created asset and explicitly explains how to recover without creating it again", async () => {
        const { api, writes } = setup();
        api!.saveCharacterReferenceChoices = async () => { throw new Error("镜头已变化"); };
        const result = await createAndBindProjectShotCharacter(input, api);
        expect(result.character.asset.id).toBe("chen");
        expect(result.bindingError).toContain("无需重复新增");
        expect(writes).toHaveLength(1);
        await expect(createAndBindProjectShotCharacter(input, api)).rejects.toThrow("已有这个角色");
        expect(writes).toHaveLength(1);
    });
    test("switching accounts after creation never binds the previous account's character", async () => {
        const { api, writes } = setup();
        const create = api!.createProjectCharacter;
        api!.createProjectCharacter = async (...args) => { const result = await create(...args); setActiveUserScope("another-account"); return result; };
        await expect(createAndBindProjectShotCharacter(input, api)).rejects.toThrow("账号已切换");
        expect(writes.map((item) => item.operation)).toEqual(["create"]);
    });
});
