import { expect, test } from "bun:test";
import { projectCharacterAppearances } from "@/lib/project-asset-mentions";
import { matchProjectShotCharacters } from "@/lib/project-shot-asset-matching";
import { characterSelectionShots } from "@/lib/character-look-selection";
import { projectUnitShotAssetPlan } from "@/services/project-shot-assets";
import type { ProjectAsset, ProjectUnitWorkspace } from "@/services/api/projects";

const characters = [
    { name: "李建国", assetId: "husband", aliases: ["建国"] },
    { name: "张翠花", assetId: "wife", aliases: [] },
    { name: "周秀兰", assetId: "mother", aliases: ["李母"] },
    { name: "周小胖", assetId: "friend", aliases: [] },
];
const assets = characters.map((character) => ({ id: character.assetId, title: character.name, category: "character", primaryVersionId: `${character.assetId}-v1`, character: { definition: { name: character.name, aliases: character.aliases } } })) as unknown as ProjectAsset[];

const englishCharacters = [{ name: "Dante Locke", assetId: "dante" }, { name: "Cole Vance", assetId: "cole" }];
const englishAssets = englishCharacters.map((character) => ({ id: character.assetId, title: character.name, category: "character", primaryVersionId: `${character.assetId}-v1` })) as ProjectAsset[];

test("English full-name speakers and abbreviated blocking bind throughout the shot workflow", () => {
    const sourceText = 'Cole kneels on the left. Dante steps forward.\nDante Locke: "Three crystals. Your quota was five."\nCole Vance: "I carried two of your workers out."';
    const revision = { id: "english-rev", shotId: "s", action: "Cole半跪在左侧，Dante向前迈出一步。", dialogue: 'Dante Locke: "Three crystals."\nCole Vance: "The west shaft collapsed."' };
    const workspace = { unit: { id: "u", sourceText }, shots: [{ id: "s", unitId: "u", currentRevisionId: revision.id, position: 0 }], shotRevisions: [revision], shotReferences: [], tasks: [] } as unknown as ProjectUnitWorkspace;
    expect(projectCharacterAppearances(sourceText, englishCharacters).map((character) => character.assetId)).toEqual(["dante", "cole"]);
    expect(matchProjectShotCharacters(englishAssets, { ...revision, chapterSourceText: sourceText }).map(({ asset }) => asset.id)).toEqual(["dante", "cole"]);
    expect(characterSelectionShots(workspace, englishAssets)[0]!.assetIds).toEqual(["dante", "cole"]);
    expect(characterSelectionShots(workspace, englishAssets)[0]!.text).toContain(revision.dialogue);
    expect(projectUnitShotAssetPlan(workspace, englishAssets)[0]!.matches.map(({ asset }) => asset.id)).toEqual(["dante", "cole"]);
});

test("standalone English dialogue supplies its speaker but not names inside the spoken words", () => {
    expect(matchProjectShotCharacters(englishAssets, { dialogue: 'Dante Locke: "Cole Vance stands outside."', chapterSourceText: 'Dante Locke: "Cole Vance stands outside."' }).map(({ asset }) => asset.id)).toEqual(["dante"]);
    expect(projectCharacterAppearances('DANTE LOCKE: "Cole Vance kneels."', englishCharacters).map((character) => character.assetId)).toEqual(["dante"]);
});

test("English short names are unique whole words and cannot bind an ambiguous identity", () => {
    const cast = [...englishCharacters, { name: "Cole Reed", assetId: "other-cole" }];
    expect(projectCharacterAppearances("Cole站在门边。", cast)).toEqual([]);
    expect(projectCharacterAppearances("Vance站在门边。", cast).map((character) => character.assetId)).toEqual(["cole"]);
    expect(projectCharacterAppearances("Cole Vance站在门边。", cast).map((character) => character.assetId)).toEqual(["cole"]);
    expect(projectCharacterAppearances("Nicole stands by the door. Dantean stands outside.", englishCharacters)).toEqual([]);
});

test("English offscreen speakers, dialogue mentions and absent characters stay unbound", () => {
    for (const source of ['Cole (V.O.): "Dante stands outside."', 'Cole Vance (off-screen): "Dante stands outside."', 'Cole Vance (on the phone): "Dante stands outside."', 'Voiceover: Cole Vance stands outside.', 'Dante says: Cole Vance stands outside.', 'Dante says Cole Vance stands outside.', 'Dante mentioned Cole Vance kneeling outside.', 'Cole Vance is absent.', 'Cole Vance will arrive tomorrow.']) {
        expect(projectCharacterAppearances(source, englishCharacters).filter((character) => character.assetId === "cole")).toEqual([]);
    }
    expect(projectCharacterAppearances('Dante Locke says: "Cole Vance stands outside."', englishCharacters).map((character) => character.assetId)).toEqual(["dante"]);
});

test("a chapter using given names retains its pictured cast in matching, look selection and submission preparation", () => {
    const sourceText = "<p>翠花坐在桌左，秀兰站在桌后。建国接过碗，小胖站在院门旁。</p>";
    const workspace = { unit: { id: "u", sourceText }, shots: [{ id: "s", unitId: "u", currentRevisionId: "rev", position: 0 }], shotRevisions: [{ id: "rev", shotId: "s", videoPrompt: "起幅：翠花坐在桌左，秀兰站在桌后，建国接过碗。" }], shotReferences: [], tasks: [] } as unknown as ProjectUnitWorkspace;
    expect(projectCharacterAppearances(sourceText, characters).map((character) => character.assetId)).toEqual(["husband", "wife", "mother", "friend"]);
    expect(matchProjectShotCharacters(assets, { videoPrompt: workspace.shotRevisions[0]!.videoPrompt, chapterSourceText: sourceText }).map(({ asset }) => asset.id)).toEqual(["husband", "wife", "mother"]);
    expect(characterSelectionShots(workspace, assets)[0]!.assetIds).toEqual(["husband", "wife", "mother"]);
    expect(projectUnitShotAssetPlan(workspace, assets)[0]!.matches.map(({ asset }) => asset.id)).toEqual(["husband", "wife", "mother"]);
});

test("short names resolve explicit cast entries and compound surnames without creating new identities", () => {
    expect(matchProjectShotCharacters(assets, { characters: ["翠花", "秀兰"] }).map(({ asset }) => asset.id)).toEqual(["wife", "mother"]);
    const character = { name: "欧阳明月", assetId: "hero" };
    expect(projectCharacterAppearances("明月推开窗。", [character])).toEqual([character]);
});

test("ambiguous given names require the full name or an explicit identity", () => {
    const cast = [{ name: "张翠花", assetId: "first" }, { name: "李翠花", assetId: "second" }];
    expect(projectCharacterAppearances("翠花推开门。", cast)).toEqual([]);
    expect(projectCharacterAppearances("张翠花推开门。", cast)).toEqual([cast[0]!]);
    expect(projectCharacterAppearances("翠花推开门。", [...cast, { name: "翠花", assetId: "third" }])).toEqual([{ name: "翠花", assetId: "third" }]);
});

test("short-name speech, offscreen voices and longer identities preserve the appearance boundary", () => {
    for (const source of ["建国说：“翠花坐在桌旁，秀兰站在门外。”", "建国提到翠花站在门外。", "翠花（画外音）：秀兰站在门外。", "【角色参考】\n翠花：@[asset:wife]"]) {
        expect(projectCharacterAppearances(source, characters).filter((character) => character.assetId !== "husband")).toEqual([]);
    }
    const cast = [...characters, { name: "小胖姐夫", assetId: "brother", aliases: [] }];
    expect(projectCharacterAppearances("建国看向小胖姐夫，小胖姐夫点头。", cast).map((character) => character.assetId)).toEqual(["husband", "brother"]);
    expect(projectCharacterAppearances("<p>翠花：秀兰明天回来。</p><p>建国接过碗。</p>", characters).map((character) => character.assetId)).toEqual(["husband", "wife"]);
});

test("duplicate rows for the same asset do not make its given name ambiguous", () => {
    expect(projectCharacterAppearances("翠花坐在桌旁。", [...characters, characters[1]!]).map((character) => character.assetId)).toEqual(["wife", "wife"]);
});

test("silent staging and group blocking retain characters even without a conventional action verb", () => {
    for (const videoPrompt of [
        "整体设定：小胖立在建国左后侧，翠花立在建国右后侧。",
        "表演调度：小胖与翠花分立建国左右后侧。",
        "起幅：小胖张嘴欲抢先替建国辩解。",
        "光学与光影：小胖处于可用景深内。",
    ]) {
        expect(matchProjectShotCharacters(assets, { videoPrompt, chapterSourceText: "小胖点头，翠花坐下。" }).some(({ asset }) => asset.id === "friend")).toBe(true);
    }
});

test("excluding a character suppresses automatic rebinding while an explicit manual restoration remains visible", () => {
    const workspace = { unit: { id: "u", sourceText: "翠花坐在桌旁。" }, shots: [{ id: "s", unitId: "u", currentRevisionId: "rev", position: 0 }], shotRevisions: [{ id: "rev", shotId: "s", videoPrompt: "翠花坐在桌旁。" }], shotReferences: [{ id: "ref", shotId: "s", assetVersionId: "wife-v1", role: "reference", status: "excluded", asset: assets[1], selectionSource: "manual", selectionLocked: true }], tasks: [] } as unknown as ProjectUnitWorkspace;
    expect(projectUnitShotAssetPlan(workspace, assets)[0]!.matches).toEqual([]);
    expect(characterSelectionShots(workspace, assets)[0]!.assetIds).toEqual([]);
    workspace.shotReferences[0]!.status = "linked";
    expect(characterSelectionShots(workspace, assets)[0]!.assetIds).toEqual(["wife"]);
});
