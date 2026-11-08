import { expect, test } from "bun:test";
import { characterSelectionShots, characterSelectionTargets } from "@/lib/character-look-selection";
import { identifyProjectCharacterReferences } from "@/services/project-character-references";
import type { ProjectAsset, ProjectUnitWorkspace, ShotAssetReference } from "@/services/api/projects";
import type { AiConfig } from "@/stores/use-config-store";

test("group cast declarations and collective actions retain the actual pictured character", () => {
    const group = { id: "masters", title: "其余六位师傅", category: "character", primaryVersionId: "masters-v2", character: { definition: { name: "其余六位师傅", aliases: ["九位师傅", "九浮屠", "其余师傅"] } } } as unknown as ProjectAsset;
    const workspace = { unit: { id: "u", sourceText: "<p>人物：韩枫 九位师傅（大师傅、二师傅、三师傅等）</p><p>▲众师傅纷纷伸长舌头。</p>" }, shots: [{ id: "s", unitId: "u", position: 0, currentRevisionId: "rev" }], shotRevisions: [{ id: "rev", shotId: "s", version: 1, videoPrompt: "将@[asset:masters]定义为<其余六位师傅>。\n镜头1：大师傅站在桌右，身后的其余师傅也随之安静垂手。" }], shotReferences: [], tasks: [] } as unknown as ProjectUnitWorkspace;
    const shots = characterSelectionShots(workspace, [group]);
    expect(shots[0]!.assetIds).toEqual(["masters"]);
    expect(characterSelectionTargets(shots).map(({ assetId }) => assetId)).toEqual(["masters"]);
});

test("the saved character definition name remains a matching identity after a card rename", () => {
    const group = { id: "masters", title: "其余师傅", category: "character", primaryVersionId: "masters-v2", character: { definition: { name: "其余六位师傅", aliases: ["九位师傅"] } } } as unknown as ProjectAsset;
    const workspace = { unit: { id: "u", sourceText: "人物：九位师傅\n九位师傅站在桌边。" }, shots: [{ id: "s", unitId: "u", position: 0, description: "其余六位师傅站在桌边。" }], shotRevisions: [], shotReferences: [], tasks: [] } as unknown as ProjectUnitWorkspace;
    expect(characterSelectionShots(workspace, [group])[0]!.assetIds).toEqual(["masters"]);
});

test("group staging retains masters surrounding the visible scene without adding dialogue mentions", () => {
    const group = { id: "masters", title: "其余六位师傅", category: "character", primaryVersionId: "masters-v2", character: { definition: { aliases: ["九位师傅"] } } } as unknown as ProjectAsset;
    const workspace = { unit: { id: "u", sourceText: "人物：九位师傅（大师傅、二师傅、三师傅等）" }, shots: [{ id: "s", unitId: "u", position: 0, description: "大师傅与其余师傅呈半弧形围站在桌右侧。" }], shotRevisions: [], shotReferences: [], tasks: [] } as unknown as ProjectUnitWorkspace;
    expect(characterSelectionShots(workspace, [group])[0]!.assetIds).toEqual(["masters"]);
    workspace.shots[0]!.description = "大师傅说：“其余师傅呈半弧形围站在桌右侧。”";
    expect(characterSelectionShots(workspace, [group])[0]!.assetIds).toEqual([]);
});

test("speaking stage directions do not swallow a visible group later in the same sentence", () => {
    const group = { id: "masters", title: "其余师傅", category: "character", primaryVersionId: "masters-v2", character: { definition: { aliases: ["九位师傅"] } } } as unknown as ProjectAsset;
    const videoPrompt = "镜头1：过程：大师傅一字一句沉稳地对着韩枫说出前半段话，身后的其余师傅也随之安静垂手。→ 落幅：大师傅凝视韩枫。声音：大师傅：“我们九浮屠的本事，你已经青出于蓝。”";
    const workspace = { unit: { id: "u", sourceText: "人物：韩枫 九位师傅（大师傅、二师傅、三师傅等）" }, shots: [{ id: "s", unitId: "u", position: 0, currentRevisionId: "rev" }], shotRevisions: [{ id: "rev", shotId: "s", videoPrompt }], shotReferences: [], tasks: [] } as unknown as ProjectUnitWorkspace;
    expect(characterSelectionShots(workspace, [group])[0]!.assetIds).toEqual(["masters"]);
});

for (const selectionSource of ["auto", "rule"] as const) {
    for (const appearance of ["穿白衣", "戴白帽", "披斗篷", "背书包"]) {
        test(`look selection retains visible existing bindings with basic appearance verbs (${selectionSource}, ${appearance})`, () => {
            const present = { id: "present", title: "苏卉", category: "character", primaryVersionId: "present-v1" } as ProjectAsset;
            const reference = { id: "r", shotId: "s", assetVersionId: "present-v1", role: "reference", status: "linked", selectionSource, asset: present } as ShotAssetReference;
            const workspace = { unit: { id: "u", sourceText: `苏卉${appearance}。` }, shots: [{ id: "s", unitId: "u", position: 0, currentRevisionId: "rev", description: `苏卉${appearance}。` }], shotRevisions: [], shotReferences: [reference], tasks: [] } as unknown as ProjectUnitWorkspace;
            const shots = characterSelectionShots(workspace, [present]);
            expect(shots[0]!.assetIds).toEqual(["present"]);
            expect(shots[0]!.references).toEqual([reference]);
            expect(characterSelectionTargets(shots).map(({ assetId }) => assetId)).toEqual(["present"]);
        });
    }
}

for (const [sourceText, title] of [["苏卉一怔。", "苏卉"], ["陈默道：我来了。", "陈默"], ["林夏睫毛轻颤。", "林夏"]]) {
    test(`look selection keeps natural source appearances instead of dropping existing refs: ${sourceText}`, () => {
        const present = { id: "present", title: title!, category: "character", primaryVersionId: "present-v1" } as ProjectAsset;
        const reference = { id: "r", shotId: "s", assetVersionId: "present-v1", role: "reference", status: "linked", selectionSource: "auto", asset: present } as ShotAssetReference;
        const workspace = { unit: { id: "u", sourceText }, shots: [{ id: "s", unitId: "u", position: 0, currentRevisionId: "rev", description: sourceText }], shotRevisions: [], shotReferences: [reference], tasks: [] } as unknown as ProjectUnitWorkspace;
        const shots = characterSelectionShots(workspace, [present]);
        expect(shots[0]!.assetIds).toEqual(["present"]);
        expect(shots[0]!.references).toEqual([reference]);
        expect(characterSelectionTargets(shots).map(({ assetId }) => assetId)).toEqual(["present"]);
    });
}

for (const selectionSource of ["auto", "rule", "manual"] as const) {
    for (const selectionLocked of [false, true]) {
        test(`look selection filters unsupported cast but preserves pins (${selectionSource}, ${selectionLocked})`, () => {
            const present = { id: "present", title: "林夏", category: "character", primaryVersionId: "present-v1" } as ProjectAsset;
            const phantom = { id: "phantom", title: "潇潇", category: "character", primaryVersionId: "phantom-v1" } as ProjectAsset;
            const reference = { id: "r", shotId: "s", assetVersionId: "phantom-v1", role: "reference", status: "linked", selectionSource, selectionLocked, asset: phantom } as ShotAssetReference;
            const workspace = { unit: { id: "u", sourceText: "林夏独坐。" }, shots: [{ id: "foreign", unitId: "foreign-unit", position: -1, description: "潇潇推门进入。" }, { id: "s", unitId: "u", position: 0, currentRevisionId: "rev", description: "林夏独坐。" }], shotRevisions: [{ id: "rev", shotId: "s", version: 1, plotDescription: "林夏独坐。潇潇推门进入。", videoPrompt: "【资产参考】\n- 潇潇：人物参考：图片1" }], shotReferences: [reference], tasks: [] } as unknown as ProjectUnitWorkspace;
            const shots = characterSelectionShots(workspace, [present, phantom]);
            expect(shots.map((shot) => shot.shotId)).toEqual(["s"]);
            const preserved = selectionSource === "manual" || selectionLocked;
            expect(shots[0]!.assetIds).toEqual(preserved ? ["present", "phantom"] : ["present"]);
            expect(shots[0]!.references).toHaveLength(preserved ? 1 : 0);
            expect(characterSelectionTargets(shots).map(({ assetId }) => assetId)).toEqual(["present"]);
            expect(workspace.shotReferences).toEqual([reference]);
        });
    }
}

for (const shotId of [undefined, "s"]) {
    test(`identify ${shotId ? "shot" : "chapter"} does not invoke model or save a phantom-only cast`, async () => {
        const phantom = { id: "phantom", title: "潇潇", category: "character", primaryVersionId: "phantom-v1" } as ProjectAsset;
        const workspace = { unit: { id: "u", sourceText: "林夏独坐。" }, shots: [{ id: "s", unitId: "u", position: 0, description: "潇潇推门进入。" }], shotRevisions: [], shotReferences: [{ id: "r", shotId: "s", asset: phantom, assetVersionId: "phantom-v1", status: "linked", role: "reference", selectionSource: "auto" }], tasks: [] } as unknown as ProjectUnitWorkspace;
        const api = { getProjectUnitWorkspace: async () => workspace, listProjectAssets: async () => ({ assets: [phantom] }), getCharacterReferenceCatalog: async () => ({ revision: 1, versions: [] }), runBackendGenerationTask: async () => { throw new Error("must not call model"); }, saveCharacterReferenceChoices: async () => { throw new Error("must not save phantom choices"); } } as unknown as Parameters<typeof identifyProjectCharacterReferences>[1];
        expect(await identifyProjectCharacterReferences({ projectId: "p", unitId: "u", shotId, config: {} as AiConfig }, api)).toMatchObject({ resolved: 0, pending: 0 });
    });
}
