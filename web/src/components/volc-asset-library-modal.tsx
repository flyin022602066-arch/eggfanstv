import { App, Button, Input, Select, Space, Table } from "antd";
import { useEffect, useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { restoreVolcLibraryAssets, syncResourceToVolcLibrary, type VolcLibraryAsset } from "@/services/api/volc-asset-library";
import { uploadImage } from "@/services/image-storage";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCopyText } from "@/hooks/use-copy-text";

export function VolcAssetLibraryButton() {
    const [open, setOpen] = useState(false);
    return <><Button onClick={() => setOpen(true)}>火山本地资产库</Button>{open ? <VolcAssetLibraryModal onClose={() => setOpen(false)} /> : null}</>;
}

function VolcAssetLibraryModal({ onClose }: { onClose: () => void }) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const assets = useAssetStore((state) => state.assets);
    const [records, setRecords] = useState<VolcLibraryAsset[]>([]);
    const [selected, setSelected] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const controller = useRef<AbortController | null>(null);
    const run = async (action: (signal: AbortSignal) => Promise<void>) => {
        if (controller.current) return;
        const current = new AbortController();
        controller.current = current;
        setBusy(true); setError("");
        try { await action(current.signal); }
        catch (error) { if (!current.signal.aborted) setError(error instanceof Error ? error.message : "资产操作失败"); }
        finally { controller.current = null; setBusy(false); }
    };
    const refresh = async (signal: AbortSignal) => { setRecords(await restoreVolcLibraryAssets(signal)); };
    useEffect(() => { void run(refresh); return () => controller.current?.abort(); }, []);
    const sync = async (resourceId: string, name: string, signal: AbortSignal) => {
        await syncResourceToVolcLibrary(resourceId, name, signal);
        await refresh(signal);
        message.success("原图和 URI 已一起保存到本地资产库");
    };
    return <AppModal open title="火山 URI 本地资产库" width={960} footer={null} onCancel={onClose}>
        <div className="space-y-4">
            <p className="text-sm text-foreground/60">保存在项目根目录 asset-library/volc。这里读取本地记录；Seedance 使用 URI，其他渠道保留原图。可在画布中用 @资产名称引用。</p>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Space wrap>
                <Button disabled={busy} onClick={() => void run(refresh)}>刷新本地记录</Button>
                <Button disabled={busy} onClick={() => inputRef.current?.click()}>上传图片到火山资产库</Button>
                <input hidden ref={inputRef} type="file" accept="image/*" onChange={(event) => {
                    const file = event.target.files?.[0]; event.target.value = "";
                    if (file) void run(async (signal) => {
                        if (file.size > 30 * 1024 * 1024) throw new Error("参考图片不能超过 30 MB");
                        const image = await uploadImage(file);
                        const resourceId = resourceIdFromStorageKey(image.storageKey);
                        if (!resourceId) throw new Error("原图未保存到本地，无法同步");
                        await sync(resourceId, file.name, signal);
                    });
                }} />
            </Space>
            <Space wrap>
                <Select aria-label="选择火山本地图片" placeholder="选择已有本地图片" value={selected} onChange={setSelected} style={{ minWidth: 240 }} options={assets.filter((asset) => asset.kind === "image").map((asset) => ({ value: asset.id, label: asset.title }))} />
                <Button loading={busy} disabled={!selected} onClick={() => void run(async (signal) => {
                    const asset = assets.find((item) => item.id === selected);
                    if (!asset || asset.kind !== "image") throw new Error("请选择本地图片");
                    const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
                    if (!resourceId) throw new Error("图片未保存到本地资源目录，请重新导入");
                    await sync(resourceId, asset.title, signal);
                })}>同步选中图片</Button>
            </Space>
            <Table rowKey="id" loading={busy} dataSource={records} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} columns={[
                { title: "图片名称", dataIndex: "name" },
                { title: "URI", dataIndex: "uri", render: (uri: string) => <Input aria-label="已保存的火山 URI" value={uri} readOnly /> },
                { title: "本地文件", dataIndex: "imageFile" },
                { title: "操作", render: (_, record) => <Button size="small" onClick={() => void copyText(record.uri)}>复制 URI</Button> },
            ]} />
        </div>
    </AppModal>;
}
