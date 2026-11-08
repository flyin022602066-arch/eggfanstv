import { expect, mock, spyOn, test } from "bun:test";
import * as generation from "@/services/api/generation-task";
import { submitProjectAssetImage } from "@/pages/projects/detail/project-asset-image-generation";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { projectAssetLibraryReference, useLibraryImageForProjectAsset } from "@/pages/projects/detail/project-asset-image-source";
import { captureUserScope } from "@/lib/user-scope-guard";
import type { Asset } from "@/stores/use-asset-store";
import type { Project, ProjectAsset } from "@/services/api/projects";

const picture = { id: "picture", kind: "image", title: "原图", data: { storageKey: "resource:original", width: 4096, height: 2048, mimeType: "image/png" } } as Asset;

test("unpictured characters bind library originals to the selected look without creating a model task", async () => {
    const asset = { id: "hero", category: "character", primaryVersionId: "default-look", character: { versionId: "selected-look", representations: [] } } as unknown as ProjectAsset;
    const api = { replaceImage: mock(async () => ({} as never)), bindCharacter: mock(async () => ({} as never)) };
    const scope = captureUserScope();
    await useLibraryImageForProjectAsset("project", asset, picture, scope, api);
    expect(api.bindCharacter).toHaveBeenCalledWith("project", "hero", "selected-look", "original", scope);
    expect(api.replaceImage).not.toHaveBeenCalled();
    expect(projectAssetLibraryReference(picture).storageKey).toBe("resource:original");
});

for (const category of ["environment", "prop"]) test(`unpictured ${category} can directly use a library image`, async () => {
    const asset = { id: category, category, mediaType: "text", primaryVersionId: "definition" } as ProjectAsset;
    const api = { replaceImage: mock(async () => ({} as never)), bindCharacter: mock(async () => ({} as never)) };
    const scope = captureUserScope();
    await useLibraryImageForProjectAsset("project", asset, picture, scope, api);
    expect(api.replaceImage).toHaveBeenCalledWith("project", category, "original", scope);
    expect(api.bindCharacter).not.toHaveBeenCalled();
});

test("unsynchronized or non-image material cannot silently bind a blank image", () => {
    expect(() => projectAssetLibraryReference(undefined)).toThrow();
    expect(() => projectAssetLibraryReference({ ...picture, data: { storageKey: "local-only" } } as Asset)).toThrow("同步");
});

test("scene and prop generation submit the selected original reference and edited prompt", async () => {
    const ready = spyOn(useConfigStore.getState(), "isAiConfigReady").mockReturnValue(true);
    const submit = spyOn(generation, "submitBackendGenerationTask").mockResolvedValue({} as never);
    try {
        for (const category of ["environment", "prop"]) {
            const asset = { id: category, title: category, category, primaryVersionId: "definition", mediaType: "text", status: "confirmed" } as ProjectAsset;
            await submitProjectAssetImage({ id: "project" } as Project, { asset, config: defaultConfig, prompt: "用户编辑后的造型设计", referenceImage: projectAssetLibraryReference(picture) });
            const request = submit.mock.calls.at(-1)![0];
            expect(request.prompt).toBe("用户编辑后的造型设计");
            expect(request.referenceImages?.[0].storageKey).toBe("resource:original");
            expect(request.metadata).toMatchObject({ operation: "project_asset_image", assetId: category, assetVersionId: "definition" });
        }
    } finally {
        ready.mockRestore();
        submit.mockRestore();
    }
});
