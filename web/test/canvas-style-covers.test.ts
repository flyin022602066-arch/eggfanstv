import { expect, test } from "bun:test";
import { builtinStyleCover, builtinStyleCovers } from "../src/lib/canvas/canvas-style-covers";
import { compileCanvasStylePreset, recommendedCanvasStylePresets } from "../src/lib/canvas/canvas-style-system";

test("recommended styles have separate native 4K covers and lightweight thumbnails", async () => {
    const urls = new Set<string>();
    for (const preset of recommendedCanvasStylePresets) {
        const cover = builtinStyleCover(preset.id);
        expect(cover, preset.id).toBeDefined();
        expect(cover!.width).toBe(3840);
        expect(cover!.height).toBe(2160);
        expect(preset.imageUrl).toBe(cover!.imageUrl);
        expect(preset.thumbnailUrl).toBe(cover!.thumbnailUrl);
        expect(urls.has(cover!.imageUrl)).toBe(false);
        urls.add(cover!.imageUrl);
    }
    for (const cover of Object.values(builtinStyleCovers)) {
        for (const path of [cover.imageUrl, cover.thumbnailUrl]) {
            expect(path).toStartWith("/short-drama-styles/covers/");
            expect(path).toEndWith(".webp");
            expect(await Bun.file(new URL("../public" + path, import.meta.url)).exists()).toBe(true);
        }
    }
});

test("unillustrated custom combinations retain medium-safe previews", async () => {
    const preset = compileCanvasStylePreset({ world: "suspense", tone: "healing", medium: "live-action", character: "realistic" });
    expect(builtinStyleCover(preset.id)).toBeUndefined();
    expect(preset.thumbnailUrl).toBeUndefined();
    expect(await Bun.file(new URL("../public" + preset.imageUrl, import.meta.url)).exists()).toBe(true);
});
