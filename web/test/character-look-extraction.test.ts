import { expect, test } from "bun:test";
import { parseCharacterBreakdown } from "@/lib/canvas/canvas-character-reference";
import { characterTurnaroundVariables } from "@/lib/character-reference-generation";
import { missingCharacterLookImages } from "@/lib/character-look-selection";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";

const character = { name: "云舒", aliases: [], role: "女主", appearance: "黑发", clothing: "黑裙", physique: "纤细", personality: "安静", props: "", consistencyPrompt: "同一身份", multiViewPrompt: "三视图", voiceLanguage: "中文", voiceAge: "青年", voiceTimbre: "轻柔" };
test("preserves all structured looks through chapter parsing and confirmation payload", () => {
    const looks = [{ name: "居家02", clothing: "黑色睡裙", matchHints: "视频电话", changeReason:"白衣换黑裙", sourceEvidence:"她换上黑色睡裙" }, { name: "居家01", clothing: "粉色睡衣", matchHints: "下楼" }, { name: "前置01", clothing: "白衣灰裤" }];
    expect(parseCharacterBreakdown(JSON.stringify({ characters: [{ ...character, looks }] }))[0]?.looks).toEqual(looks);
});
test("rejects malformed looks instead of silently dropping outfits", () => {
    for (const looks of [[], [{name: "居家"}], [{name: "重复", clothing: "黑裙"}, {name: "重复", clothing: "白裙"}]]) expect(() => parseCharacterBreakdown(JSON.stringify({characters: [{...character, looks}]}))).toThrow();
});
test("requires splitting mixed outfits before generating a single reference", () => {
    expect(() => characterTurnaroundVariables("云舒", {...character, clothing: "造型1（居家）：黑裙；造型2（出门）：白衣"})).toThrow("拆分");
    expect(() => characterTurnaroundVariables("云舒", {...character, looks: [{name: "居家", clothing: "黑裙"}, {name: "出门", clothing: "白衣"}]})).toThrow("拆分");
});
test("plans one missing picture per independent look and skips completed groups", () => {
    const version = (versionId: string, lookId: string, version: number, image = false) => ({assetId: "hero", versionId, version, definition: {clothing: lookId}, representations: image ? [{resourceId: "img", mediaType: "image", role: "primary"}] : [], referenceProfile: {lookId, name: lookId, enabled: true}} as CharacterReferenceVersion);
    expect(missingCharacterLookImages([version("daily-old", "daily", 1), version("daily", "daily", 2), version("evening", "evening", 3), version("evening-pic", "evening", 4, true), version("combat", "combat", 5)]).map((v) => v.versionId)).toEqual(["daily", "combat"]);
});
