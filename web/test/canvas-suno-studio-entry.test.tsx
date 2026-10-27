import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { CanvasSunoStudioEntry } from "../src/components/canvas/canvas-suno-studio-entry";

describe("canvas Suno studio entry", () => {
    test("exposes an accessible entry and stops canvas click propagation", () => {
        let clicked = false;
        let stopped = false;
        const button = CanvasSunoStudioEntry({ onClick: () => { clicked = true; } }) as ReactElement<Record<string, unknown>>;

        expect(button.type).toBe("button");
        expect(button.props["aria-label"]).toBe("打开 Suno 音乐导演台");
        (button.props.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation: () => { stopped = true; } });

        expect(stopped).toBe(true);
        expect(clicked).toBe(true);
    });
});
