import { useMemo } from "react";
import { AssetLibraryPickerModal } from "@/components/assets/asset-library-picker-modal";
import { usePersonalAssetLibrary } from "@/hooks/use-personal-asset-library";
import type { CapturedUserScope } from "@/lib/user-scope-guard";
import type { Asset } from "@/stores/use-asset-store";

export function ProjectAssetImageSourcePicker({ mode, onClose, onSelect }: { mode: "reference" | "asset"; onClose: () => void; onSelect: (asset: Asset | undefined, scope: CapturedUserScope) => Promise<void> }) {
    const library = usePersonalAssetLibrary();
    const items = useMemo(() => library.filter((asset) => asset.kind === "image").map((asset) => ({ id: asset.id, title: asset.title, category: asset.category || "other", kindLabel: "图片", asset })), [library]);
    return <AssetLibraryPickerModal open remoteLibrary remoteKind="image" mediaKinds={["image"]} multiple={false} items={items} categoryLabels={{ all: "全部图片", character: "角色", environment: "场景", prop: "道具", other: "其他" }} title={mode === "asset" ? "直接使用素材库图片" : "选择本次生图参考"} confirmLabel={() => mode === "asset" ? "直接用作资产图" : "作为本次生成参考"} emptyTitle="素材库暂无图片" emptyDescription="生成的项目资产图会自动保存到素材库，也可先在素材库上传图片。" onClose={onClose} onConfirm={async (_ids, scope, selected) => { await onSelect(selected[0]?.asset, scope); onClose(); }} />;
}
