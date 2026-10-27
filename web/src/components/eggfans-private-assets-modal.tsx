import { App, Button, Input, Popconfirm, Select, Space, Table, Tabs, Tag } from "antd";
import { useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { isEggfansBaseUrl } from "@/lib/eggfans-seedance";
import { useCopyText } from "@/hooks/use-copy-text";
import { eggfansAvatar, syncResourceToEggfans, queryEggfansVideoTasks, type EggfansRemoteVideoTask, type EggfansAvatarAsset, type EggfansAvatarGroup, type EggfansAvatarList } from "@/services/api/eggfans-private-assets";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { persistWorkspaceAssetChanges } from "@/services/workspace-asset-repository";
import { useConfigStore, type ModelChannel } from "@/stores/use-config-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

export function EggfansPrivateAssetsButton({ channel: suppliedChannel }: { channel?: ModelChannel }) {
    const channels = useConfigStore((state) => state.config.channels);
    const channel = suppliedChannel || channels.find((item) => item.enabled && isEggfansBaseUrl(item.baseUrl));
    const [open, setOpen] = useState(false);
    if (!channel || !isEggfansBaseUrl(channel.baseUrl)) return null;
    return <><Button onClick={() => setOpen(true)}>私域人像库</Button>{open ? <EggfansPrivateAssetsModal channel={channel} onClose={() => setOpen(false)} /> : null}</>;
}

function EggfansPrivateAssetsModal({ channel, onClose }: { channel: ModelChannel; onClose: () => void }) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [groups, setGroups] = useState<EggfansAvatarGroup[]>([]);
    const [groupId, setGroupId] = useState("");
    const [remoteAssets, setRemoteAssets] = useState<EggfansAvatarAsset[]>([]);
    const [assetPage, setAssetPage] = useState(1);
    const [assetTotal, setAssetTotal] = useState(0);
    const [groupPage, setGroupPage] = useState(1);
    const [groupTotal, setGroupTotal] = useState(0);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [editingGroup, setEditingGroup] = useState<EggfansAvatarGroup | null>(null);
    const [editingAsset, setEditingAsset] = useState<EggfansAvatarAsset | null>(null);
    const [assetName, setAssetName] = useState("");
    const [localAssetId, setLocalAssetId] = useState("");
    const [uri, setUri] = useState("");
    const [callbackUrl, setCallbackUrl] = useState("");
    const [language, setLanguage] = useState("zh");
    const [bytedToken, setBytedToken] = useState("");
    const [h5Link, setH5Link] = useState("");
    const [authCreatedAt, setAuthCreatedAt] = useState(0);
    const [videoProtocol, setVideoProtocol] = useState("eggfans-seedance-video");
    const [videoTaskId, setVideoTaskId] = useState("");
    const [videoTasks, setVideoTasks] = useState<EggfansRemoteVideoTask[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const controller = useRef<AbortController | null>(null);
    const localAssets = useAssetStore((state) => state.assets).filter((asset) => ["image", "video", "audio"].includes(asset.kind) && asset.status !== "archived");

    const run = async (action: (signal: AbortSignal) => Promise<void>) => {
        if (controller.current) return;
        const active = new AbortController();
        controller.current = active;
        setBusy(true);
        setError("");
        try {
            await action(active.signal);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "私域素材库操作失败");
        } finally {
            setBusy(false);
            controller.current = null;
        }
    };

    const loadGroups = async (signal: AbortSignal, page = groupPage) => {
        const result = await eggfansAvatar<EggfansAvatarList<EggfansAvatarGroup>>(channel, "list-groups", { PageNumber: page, PageSize: 20 }, undefined, signal);
        setGroups(result.Items || []);
        setGroupTotal(result.Total || 0);
        setGroupPage(page);
    };
    const loadAssets = async (signal: AbortSignal, page = 1) => {
        const result = await eggfansAvatar<EggfansAvatarList<EggfansAvatarAsset>>(channel, "list-assets", { PageNumber: page, PageSize: 20, ...(groupId ? { Filter: { GroupIds: [groupId] } } : {}) }, undefined, signal);
        setRemoteAssets(result.Items || []);
        setAssetTotal(result.Total || 0);
        setAssetPage(page);
    };
    const markLocalAsset = async (asset: Asset, assetId: string, privateGroupId: string) => {
        useAssetStore.getState().updateAsset(asset.id, { arkAssetId: assetId, metadata: { ...asset.metadata, eggfansBaseUrl: channel.baseUrl, eggfansGroupId: privateGroupId } });
        await persistWorkspaceAssetChanges();
    };
    const clearLocalBindings = async (assetIds: string[], deletedGroupId?: string) => {
        for (const asset of useAssetStore.getState().assets) {
            if (asset.metadata?.eggfansBaseUrl !== channel.baseUrl) continue;
            if (!assetIds.includes(asset.arkAssetId || "") && (!deletedGroupId || asset.metadata?.eggfansGroupId !== deletedGroupId)) continue;
            useAssetStore.getState().updateAsset(asset.id, { arkAssetId: undefined, metadata: { ...asset.metadata, eggfansGroupId: undefined } });
        }
        setUri("");
        await persistWorkspaceAssetChanges();
    };
    const syncLocalAsset = async (signal: AbortSignal) => {
        const asset = localAssets.find((item) => item.id === localAssetId);
        if (!asset || !(asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")) throw new Error("请选择本地图片、视频或音频资产");
        const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
        if (!resourceId) throw new Error("素材尚未保存到本地资源目录，请先重新导入");
        const binding = await syncResourceToEggfans(channel, resourceId, groupId || undefined, asset.title, signal);
        setUri(binding.uri);
        await markLocalAsset(asset, binding.assetId, binding.groupId);
        await loadAssets(signal);
    };
    const uploadFile = async (file: File, signal: AbortSignal) => {
        if (file.size > 128 * 1024 * 1024) throw new Error("Uguu 单文件不能超过 128 MiB，请压缩后上传");
        if (file.type.startsWith("image/") && file.size > 30 * 1024 * 1024) throw new Error("参考图片不能超过 30 MB");
        const uploaded = file.type.startsWith("image/") ? await uploadImage(file) : await uploadMediaFile(file);
        const resourceId = resourceIdFromStorageKey(uploaded.storageKey);
        if (!resourceId) throw new Error("原文件尚未保存到本地资源目录，未开始私域上传");
        const binding = await syncResourceToEggfans(channel, resourceId, groupId || undefined, file.name, signal);
        setUri(binding.uri);
        const base = { title: file.name, coverUrl: "", tags: [], category: "other" as const, status: "confirmed" as const, source: "Eggfans 私域素材库", arkAssetId: binding.assetId, metadata: { eggfansBaseUrl: channel.baseUrl, eggfansGroupId: binding.groupId } };
        if (file.type.startsWith("image/")) {
            const image = uploaded as Awaited<ReturnType<typeof uploadImage>>;
            useAssetStore.getState().addAsset({ ...base, kind: "image", coverUrl: image.url, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
        } else {
            const media = uploaded as Awaited<ReturnType<typeof uploadMediaFile>>;
            if (file.type.startsWith("video/")) useAssetStore.getState().addAsset({ ...base, kind: "video", coverUrl: media.preview?.url || "", data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, durationMs: media.durationMs, bytes: media.bytes, mimeType: media.mimeType } });
            else useAssetStore.getState().addAsset({ ...base, kind: "audio", data: { url: media.url, storageKey: media.storageKey, durationMs: media.durationMs, bytes: media.bytes, mimeType: media.mimeType } });
        }
        await persistWorkspaceAssetChanges();
        await loadAssets(signal);
    };
    const bindRemoteAsset = async (asset: EggfansAvatarAsset) => {
        const localAsset = localAssets.find((item) => item.id === localAssetId);
        if (!localAsset || localAsset.kind !== asset.AssetType.toLowerCase()) throw new Error("请选择同类型的本地素材用于绑定私域 URI");
        if (asset.Status !== "Active") throw new Error("素材尚未审核通过，不能作为模型参考");
        await markLocalAsset(localAsset, asset.Id, asset.GroupId);
        setUri(`asset://${asset.Id}`);
        message.success("已绑定；使用 @资产时会提交私域 URI");
    };

    return <AppModal open width={1000} title="Eggfans 私域人像与参考素材库" footer={null} onCancel={() => { controller.current?.abort(); onClose(); }}>
        <div className="space-y-4">
            <p className="break-all text-sm text-foreground/60">{channel.name} · {channel.baseUrl}</p>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            {busy ? <p role="status" className="text-sm">正在同步或查询私域素材…</p> : null}
            <Tabs items={[
                { key: "assets", label: "参考素材", children: <div className="space-y-3">
                    <Space wrap>
                        <Select aria-label="筛选私域素材组" value={groupId || undefined} allowClear placeholder="全部素材组" style={{ minWidth: 220 }} options={groups.map((group) => ({ label: group.Name, value: group.Id }))} onChange={(value) => setGroupId(value || "")} />
                        <Button disabled={busy} onClick={() => void run(async (signal) => { await loadGroups(signal); await loadAssets(signal); })}>读取素材</Button>
                        <Button disabled={busy} onClick={() => inputRef.current?.click()}>上传图片 / 视频 / 音频</Button>
                        <input ref={inputRef} type="file" accept="image/*,video/*,audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run((signal) => uploadFile(file, signal)); }} />
                    </Space>
                    <Space wrap>
                        <Select aria-label="选择本地参考资产" value={localAssetId || undefined} placeholder="选择本地资产" style={{ minWidth: 240 }} options={localAssets.map((asset) => ({ label: `${asset.title} · ${asset.kind}`, value: asset.id }))} onChange={setLocalAssetId} />
                        <Button disabled={busy || !localAssetId} onClick={() => void run(syncLocalAsset)}>同步到私域库</Button>
                    </Space>
                    {uri ? <Space wrap><Input aria-label="私域参考 URI" readOnly value={uri} style={{ width: 330 }} /><Button onClick={() => void copyText(uri)}>复制 URI</Button></Space> : null}
                    <Table rowKey="Id" size="small" scroll={{ x: 740 }} dataSource={remoteAssets} pagination={{ current: assetPage, pageSize: 20, total: assetTotal, showSizeChanger: false, onChange: (page) => void run((signal) => loadAssets(signal, page)) }} columns={[
                        { title: "名称", dataIndex: "Name", render: (value, asset) => value || asset.Id },
                        { title: "类型", dataIndex: "AssetType" },
                        { title: "状态", dataIndex: "Status", render: (value: string) => <Tag>{({ Active: "可用", Processing: "审核中", Failed: "失败" } as Record<string, string>)[value] || value}</Tag> },
                        { title: "操作", render: (_, asset) => <Space wrap>
                            <Button size="small" disabled={busy} onClick={() => void run(async (signal) => { const latest = await eggfansAvatar<EggfansAvatarAsset>(channel, "get-asset", undefined, asset.Id, signal); setRemoteAssets((items) => items.map((item) => item.Id === asset.Id ? latest : item)); })}>查询状态</Button>
                            <Button size="small" disabled={asset.Status !== "Active"} onClick={() => void copyText(`asset://${asset.Id}`)}>复制 URI</Button>
                            <Button size="small" disabled={busy || !localAssetId || asset.Status !== "Active"} onClick={() => void run(async () => bindRemoteAsset(asset))}>绑定本地资产</Button>
                            <Button size="small" disabled={busy} onClick={() => { setEditingAsset(asset); setAssetName(asset.Name || ""); }}>改名</Button>
                            <Popconfirm title="删除此私域素材？" description="已使用该 URI 的生成参考将不可用。" onConfirm={() => run(async (signal) => { await eggfansAvatar(channel, "delete-asset", undefined, asset.Id, signal); await clearLocalBindings([asset.Id]); await loadAssets(signal, assetPage); })}><Button size="small" danger disabled={busy}>删除</Button></Popconfirm>
                        </Space> },
                    ]} />
                    {editingAsset ? <Space wrap><Input aria-label="私域素材名称" value={assetName} onChange={(event) => setAssetName(event.target.value)} /><Button disabled={busy || !assetName.trim()} onClick={() => void run(async (signal) => { await eggfansAvatar(channel, "update-asset", { Name: assetName.trim() }, editingAsset.Id, signal); setEditingAsset(null); await loadAssets(signal, assetPage); })}>保存名称</Button><Button onClick={() => setEditingAsset(null)}>取消</Button></Space> : null}
                </div> },
                { key: "groups", label: "素材组", children: <div className="space-y-3">
                    <Button disabled={busy} onClick={() => void run((signal) => loadGroups(signal))}>读取素材组</Button>
                    <Space wrap><Input aria-label="素材组名称" placeholder="素材组名称" value={name} onChange={(event) => setName(event.target.value)} /><Input aria-label="素材组描述" placeholder="描述（可选）" value={description} onChange={(event) => setDescription(event.target.value)} /><Button disabled={busy || !name.trim()} onClick={() => void run(async (signal) => { await eggfansAvatar(channel, editingGroup ? "update-group" : "create-group", { Name: name.trim(), Description: description, ...(editingGroup ? {} : { GroupType: "AIGC" }) }, editingGroup?.Id, signal); setEditingGroup(null); setName(""); setDescription(""); await loadGroups(signal); })}>{editingGroup ? "保存修改" : "创建素材组"}</Button>{editingGroup ? <Button onClick={() => { setEditingGroup(null); setName(""); setDescription(""); }}>取消</Button> : null}</Space>
                    <Table rowKey="Id" size="small" scroll={{ x: 740 }} dataSource={groups} pagination={{ current: groupPage, pageSize: 20, total: groupTotal, showSizeChanger: false, onChange: (page) => void run((signal) => loadGroups(signal, page)) }} columns={[
                        { title: "名称", dataIndex: "Name" }, { title: "类型", dataIndex: "GroupType" }, { title: "ID", dataIndex: "Id" },
                        { title: "操作", render: (_, group) => <Space wrap><Button size="small" disabled={busy} onClick={() => void run(async (signal) => { const latest = await eggfansAvatar<EggfansAvatarGroup>(channel, "get-group", undefined, group.Id, signal); setEditingGroup(latest); setName(latest.Name); setDescription(latest.Description || ""); })}>详情 / 编辑</Button><Button size="small" onClick={() => setGroupId(group.Id)}>选为上传组</Button><Popconfirm title="删除此私域素材组？" description="请先确认组内素材及已使用的参考 URI。" onConfirm={() => run(async (signal) => { await eggfansAvatar(channel, "delete-group", undefined, group.Id, signal); await clearLocalBindings(remoteAssets.filter((asset) => asset.GroupId === group.Id).map((asset) => asset.Id), group.Id); if (groupId === group.Id) setGroupId(""); await loadGroups(signal); })}><Button size="small" danger disabled={busy}>删除</Button></Popconfirm></Space> },
                    ]} />
                </div> },
                { key: "auth", label: "真人认证", children: <div className="space-y-3">
                    <p className="text-sm text-foreground/60">真人需自行打开 H5 链接完成认证；认证后在 120 秒有效期内换取真人素材组，上传时选择该组。</p>
                    <Input aria-label="真人认证完成跳转地址" placeholder="认证完成跳转地址 CallbackURL" value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} />
                    <Space wrap><Select aria-label="真人认证语言" value={language} options={[{ label: "简体中文", value: "zh" }, { label: "English", value: "en" }, { label: "繁體中文", value: "zh-Hant" }]} onChange={setLanguage} /><Button disabled={busy || !callbackUrl.trim()} onClick={() => void run(async (signal) => { const result = await eggfansAvatar<{ BytedToken: string; H5Link: string }>(channel, "auth-session", { CallbackURL: callbackUrl.trim(), Lng: language }, undefined, signal); setBytedToken(result.BytedToken); setH5Link(result.H5Link); setAuthCreatedAt(Date.now()); })}>生成认证链接</Button></Space>
                    {h5Link ? <Space wrap><a href={h5Link} target="_blank" rel="noopener noreferrer">打开真人认证页面</a><Button onClick={() => void copyText(h5Link)}>复制认证链接</Button></Space> : null}
                    <Input.Password aria-label="真人认证 BytedToken" placeholder="BytedToken" value={bytedToken} onChange={(event) => { setBytedToken(event.target.value); setAuthCreatedAt(0); }} />
                    <Button disabled={busy || !bytedToken.trim()} onClick={() => void run(async (signal) => { if (authCreatedAt && Date.now() - authCreatedAt > 120000) throw new Error("认证 Token 已超过 120 秒，请重新生成认证链接"); const result = await eggfansAvatar<{ GroupId: string }>(channel, "group-from-token", { BytedToken: bytedToken.trim() }, undefined, signal); setGroupId(result.GroupId); setBytedToken(""); setH5Link(""); await loadGroups(signal); message.success(`真人素材组已获取：${result.GroupId}`); })}>认证完成，换取素材组</Button>
                </div> },
                { key: "video-tasks", label: "视频任务", children: <div className="space-y-3">
                    <Space wrap><Select aria-label="视频任务接口" value={videoProtocol} options={[{ label: "Seedance 原生任务", value: "eggfans-seedance-video" }, { label: "Volc 任务", value: "eggfans-volc-video" }]} onChange={setVideoProtocol} /><Input aria-label="上游视频任务 ID" placeholder="任务 ID（留空查询最近任务）" value={videoTaskId} onChange={(event) => setVideoTaskId(event.target.value)} /><Button disabled={busy} onClick={() => void run(async (signal) => setVideoTasks(await queryEggfansVideoTasks(channel, videoProtocol, videoTaskId.trim() || undefined, signal)))}>查询任务</Button></Space>
                    <Table rowKey={(task) => task.id || task.task_id || ""} size="small" scroll={{ x: 740 }} dataSource={videoTasks} pagination={false} columns={[{ title: "任务 ID", render: (_, task) => task.id || task.task_id }, { title: "模型", dataIndex: "model" }, { title: "状态", dataIndex: "status" }, { title: "结果", render: (_, task) => task.content?.video_url ? <Button size="small" onClick={() => void copyText(task.content!.video_url!)}>复制视频链接</Button> : "等待完成" }]} />
                </div> },
            ]} />
        </div>
    </AppModal>;
}
