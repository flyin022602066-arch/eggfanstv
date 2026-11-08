import { expect, test } from "bun:test";

import { matchProjectShotAssets, matchProjectShotSequenceAssets, missingProjectShotAssets } from "../src/lib/project-shot-asset-matching";
import type { ProjectAsset } from "../src/services/api/projects";

const assets = [
    { id: "yingzheng", title: "嬴政", category: "character", primaryVersionId: "emperor-v2", character: { definition: { aliases: ["秦始皇"] } } },
    { id: "zhaogao", title: "赵高", category: "character", primaryVersionId: "zhaogao-v1" },
    { id: "palace", title: "沙丘平台正殿", category: "environment", primaryVersionId: "palace-v1" },
    { id: "candle", title: "蜡烛", category: "prop", primaryVersionId: "candle-v1" },
    { id: "old-video", title: "嬴政", category: "material", primaryVersionId: "video-v1" },
] as ProjectAsset[];

test("exact prop names win over another prop's generic alias", () => {
    const catalog = [
        { id: "phone", title: "手机", category: "prop", primaryVersionId: "phone-v1" },
        { id: "telephone", title: "电话设备", category: "prop", primaryVersionId: "telephone-v1", definitionJson: JSON.stringify({ aliases: ["手机"] }) },
    ] as ProjectAsset[];
    expect(matchProjectShotAssets(catalog, { propNames: ["手机"] }).map(({ asset }) => asset.id)).toEqual(["phone"]);
    expect(matchProjectShotAssets(catalog, { propNames: ["手机"], assetBindings: [{ nodeId: "telephone", selectionSource: "manual" }] }).map(({ asset }) => asset.id)).toEqual(["telephone"]);
});

test("explicitly bound prop IDs resolve shared aliases without choosing an unrelated asset", () => {
    const catalog = [
        { id: "phone-a", title: "云舒的手机", category: "prop", primaryVersionId: "phone-a-v1", definitionJson: JSON.stringify({ aliases: ["手机"] }) },
        { id: "phone-b", title: "周行旻的电话设备", category: "prop", primaryVersionId: "phone-b-v1", definitionJson: JSON.stringify({ aliases: ["手机"] }) },
    ] as ProjectAsset[];
    const script = { propNames: ["手机"], assetBindings: [{ nodeId: "phone-b", selectionSource: "manual" as const }] };
    expect(matchProjectShotAssets(catalog, script).map(({ asset }) => asset.id)).toEqual(["phone-b"]);
    expect(matchProjectShotSequenceAssets(catalog, [{ script: { propNames: ["手机"] }, existing: [{ asset: catalog[1]!, assetVersionId: "phone-b-v1" }] }])[0]?.map(({ asset }) => asset.id)).toEqual(["phone-b"]);
    expect(() => matchProjectShotAssets(catalog, { propNames: ["手机"] })).toThrow("同名资产");
});

test("uses a verified material definition to repair a stale token before binding", () => {
    const matches = matchProjectShotAssets(assets, { propNames: [], videoPrompt: "将@[asset:wrong-candle]定义为<蜡烛>。\n镜头1：火焰摇曳。" });
    expect(matches.map((match) => match.asset.id)).toEqual(["candle"]);
});

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

test("review collects duplicate asset choices without guessing and applies only the confirmed identity", () => {
    const catalog = [...assets, { ...assets[0]!, id: "duplicate", primaryVersionId: "other-v1" }];
    const issues: Array<{ key: string; name: string; assets: ProjectAsset[] }> = [];
    const script = { characters: ["嬴政"], plotDescription: "嬴政抬头。" };
    const unresolved = matchProjectShotAssets(catalog, script, { onAmbiguousAsset: (issue) => issues.push(issue) });
    expect(unresolved).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.assets.map((asset) => asset.id)).toEqual(["yingzheng", "duplicate"]);
    expect(matchProjectShotAssets(catalog, script, { assetSelections: { [issues[0]!.key]: "duplicate" } }).map((match) => match.assetVersionId)).toEqual(["other-v1"]);
    expect(() => matchProjectShotAssets(catalog, script, { assetSelections: { [issues[0]!.key]: "zhaogao" } })).toThrow("重名");
});

test("review resolves inferred duplicate props and explicitly named scenes without changing default strictness", () => {
    for (const [original, script] of [
        [assets[3]!, { videoPrompt: "蜡烛的火焰摇曳。" }],
        [assets[2]!, { sceneName: "沙丘平台正殿" }],
    ] as const) {
        const catalog = [original, { ...original, id: "second", primaryVersionId: "second-v1" }];
        const issues: Array<{ key: string; name: string; assets: ProjectAsset[] }> = [];
        expect(matchProjectShotAssets(catalog, script, { onAmbiguousAsset: (issue) => issues.push(issue) })).toEqual([]);
        expect(issues.length).toBeGreaterThan(0);
        expect(matchProjectShotAssets(catalog, script, { assetSelections: { [issues[0]!.key]: "second" } }).map((match) => match.assetVersionId)).toEqual(["second-v1"]);
        expect(() => matchProjectShotAssets(catalog, script)).toThrow("重名");
    }
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

test("matches a uniquely named classroom with a class qualifier without binding its exterior", () => {
    const classroom = { id: "classroom", title: "文化楼教室", category: "environment", primaryVersionId: "classroom-v1" } as ProjectAsset;
    expect(matchProjectShotAssets([classroom], { sceneName: "文化楼核心班教室" }).map((match) => match.asset.id)).toEqual(["classroom"]);
    expect(matchProjectShotAssets([classroom], { sceneName: "基地通道与文化楼台阶下" })).toEqual([]);
    expect(() => matchProjectShotAssets([classroom, { ...classroom, id: "other-classroom", title: "文化楼普通班教室" }], { sceneName: "文化楼核心班教室" })).toThrow("重名");
});

test("compound scene names bind each known location and report only the absent location", () => {
    const clinic = { id: "clinic", title: "医务楼诊室", category: "environment", primaryVersionId: "clinic-v1" } as ProjectAsset;
    const script = { sceneName: "监控室与医务楼诊室", propNames: ["蜡烛", "书包", "书包"] };
    expect(matchProjectShotAssets([...assets, clinic], script).map((match) => match.asset.id)).toEqual(["clinic", "candle"]);
    expect(missingProjectShotAssets([...assets, clinic], script)).toEqual([
        { category: "environment", name: "监控室" },
        { category: "prop", name: "书包" },
    ]);
});

test("a known compound location is preserved within a multi-location sequence", () => {
    const catalog = [
        { id: "classroom", title: "少年班教室", category: "environment", primaryVersionId: "classroom-v1" },
        { id: "corridor", title: "文化楼走廊", category: "environment", primaryVersionId: "corridor-v1" },
        { id: "combined", title: "文化楼走廊与连廊", category: "environment", primaryVersionId: "combined-v1" },
    ] as ProjectAsset[];
    const script = { sceneAssetId: "classroom", sceneName: "少年班教室、文化楼走廊与连廊" };
    expect(matchProjectShotAssets(catalog, script).map((match) => match.asset.id)).toEqual(["classroom", "combined"]);
    expect(missingProjectShotAssets(catalog, script)).toEqual([]);
});

test("asset gaps honor aliases and never invent props from dialogue or negative prompts", () => {
    const book = { id: "book", title: "线装古籍", category: "prop", primaryVersionId: "book-v1", definitionJson: JSON.stringify({ aliases: ["旧书"] }) } as ProjectAsset;
    expect(missingProjectShotAssets([book], { propNames: ["旧书"], dialogue: "拿来茶杯。", negativePrompt: "手枪" })).toEqual([]);
});

test("compound locations supplement a pinned scene while following its regenerated primary version", () => {
    const clinic = { id: "clinic", title: "医务楼诊室", category: "environment", primaryVersionId: "clinic-v2" } as ProjectAsset;
    const monitor = { id: "monitor", title: "监控室", category: "environment", primaryVersionId: "monitor-v1" } as ProjectAsset;
    const script = { sceneAssetId: "clinic", sceneName: "监控室与医务楼诊室" };
    const [matches] = matchProjectShotSequenceAssets([clinic, monitor], [{ script, existing: [{ asset: clinic, assetVersionId: "clinic-v1" }] }]);
    expect(matches!.map((match) => [match.asset.id, match.assetVersionId])).toEqual([["clinic", "clinic-v2"], ["monitor", "monitor-v1"]]);
    expect(missingProjectShotAssets([clinic], script)).toEqual([{ category: "environment", name: "监控室" }]);
});

test("a manually selected single scene remains authoritative over the old label", () => {
    const script = { sceneAssetId: "palace", sceneName: "旧宫殿名" };
    expect(missingProjectShotAssets(assets, script)).toEqual([]);
    expect(matchProjectShotAssets(assets, script).map((match) => match.asset.id)).toEqual(["palace"]);
});

test("spoken references in visual prompts do not bind the mentioned character", () => {
    for (const speech of [
        "嬴政抬手说：‘赵高明日回来。’",
        "嬴政低声说道：\"赵高明日回来。\"",
        "嬴政：赵高明日回来。",
        "声音：嬴政：赵高明日回来。",
        "对白：嬴政说赵高明日回来。",
    ]) {
        const matches = matchProjectShotAssets(assets, { plotDescription: "嬴政独坐。", videoPrompt: speech });
        expect(matches.map((match) => match.asset.id)).toEqual(["yingzheng"]);
    }
});

test("visible actions survive a dialogue clause and a simultaneous offscreen voice", () => {
    for (const prompt of [
        "嬴政说：‘赵高明日回来。’赵高推门进入。",
        "起幅：嬴政抬头。声音：赵高（画外音）：陛下。→ 落幅：嬴政走到窗边。",
    ]) {
        const matches = matchProjectShotAssets(assets, { videoPrompt: prompt });
        expect(matches.map((match) => match.asset.id)).toEqual(prompt.includes("推门进入") ? ["yingzheng", "zhaogao"] : ["yingzheng"]);
    }
});

test("explicit empty cast prevents inferred visual characters while preserving manual bindings", () => {
    expect(matchProjectShotAssets(assets, { characters: [], videoPrompt: "对白：赵高谈起嬴政。" })).toEqual([]);
    expect(matchProjectShotAssets(assets, { characters: [], assetBindings: [{ nodeId: "yingzheng", selectionSource: "manual" }], videoPrompt: "声音：赵高。" }).map((match) => match.asset.id)).toEqual(["yingzheng"]);
});

test("explicit visual recollections and portraits are not mistaken for spoken references", () => {
    for (const prompt of ["回忆画面：赵高站在门边。", "特写：照片上的‘赵高’面容清晰。"]) {
        expect(matchProjectShotAssets(assets, { videoPrompt: prompt }).map((match) => match.asset.id)).toEqual(["zhaogao"]);
    }
});

test("cast IDs and asset tokens cannot promote dialogue mentions or reference declarations into appearances", () => {
    for (const input of [
        { assetBindings: [{ nodeId: "zhaogao" }] },
        { characters: ["嬴政", "赵高"], plotDescription: "嬴政独坐，说赵高明天回来。" },
        { characters: [{ characterAssetId: "zhaogao", characterName: "赵高" }], plotDescription: "空荡的正殿，无人出镜。" },
        { plotDescription: "嬴政独坐。", videoPrompt: "将@[asset:zhaogao]定义为<赵高>。\n声音：嬴政：@[asset:zhaogao]明天回来。" },
        { plotDescription: "嬴政独坐。", continuityNotes: "下一章赵高出现，角色保持一致。" },
    ]) {
        expect(matchProjectShotAssets(assets, input).some((match) => match.asset.id === "zhaogao")).toBe(false);
    }
});

test("visible speakers survive dialogue filtering without rebinding the person they mention", () => {
    for (const videoPrompt of [
        "嬴政：赵高明日才回来。",
        "嬴政说赵高明日才回来。",
        "‘赵高明日才回来。’嬴政说道。",
        "画面：@[asset:yingzheng]抬头。声音：@[asset:zhaogao]（画外音）：陛下。",
    ]) expect(matchProjectShotAssets(assets, { videoPrompt }).map((match) => match.asset.id)).toEqual(["yingzheng"]);
});

test("offscreen and future characters need positive action evidence before auto binding", () => {
    for (const videoPrompt of ["赵高（画外音）：陛下。", "画外音赵高：陛下。", "嬴政想起赵高。", "嬴政独坐，赵高未在场。", "嬴政独坐，明天赵高才会回来。"]) {
        expect(matchProjectShotAssets(assets, { videoPrompt }).some((match) => match.asset.id === "zhaogao")).toBe(false);
    }
    expect(matchProjectShotAssets(assets, { characters: ["嬴政", "赵高"], videoPrompt: "嬴政说赵高不在。赵高随后推门进入。" }).map((match) => match.asset.id)).toEqual(["yingzheng", "zhaogao"]);
});

test("existing automatic references are not appearance evidence while manual bindings remain pinned", () => {
    const absent = assets.find((asset) => asset.id === "zhaogao")!;
    const [automatic, manual] = matchProjectShotSequenceAssets(assets, [
        { script: { plotDescription: "嬴政独坐。" }, existing: [{ asset: absent, assetVersionId: "zhaogao-v1", selectionSource: "auto" }] },
        { script: { plotDescription: "嬴政独坐。" }, existing: [{ asset: absent, assetVersionId: "zhaogao-v1", selectionSource: "manual" }] },
    ]);
    expect(automatic!.map((match) => match.asset.id)).toEqual(["yingzheng"]);
    expect(manual!.map((match) => match.asset.id)).toEqual(["yingzheng", "zhaogao"]);
});

test("generated asset bindings and tokens cannot bypass chapter or shot appearance checks", () => {
    for (const input of [
        { plotDescription: "嬴政独坐。", assetBindings: [{ nodeId: "zhaogao" }] },
        { plotDescription: "嬴政独坐。", assetBindings: [{ nodeId: "zhaogao", selectionSource: "auto" as const }] },
        { chapterSourceText: "嬴政独坐。", plotDescription: "赵高推门进入。", assetBindings: [{ nodeId: "zhaogao" }] },
        { chapterSourceText: "嬴政独坐。", plotDescription: "@[asset:zhaogao]推门进入。" },
        { chapterSourceText: "嬴政独坐。", characters: ["赵高"] },
    ]) expect(matchProjectShotAssets(assets, input).some(({ asset }) => asset.id === "zhaogao")).toBe(false);
    for (const binding of [{ nodeId: "zhaogao", selectionSource: "manual" as const }, { nodeId: "zhaogao", selectionLocked: true }]) {
        expect(matchProjectShotAssets(assets, { plotDescription: "嬴政独坐。", assetBindings: [binding] }).some(({ asset }) => asset.id === "zhaogao")).toBe(true);
    }
});
