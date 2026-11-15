import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyDoubaoBrowserFaceMasks({ page, outputDir, originals, resources, tasks, uploaded, hosted, waitForPreview }) {
    const privacyPixels = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320; canvas.height = 160;
        const context = canvas.getContext("2d");
        const sourcePixels = context.createImageData(canvas.width, canvas.height);
        for (let offset = 0; offset < sourcePixels.data.length; offset += 4) {
            const pixel = offset / 4;
            sourcePixels.data[offset] = pixel % 251;
            sourcePixels.data[offset + 1] = Math.floor(pixel / canvas.width) % 251;
            sourcePixels.data[offset + 2] = pixel % 2 ? 230 : 20;
            sourcePixels.data[offset + 3] = 255;
        }
        context.putImageData(sourcePixels, 0, 0);
        const source = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const regions = [{ id: "left-face", x: 0, y: 0.125, width: 0.25, height: 0.75 }, { id: "right-face", x: 0.625, y: 0.125, width: 0.25, height: 0.75 }];
        const results = [];
        for (const mode of ["blur", "solid"]) {
            const processed = await window.faceMaskHarness.render(source, regions, mode);
            const bitmap = await createImageBitmap(processed);
            const output = document.createElement("canvas");
            output.width = bitmap.width; output.height = bitmap.height;
            const outputContext = output.getContext("2d");
            outputContext.drawImage(bitmap, 0, 0); bitmap.close();
            const pixels = outputContext.getImageData(0, 0, output.width, output.height).data;
            let outsideChanged = 0, solidMismatch = 0;
            const changedFaces = [0, 0];
            for (let vertical = 0; vertical < output.height; vertical++) for (let horizontal = 0; horizontal < output.width; horizontal++) {
                const offset = (vertical * output.width + horizontal) * 4;
                const face = regions.findIndex(region => horizontal >= region.x * output.width && horizontal < (region.x + region.width) * output.width && vertical >= region.y * output.height && vertical < (region.y + region.height) * output.height);
                const changed = [0, 1, 2, 3].some(channel => pixels[offset + channel] !== sourcePixels.data[offset + channel]);
                if (face < 0) { if (changed) outsideChanged++; }
                else {
                    if (changed) changedFaces[face]++;
                    if (mode === "solid" && (pixels[offset] !== 128 || pixels[offset + 1] !== 128 || pixels[offset + 2] !== 128 || pixels[offset + 3] !== 255)) solidMismatch++;
                }
            }
            results.push({ mode, width: output.width, height: output.height, outsideChanged, changedFaces, solidMismatch });
        }
        return results;
    });
    for (const result of privacyPixels) {
        assert.equal(result.width, 320); assert.equal(result.height, 160);
        assert.equal(result.outsideChanged, 0, `${result.mode}: pixels outside face regions must stay unchanged`);
        assert.ok(result.changedFaces.every(count => count > 0), `${result.mode}: every face must be processed`);
        assert.equal(result.solidMismatch, 0);
    }
    const settings = page.getByRole("region", { name: "分镜生成设置" });
    await settings.getByRole("switch", { name: "自动人脸遮罩" }).click();
    await settings.getByRole("button", { name: "60%", exact: true }).click();
    await page.waitForFunction(() => window.faceMaskHarness.config().videoDoubaoBrowserFaceMask === "grid-60");
    assert.equal(await page.evaluate(() => window.faceMaskHarness.config().videoHanbaoFaceMask), "off");
    assert.equal(uploaded.length, 0);
    for (const [mode, label] of [["grid", "半透明网格 50%"], ["grid-60", "半透明网格 60%"], ["grid-75", "半透明网格 75%"], ["mosaic", "马赛克"], ["blur", "强模糊"], ["solid", "实色遮挡"]]) {
        await page.getByRole("button", { name: "豆包浏览器 人脸遮罩", exact: true }).click();
        await waitForPreview(page, "source-portrait");
        assert.ok(await page.getByRole("button", { name: /^移动人脸/ }).count() > 0);
        const before = uploaded.length;
        await page.getByRole("combobox", { name: "人脸遮罩样式" }).click();
        await page.getByText(label, { exact: true }).last().click();
        await waitForPreview(page, "source-portrait");
        assert.equal(uploaded.length, before, "Preview must not upload images");
        if (mode === "grid-60") await page.screenshot({ path: join(outputDir, "doubao-preview-light.png"), animations: "disabled" });
        await page.getByRole("button", { name: "保存调整", exact: true }).click();
        await page.reload();
        await page.waitForFunction((expected) => window.faceMaskHarness?.config().videoDoubaoBrowserFaceMask === expected && window.faceMaskHarness.node().metadata.doubaoBrowserFaceMask === expected, mode);
        const taskCount = tasks.length;
        await page.evaluate(() => window.faceMaskHarness.submit());
        assert.equal(tasks.length, taskCount + 1);
        const input = tasks.at(-1).input;
        assert.equal(input.config.interfaceType, "doubao-browser-video");
        assert.equal(input.config.model, "seedance_v2.0");
        for (const name of ["face", "native_face", "videoJiasuFaceMode", "videoHanbaoFaceMask", "videoDoubaoBrowserFaceMask"]) assert.equal(Object.hasOwn(input.config, name), false);
        assert.equal(input.referenceImages.length, 2);
        assert.ok(input.referenceImages[0].storageKey.startsWith("resource:masked-"));
        assert.ok(input.referenceImages[1].storageKey.startsWith("resource:masked-"), "Multi-view reference must also use a processed copy");
        const expectedBytes = await page.evaluate(async (selectedMode) => {
            const harness = window.faceMaskHarness;
            const inspection = await harness.inspect(harness.references[0], harness.node().metadata.doubaoBrowserFaceMasks.portrait);
            return Array.from(new Uint8Array(await (await harness.render(inspection.source, inspection.regions, selectedMode)).arrayBuffer()));
        }, mode);
        const sentBytes = resources.get(input.referenceImages[0].storageKey.replace("resource:", ""));
        assert.deepEqual(sentBytes, Buffer.from(expectedBytes), "Task must reference the selected Doubao derivative");
        assert.notDeepEqual(sentBytes, originals.get("source-portrait"));
        await writeFile(join(outputDir, `doubao-${mode}-portrait.png`), sentBytes);
        assert.ok(uploaded.slice(before).every((item) => /^doubao-browser-face-mask:[a-f0-9]{64}$/.test(item.idempotencyKey)));
        assert.equal(uploaded.slice(before)[0].sourceResourceId, "source-portrait");
        const uploadsBeforeReuse = uploaded.length;
        await page.evaluate(() => window.faceMaskHarness.submit());
        assert.equal(uploaded.length, uploadsBeforeReuse);
        assert.deepEqual(tasks.at(-1).input.referenceImages, input.referenceImages);
    }
    const uploadsBeforeOff = uploaded.length;
    await page.evaluate(() => window.faceMaskHarness.submitWithMode("off"));
    assert.equal(uploaded.length, uploadsBeforeOff);
    assert.deepEqual(tasks.at(-1).input.referenceImages.map((image) => image.storageKey), ["resource:source-portrait", "resource:source-sheet"]);
    assert.equal(hosted.length, 0, "Doubao must keep its native upload path");
    for (const width of [1400, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.getByRole("button", { name: "切换明暗", exact: true }).click();
        await page.screenshot({ path: join(outputDir, `doubao-settings-${width}.png`), animations: "disabled" });
    }
    await page.getByRole("button", { name: "H3 模型", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "豆包浏览器 人脸遮罩", exact: true }).count(), 0);
    await page.evaluate(() => window.faceMaskHarness.submit());
    assert.equal(uploaded.length, uploadsBeforeOff);
    assert.deepEqual(tasks.at(-1).input.referenceImages.map((image) => image.storageKey), ["resource:source-portrait", "resource:source-sheet"]);
}
