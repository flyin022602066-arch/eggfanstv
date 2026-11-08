import { expect, test } from "bun:test";
import { parseCharacterBreakdown } from "@/lib/canvas/canvas-character-reference";

const card = (name: string, aliases: string[]) => ({ name, aliases, role: "在密室与徒弟交谈", appearance: "白发", clothing: "深色常服", physique: "硬朗", personality: "关切", consistencyPrompt: "保持本人五官", multiViewPrompt: "头部特写与三视图", voiceLanguage: "中文", voiceAge: "老年", voiceTimbre: "浑厚" });

test("shared membership labels cannot merge separate named masters", () => {
    const names = ["大师傅", "二师傅", "三师傅"];
    const result = parseCharacterBreakdown(JSON.stringify({ characters: names.map((name) => card(name, ["九浮屠之一"])) }));
    expect(result.map((character) => character.name)).toEqual(names);
    expect(result.map((character) => character.aliases)).toEqual([[], [], []]);
});

test("exclusive alternate names still deduplicate the same identity", () => {
    const result = parseCharacterBreakdown(JSON.stringify({ characters: [card("王大牛", ["王犟"]), card("王犟", ["王大牛"])] }));
    expect(result.map((character) => character.name)).toEqual(["王大牛"]);
    expect(result[0]!.aliases).toEqual(["王犟"]);
});
