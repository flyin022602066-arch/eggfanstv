import { expect, test } from "bun:test";

const page = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const composer = await Bun.file(new URL("../src/pages/create/creation-workspace.tsx", import.meta.url)).text();
const styles = await Bun.file(new URL("../src/pages/create/creation-product.css", import.meta.url)).text();
const globalStyles = await Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text();
const creationTypes = await Bun.file(new URL("../src/pages/create/creation-types.ts", import.meta.url)).text();
const generationTask = await Bun.file(new URL("../src/services/api/generation-task.ts", import.meta.url)).text();

test("Eggfans Agent creation dialog uses the simplified Agent controls", () => {
    expect(page).toContain("和 Eggfans Agent 一起创作");
    expect(page).not.toContain("从一个画面、一个角色或一句话开始");
    expect(composer).toContain("creation-chat-reference-add");
    expect(composer).toContain('className="creation-submit is-icon-only"');
    expect(composer).not.toContain('<span>{showWorkingSpinner ? "生成中" : "开始创作"}</span>');
    expect(styles).toContain("creation-submit.is-icon-only");
});

test("thinking control exposes an obvious toggle state and preserves the request contract", () => {
    expect(composer).toContain('aria-pressed={props.textThinking}');
    expect(composer).toContain('data-thinking-enabled={props.textThinking ? "true" : "false"}');
    expect(composer).toContain('{props.textThinking ? "思考已开" : "思考"}');
    expect(composer).toContain('aria-label={props.textThinking ? "关闭模型思考" : "开启模型思考"}');
    expect(page).toContain('enableThinking: textThinking');
    expect(generationTask).toContain('thinking: options.enableThinking === true');
    expect(globalStyles).toContain('box-shadow: inset 0 0 0 1px var(--control-selected-border);');
});

test("new Eggfans Agent sessions start in the LibTV video mode", () => {
    expect(creationTypes).toContain('export const defaultCreationMode: CreationMode = "video";');
});
