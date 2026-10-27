import { expect, test } from "bun:test";

import { matchProjectShotAssets, matchProjectShotSequenceAssets } from "../src/lib/project-shot-asset-matching";
import type { ProjectAsset } from "../src/services/api/projects";

const assets = [
    { id: "yingzheng", title: "嬴政", category: "character", primaryVersionId: "emperor-v2", character: { definition: { aliases: ["秦始皇"] } } },
    { id: "zhaogao", title: "赵高", category: "character", primaryVersionId: "zhaogao-v1" },
    { id: "palace", title: "沙丘平台正殿", category: "environment", primaryVersionId: "palace-v1" },
    { id: "candle", title: "蜡烛", category: "prop", primaryVersionId: "candle-v1" },
    { id: "old-video", title: "嬴政", category: "material", primaryVersionId: "video-v1" },
] as ProjectAsset[];

test("matches current shot characters, scene and props while excluding generated output", () => {
    const matches = matchProjectShotAssets(assets, { plotDescription: "嬴政躺在沙丘平台正殿，蜡烛微微摇晃。", negativePrompt: "赵高，多余人物" });
    expect(matches.map((match) => match.asset.id)).toEqual(["yingzheng", "palace", "candle"]);
});

test("uses explicit asset IDs and preserves the selected historical character version", () => {
    const matches = matchProjectShotAssets(assets, { characters: [{ characterAssetId: "yingzheng", characterVersionId: "emperor-v1", characterName: "嬴政" }], plotDescription: "秦始皇" });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.assetVersionId).toBe("emperor-v1");
});

test("resolves declared character aliases and rejects ambiguous names", () => {
    expect(matchProjectShotAssets(assets, { characters: ["秦始皇"] }).map((match) => match.asset.id)).toEqual(["yingzheng"]);
    expect(() => matchProjectShotAssets([...assets, { ...assets[0]!, id: "duplicate", primaryVersionId: "other-v1" }], { characters: ["嬴政"] })).toThrow("重名");
});

test("project asset bindings preserve all references independently of video model limits", () => {
    const many = Array.from({ length: 61 }, (_, index) => ({ ...assets[0]!, id: `person-${index}`, title: `人物${index}`, primaryVersionId: `version-${index}`, character: undefined }));
    const script = { characters: many.map((asset) => asset.title) };
    expect(matchProjectShotAssets(many, script)).toHaveLength(61);
    expect(matchProjectShotSequenceAssets(many, [{ script }])[0]).toHaveLength(61);
});

test("inherits only the scene across consecutive shots, never props or off-screen dialogue", () => {
    const matches = matchProjectShotSequenceAssets(assets, [
        { script: { plotDescription: "嬴政在沙丘平台正殿，蜡烛摇曳。" } },
        { script: { plotDescription: "殿内，嬴政抬头。", dialogue: "赵高（画外音）：拿走蜡烛。", continuityNotes: "下一镜切至花园" } },
    ]);
    expect(matches[0]!.map((match) => match.asset.id)).toEqual(["yingzheng", "palace", "candle"]);
    expect(matches[1]!.map((match) => match.asset.id)).toEqual(["yingzheng", "palace"]);
});

test("explicit scene changes switch environments and unknown transitions stop inheritance", () => {
    const garden = { id: "garden", title: "花园", category: "environment", primaryVersionId: "garden-v1" } as ProjectAsset;
    const matches = matchProjectShotSequenceAssets([...assets, garden], [
        { script: { sceneAssetId: "palace", plotDescription: "嬴政坐下" } },
        { script: { sceneAssetId: "garden", sceneChange: true, plotDescription: "赵高等待" } },
        { script: { plotDescription: "赵高抬头" } },
        { script: { sceneChange: true, plotDescription: "转场：未知的密室" } },
        { script: { plotDescription: "黑暗中等待" } },
    ]);
    expect(matches.map((items) => items.filter((match) => match.asset.category === "environment").map((match) => match.asset.id))).toEqual([["palace"], ["garden"], ["garden"], [], []]);
});

test("scene declarations and visible prop lists take precedence over dialogue mentions", () => {
    expect(matchProjectShotAssets(assets, { sceneAssetId: "palace", propNames: [], plotDescription: "嬴政收起蜡烛", dialogue: "赵高：去花园。" }).map((match) => match.asset.id)).toEqual(["palace", "yingzheng"]);
    expect(() => matchProjectShotAssets(assets, { sceneAssetId: "not-in-project" })).toThrow("场景");
});

test("uses continuity notes to bind scenes and detect scene transitions", () => {
    expect(matchProjectShotAssets(assets, { continuityNotes: "本镜继续在沙丘平台正殿发生" }).map((match) => match.asset.id)).toEqual(["palace"]);
    const garden = { id: "garden", title: "花园", category: "environment", primaryVersionId: "garden-v1" } as ProjectAsset;
    const matches = matchProjectShotSequenceAssets([...assets, garden], [
        { script: { sceneAssetId: "palace" } },
        { script: { continuityNotes: "转场：花园，人物进入庭院" } },
    ]);
    expect(matches[1]!.filter((match) => match.asset.category === "environment").map((match) => match.asset.id)).toEqual(["garden"]);
});
