import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyHanbaoFaceMasks({ page, outputDir, originals, resources, tasks, uploaded, hosted, waitForPreview }) {
    const settings = page.getByRole("region", { name: "分镜生成设置" });
    await settings.getByRole("switch", { name: "自动人脸遮罩" }).click();
    await settings.getByRole("button", { name: "60%", exact: true }).click();
    await page.waitForFunction(() => window.faceMaskHarness.config().videoHanbaoFaceMask === "grid-60");
    assert.equal(await page.evaluate(() => window.faceMaskHarness.config().videoSd2FaceMask), "off");
    assert.equal(uploaded.length, 0);
    for (const [mode, label] of [["grid", "半透明网格 50%"], ["grid-60", "半透明网格 60%"], ["grid-75", "半透明网格 75%"], ["mosaic", "马赛克"]]) {
        await page.getByRole("button", { name: "憨包 人脸遮罩", exact: true }).click();
        await waitForPreview(page, "source-portrait");
        assert.ok(await page.getByRole("button", { name: /^移动人脸/ }).count() > 0, "Detector must find the portrait face");
        const before = uploaded.length;
        await page.getByRole("combobox", { name: "人脸遮罩样式" }).click();
        await page.getByText(label, { exact: true }).last().click();
        await waitForPreview(page, "source-portrait");
        assert.equal(uploaded.length, before, "Preview must not upload reference images");
        if (mode === "grid-60") await page.screenshot({ path: join(outputDir, "hanbao-preview-light.png"), animations: "disabled" });
        await page.getByRole("button", { name: "保存调整", exact: true }).click();
        await page.reload();
        await page.waitForFunction((expected) => window.faceMaskHarness?.config().videoHanbaoFaceMask === expected && window.faceMaskHarness.node().metadata.hanbaoFaceMask === expected, mode);
        const taskCount = tasks.length;
        await page.evaluate(() => window.faceMaskHarness.submit());
        assert.equal(tasks.length, taskCount + 1);
        const input = tasks.at(-1).input;
        assert.equal(input.config.interfaceType, "hanbao-video");
        assert.equal(input.config.videoGenerateAudio, "true");
        for (const name of ["face", "native_face", "videoJiasuFaceMode", "videoHanbaoFaceMask"]) assert.equal(Object.hasOwn(input.config, name), false);
        assert.equal(input.referenceImages.length, 2);
        assert.ok(input.referenceImages[0].storageKey.startsWith("resource:masked-"));
        const expectedBytes = await page.evaluate(async (selectedMode) => {
            const harness = window.faceMaskHarness;
            const inspection = await harness.inspect(harness.references[0], harness.node().metadata.hanbaoFaceMasks.portrait);
            const blob = await harness.render(inspection.source, inspection.regions, selectedMode);
            return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }, mode);
        const sentBytes = resources.get(input.referenceImages[0].storageKey.replace("resource:", ""));
        assert.deepEqual(sentBytes, Buffer.from(expectedBytes), "Task must reference the selected Hanbao derivative");
        assert.notDeepEqual(sentBytes, originals.get("source-portrait"));
        assert.ok(uploaded.slice(before).every((item) => /^hanbao-face-mask:[a-f0-9]{64}$/.test(item.idempotencyKey)));
        assert.equal(uploaded.slice(before)[0].sourceResourceId, "source-portrait");
        const uploadsBeforeReuse = uploaded.length;
        await page.evaluate(() => window.faceMaskHarness.submit());
        assert.equal(uploaded.length, uploadsBeforeReuse, "Same Hanbao mask must reuse its own derivative");
        assert.deepEqual(tasks.at(-1).input.referenceImages, input.referenceImages);
    }
    const uploadsBeforeOff = uploaded.length;
    await page.evaluate(() => window.faceMaskHarness.submitWithMode("off"));
    assert.equal(uploaded.length, uploadsBeforeOff);
    assert.deepEqual(tasks.at(-1).input.referenceImages.map((image) => image.storageKey), ["resource:source-portrait", "resource:source-sheet"]);
    assert.equal(hosted.length, 0, "Hanbao uses local references, never another channel's image host");
    for (const width of [1400, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.getByRole("button", { name: "切换明暗", exact: true }).click();
        await page.screenshot({ path: join(outputDir, `hanbao-settings-${width}.png`), animations: "disabled" });
    }
    await page.getByRole("button", { name: "H3 模型", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "憨包 人脸遮罩", exact: true }).count(), 0);
    await page.evaluate(() => window.faceMaskHarness.submit());
    assert.equal(uploaded.length, uploadsBeforeOff, "An unrelated provider must not apply Hanbao masks");
    assert.deepEqual(tasks.at(-1).input.referenceImages.map((image) => image.storageKey), ["resource:source-portrait", "resource:source-sheet"]);
}
