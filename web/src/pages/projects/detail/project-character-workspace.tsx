import { useState } from "react";
import { Button, Dropdown, Popconfirm } from "antd";
import { MoveRight, Pencil, Plus, Trash2, UserRound, Volume2 } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { characterLookGroups } from "@/lib/character-look-management";
import { characterReferenceImage } from "@/lib/character-look-selection";
import { resourceStorageKey } from "@/services/api/resources";
import { getCharacterReferenceCatalog } from "@/services/api/project-character-references";
import { useQuery } from "@tanstack/react-query";
import type { Project, ProjectAsset } from "@/services/api/projects";
import { ProjectCharacterLooksPanel } from "./project-character-looks-panel";

export function ProjectCharacterWorkspace({ project, assets, chapterLabels, folderItems, removingId, onCreate, onEdit, onVoice, onPreview, onMove, onRemove, onSaved }: { project: Project; assets: ProjectAsset[]; chapterLabels: Map<string, string>; folderItems: Array<{ key: string; label: string }>; removingId?: string; onCreate: () => void; onEdit: (asset: ProjectAsset) => void; onVoice: (asset: ProjectAsset) => void; onPreview: (asset: ProjectAsset) => void; onMove: (asset: ProjectAsset, folderId: string) => void; onRemove: (asset: ProjectAsset) => Promise<unknown>; onSaved: () => Promise<unknown> }) {
    const [selectedId, setSelectedId] = useState(assets[0]?.id);
    const selected = assets.find((asset) => asset.id === selectedId) || assets[0];
    const catalog = useQuery({ queryKey: ["project", project.id, "character-reference-catalog"], queryFn: () => getCharacterReferenceCatalog(project.id) });
    if (!selected) return null;
    const chapters = selected.unitIds?.flatMap((id) => chapterLabels.get(id) || []) || [];
    return <div className="character-asset-workspace">
        <nav className="character-asset-list" aria-label="项目角色列表"><div className="character-asset-list-heading"><strong>角色列表</strong><Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={onCreate}>新增</Button></div>{assets.map((asset) => {
            const groups = characterLookGroups(catalog.data?.versions.filter((version) => version.assetId === asset.id) || []);
            const image = asset.character && characterReferenceImage(asset.character);
            const pending = groups.filter((group) => group.pending.length).length;
            return <button type="button" key={asset.id} className="character-asset-list-item" aria-pressed={selected.id === asset.id} onClick={() => setSelectedId(asset.id)}>{image ? <CachedResourceImage storageKey={resourceStorageKey(image.resourceId)} alt={asset.title} /> : <span className="character-asset-list-avatar"><UserRound className="size-5" /></span>}<span><strong title={asset.title}>{asset.title}</strong><small>{groups.length || asset.characterLookCount || 1} 套造型{pending ? ` · ${pending} 待确认` : ""}</small></span></button>;
        })}</nav>
        <div className="character-asset-detail"><div className="character-asset-detail-heading"><div><h3>{selected.title}</h3><p title={chapters.join("；")}>{chapters.join(" · ") || "未关联集数"}</p></div><div className="character-looks-actions">
            <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(selected)}>编辑角色</Button>
            <Button size="small" icon={<Volume2 className="size-3.5" />} onClick={() => onVoice(selected)}>声音</Button>
            <Button size="small" aria-label={`查看角色卡：${selected.title}`} onClick={() => onPreview(selected)}>预览与下载</Button>
            <Dropdown trigger={["click"]} menu={{ items: folderItems, selectedKeys: [selected.folderId || ""], onClick: ({ key }) => onMove(selected, key) }}><Button size="small" icon={<MoveRight className="size-3.5" />}>移动</Button></Dropdown>
            <Popconfirm title={`移出角色“${selected.title}”？`} description="已被引用的角色需先解除引用，其他角色不受影响。" okText="移出" cancelText="取消" onConfirm={async () => { try { await onRemove(selected); } catch { return; } }}><Button size="small" aria-label={`移出 ${selected.title}`} danger icon={<Trash2 className="size-3.5" />} loading={removingId === selected.id}>移出角色</Button></Popconfirm>
        </div></div><ProjectCharacterLooksPanel key={selected.id} project={project} asset={selected} onSaved={onSaved} /></div>
    </div>;
}
