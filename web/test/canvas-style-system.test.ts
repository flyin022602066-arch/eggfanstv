import { expect, test } from "bun:test";

import {
    compileCanvasStylePreset,
    compatibleProjectStyleCharacters,
    customCanvasStylePreset,
    normalizeProjectStyleSelection,
    parseCanvasStyleSelection,
    projectStyleMedia,
    projectStyleTones,
    projectStyleWorlds,
    recommendedCanvasStylePresets,
} from "../src/lib/canvas/canvas-style-system";
import { applyStyleExecutionPlan, parseStyleProfile, resolveStyleExecutionPlan, serializeStyleProfile, styleProfileValidationMessage } from "../src/lib/canvas/style-profile";

test("every supported topic, tone and medium compiles a consistent restorable project snapshot", () => {
    const ids = new Set<string>();
    for (const world of projectStyleWorlds) {
        for (const tone of projectStyleTones) {
            for (const medium of projectStyleMedia) {
                for (const character of compatibleProjectStyleCharacters(medium.id)) {
                    const selection = { world: world.id, tone: tone.id, medium: medium.id, character: character.id };
                    const preset = compileCanvasStylePreset(selection);
                    expect(ids.has(preset.id)).toBe(false);
                    ids.add(preset.id);
                    expect(parseCanvasStyleSelection(preset.id)).toEqual(selection);
                    expect(customCanvasStylePreset(preset.id)?.prompt).toBe(preset.prompt);
                    expect(styleProfileValidationMessage(preset.profile!)).toBe("");
                    expect(preset.prompt).not.toContain("undefined");
                    expect(preset.prompt).toContain(`视觉媒介：${medium.label}`);
                    expect(preset.prompt).toContain(medium.prompt);
                    expect(preset.prompt).toContain(medium.forbidden);
                    expect(preset.prompt).toContain(world.prompt);
                    expect(preset.prompt).toContain(tone.prompt);
                    const saved = parseStyleProfile(serializeStyleProfile(preset.profile!))!;
                    expect(saved.selection).toEqual(selection);
                    for (const mode of ["image", "video"] as const) {
                        const plan = resolveStyleExecutionPlan(saved, { mode, model: "offline-model" });
                        expect(plan.status).toBe("ready");
                        expect(plan.prompt).toBe(preset.prompt);
                        expect(applyStyleExecutionPlan("按原文表现角色。", plan)).toContain(preset.prompt);
                    }
                }
            }
        }
    }
    expect(ids.size).toBe(750);
});

test("all topics offer both live-action and 3D recommended presets", () => {
    expect(recommendedCanvasStylePresets).toHaveLength(39);
    expect(new Set(recommendedCanvasStylePresets.map((preset) => preset.id)).size).toBe(39);
    expect(new Set(recommendedCanvasStylePresets.map((preset) => preset.prompt)).size).toBe(39);
    for (const world of projectStyleWorlds) {
        const options = recommendedCanvasStylePresets.filter((preset) => preset.selection?.world === world.id);
        expect(options.some((preset) => preset.selection?.medium === "live-action")).toBe(true);
        expect(options.some((preset) => preset.selection?.medium.startsWith("3d-"))).toBe(true);
    }
});

test("preview medium always follows the chosen medium instead of the topic", async () => {
    for (const world of projectStyleWorlds) {
        for (const medium of projectStyleMedia) {
            const preset = compileCanvasStylePreset({ world: world.id, tone: "epic", medium: medium.id, character: medium.characters[0] });
            expect(await Bun.file(new URL(`../public${preset.imageUrl}`, import.meta.url)).exists()).toBe(true);
            if (medium.id === "3d-anime" || medium.id === "3d-realistic") expect(preset.imageUrl).toEndWith("medium-3d.svg");
            if (medium.id === "2d-guoman" || medium.id === "2d-anime") expect(preset.imageUrl).toEndWith("medium-2d.svg");
            if (medium.id === "live-action") expect(preset.imageUrl).not.toMatch(/medium-3d|medium-2d|three-d-cartoon|ink-narrative/u);
        }
    }
});

test("switching medium normalizes character compatibility without changing the story or tone", () => {
    expect(normalizeProjectStyleSelection({ world: "apocalypse", tone: "dark", medium: "live-action", character: "anime" })).toEqual({ world: "apocalypse", tone: "dark", medium: "live-action", character: "realistic" });
    expect(normalizeProjectStyleSelection({ world: "mythology", tone: "epic", medium: "3d-cartoon", character: "realistic" })).toEqual({ world: "mythology", tone: "epic", medium: "3d-cartoon", character: "stylized" });
    expect(parseCanvasStyleSelection("v2-no-such-world--epic--live-action--realistic")).toBeNull();
    expect(parseCanvasStyleSelection("urban-live-action")).toBeNull();
});
