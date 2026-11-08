import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { assetLibraryQueryKey } from "@/components/assets/asset-view-session";
import { captureUserScope } from "@/lib/user-scope-guard";
import { loadWorkspaceAssetLibraryPage } from "@/services/workspace-asset-read";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { filterCanvasProjectAssets } from "@/lib/canvas/canvas-asset-library";

export const CanvasAssetLibraryContext = createContext<string | undefined>(undefined);
const EMPTY_ASSETS: Asset[] = [];

/** Canvas entry points share the personal library's canonical read boundary. */
export function usePersonalAssetLibrary(canvasId?: string) {
    const contextCanvasId = useContext(CanvasAssetLibraryContext);
    const activeCanvasId = canvasId ?? contextCanvasId;
    const canvases = useCanvasStore((state) => state.projects);
    const scope = captureUserScope();
    const hydrated = useAssetStore((state) => state.hydrated);
    const revision = useAssetStore((state) => state.assets.map((asset) => `${asset.id}:${asset.updatedAt}:${asset.status}`).join("|"));
    const query = useQuery({
        queryKey: assetLibraryQueryKey(scope, "canvas-personal-library", revision),
        enabled: hydrated,
        queryFn: async ({ signal }) => {
            const assets: Asset[] = [];
            for (let page = 1; ; page += 1) {
                const result = await loadWorkspaceAssetLibraryPage({ page, pageSize: 100, status: "active", expectedScope: scope, signal });
                assets.push(...result.assets);
                if (!result.hasMore) break;
            }
            return [...new Map(assets.filter((asset) => asset.status !== "archived" && asset.kind !== "entity").map((asset) => [asset.id, asset])).values()];
        },
        staleTime: 5000,
        refetchInterval: 5000,
    });
    const assets = query.data || EMPTY_ASSETS;
    return useMemo(() => activeCanvasId === undefined ? assets : filterCanvasProjectAssets(assets, canvases, activeCanvasId), [activeCanvasId, assets, canvases]);
}
