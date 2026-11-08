import { expect, test } from "bun:test";
import { activeCharacterLookKeys, characterLookGroups, newCharacterLookDefinition } from "../src/lib/character-look-management";
import type { CharacterReferenceVersion } from "../src/services/api/project-character-references";
import type { GenerationTask } from "../src/services/api/task-center";

function version(id: string, index: number, lookId: string, pictured = true, confirmed = false): CharacterReferenceVersion {
    return { assetId: "hero", title: "王大牛", versionId: id, version: index, updatedAt: "2026-11-05", definition: { appearance: "黑发方脸", clothing: lookId, state: "旧伤", voiceTimbre: "浑厚" }, representations: pictured ? [{ id, resourceId: id, mediaType: "image", role: "primary", taskId: "", createdAt: "" }] : [], visualStatus: pictured ? "ready" : "missing", voiceStatus: "missing", referenceProfile: { lookId, name: lookId, description: lookId, enabled: true, preferred: confirmed, default: confirmed, matchHints: "", excludeHints: "" } };
}

test("redraws remain under one look and preserve the old confirmed image until review", () => {
    const base = version("base", 1, "日常", true, true);
    const combat = version("combat", 2, "战甲", true, true);
    const redraw = version("redraw", 3, "战甲");
    const groups = characterLookGroups([redraw, combat, base]);
    expect(groups).toHaveLength(2);
    expect(groups[1]?.current.versionId).toBe("combat");
    expect(groups[1]?.pending.map((item) => item.versionId)).toEqual(["redraw"]);
    expect(groups[1]?.history).toHaveLength(2);
    const reviewing = characterLookGroups([redraw, combat, base], "redraw")[1]!;
    expect(reviewing.current.versionId).toBe("redraw");
    expect(reviewing.confirmed?.versionId).toBe("combat");
    expect(characterLookGroups([redraw, combat, base])[1]?.current.versionId).toBe("combat");
});

test("empty old history stays out of the grid but independent missing looks remain", () => {
    const base = version("base", 1, "日常");
    const empty = version("old", 2, "旧记录", false);
    empty.referenceProfile = undefined;
    const missing = version("missing", 3, "雨衣", false);
    expect(characterLookGroups([base, empty, missing]).map((group) => group.current.versionId)).toEqual(["base", "missing"]);
});

test("a look task only locks its own history group and survives redacted input", () => {
    const versions = [version("base", 1, "日常"), version("combat", 2, "战甲"), version("redraw", 3, "战甲")];
    const task = { status: "running", clientContext: { nodeId: "character-turnaround:hero", characterVersionId: "combat" }, inputJson: "" } as GenerationTask;
    expect([...activeCharacterLookKeys([task], versions)]).toEqual(["hero:战甲"]);
    expect([...activeCharacterLookKeys([{ ...task, status: "failed" }], versions)]).toEqual([]);
    expect([...activeCharacterLookKeys([{ ...task, clientContext: { nodeId: "character-turnaround:hero" }, inputJson: '{"metadata":{"characterVersionId":"base"}}' }], versions)]).toEqual(["hero:日常"]);
});

test("legacy tasks with unknown versions block only their owning character", () => {
    const versions = [version("base", 1, "日常"), { ...version("other", 2, "日常"), assetId: "other" }];
    const task = { status: "queued", clientContext: { nodeId: "character-turnaround:hero" }, inputJson: "invalid" } as GenerationTask;
    expect([...activeCharacterLookKeys([task], versions)]).toEqual(["hero:日常"]);
});

test("new look inherits identity and voice but uses explicit new clothing instead of old wounds", () => {
    const base = version("base", 1, "白衣");
    const definition = newCharacterLookDefinition(base, "战甲沾雨", { hairstyle: "束发" });
    expect(definition).toMatchObject({ appearance: "黑发方脸", voiceTimbre: "浑厚", clothing: "战甲沾雨", state: "", hairstyle: "束发" });
    expect(base.definition.clothing).toBe("白衣");
});
