import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Select } from "antd";
import { Upload, UserRound } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { CHARACTER_FACE_ROLES, characterFaceRoleLabels, parseCharacterFacePresets, type CharacterFacePreset, type CharacterFacePresets, type CharacterFaceRole } from "@/lib/project-character-face-presets";
import { assertUserScope, captureUserScope } from "@/lib/user-scope-guard";
import { getProjectCore, listProjectAssetsPage, updateProject, type ProjectAsset } from "@/services/api/projects";
import { uploadCharacterFaceReference } from "@/services/project-character-face-presets";

export function ProjectCharacterFacePresetsModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => Promise<unknown> }) {
    const [draft, setDraft] = useState<CharacterFacePresets | null>(null);
    const [uploading, setUploading] = useState<CharacterFaceRole | null>(null);
    const [saving, setSaving] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState("");
    const query = useQuery({ queryKey: ["project", projectId, "character-face-presets"], staleTime: 0, queryFn: async () => {
        const expectedScope = captureUserScope();
        const { project } = await getProjectCore(projectId, expectedScope);
        assertUserScope(expectedScope);
        const characters: ProjectAsset[] = [];
        for (let page = 1; ; page++) {
            assertUserScope(expectedScope);
            const result = await listProjectAssetsPage(projectId, { page, pageSize: 80, category: "character" });
            assertUserScope(expectedScope);
            characters.push(...result.assets.filter((asset) => asset.character));
            if (!result.hasMore) break;
        }
        return { presets: parseCharacterFacePresets(project.characterFacePresetsJson), characters };
    } });
    const presets = draft ?? query.data?.presets ?? {};
    const busy = Boolean(uploading) || saving;
    const change = (role: CharacterFaceRole, next: CharacterFacePreset | undefined) => setDraft({ ...presets, [role]: next });
    const upload = async (role: CharacterFaceRole, file: File) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setUploading(role);
        setError("");
        const expectedScope = captureUserScope();
        try {
            const uploaded = await uploadCharacterFaceReference(file);
            assertUserScope(expectedScope);
            change(role, { ...uploaded, assetIds: presets[role]?.assetIds || [] });
        } catch (cause) { setError(cause instanceof Error ? cause.message : "人脸图片上传失败"); }
        finally { busyRef.current = false; setUploading(null); }
    };
    const save = async () => {
        if (busyRef.current || !query.data) return;
        busyRef.current = true;
        setSaving(true);
        setError("");
        const expectedScope = captureUserScope();
        try {
            const raw = JSON.stringify(presets);
            parseCharacterFacePresets(raw);
            await updateProject(projectId, { characterFacePresetsJson: raw }, expectedScope);
            assertUserScope(expectedScope);
            await onSaved();
            onClose();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "人脸预设保存失败"); }
        finally { busyRef.current = false; setSaving(false); }
    };
    return <AppModal open title="主角人脸预设" width={820} onCancel={() => !busyRef.current && onClose()} footer={<div className="flex justify-end gap-2"><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={saving} disabled={busy || !query.data || query.isFetching} onClick={() => void save()}>保存人脸预设</Button></div>}>
        <p className="mb-4 text-sm text-foreground/65">先提供男主、女主中的一张或两张参考图，再选择各自对应的角色。生成时保留参考面孔，按小说剧本设计服装、发型和造型；单张、批量生成均自动应用。</p>
        <p className="mb-4 text-xs text-foreground/50">建议每张只含一位人物、五官清晰。设置仅在当前项目生效，跨集复用并在重启后保留。可以先保存图片，提取角色后再绑定；未绑定的角色按原有规则生成。保存设置不会发起生图。</p>
        {query.isPending ? <p role="status">正在读取项目角色和人脸预设…</p> : null}
        {query.isError ? <Alert type="error" title="读取人脸预设失败" description={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : null}
        {query.data ? <div className="grid gap-4 sm:grid-cols-2">{CHARACTER_FACE_ROLES.map((role) => <FacePresetSlot key={role} role={role} value={presets[role]} characters={query.data.characters} otherIds={presets[role === "male" ? "female" : "male"]?.assetIds || []} disabled={busy} uploading={uploading === role} onChange={(value) => change(role, value)} onUpload={(file) => void upload(role, file)} />)}</div> : null}
        {error ? <Alert className="mt-4" type="error" showIcon title={error} /> : null}
    </AppModal>;
}

function FacePresetSlot({ role, value, characters, otherIds, disabled, uploading, onChange, onUpload }: { role: CharacterFaceRole; value?: CharacterFacePreset; characters: ProjectAsset[]; otherIds: string[]; disabled: boolean; uploading: boolean; onChange: (value: CharacterFacePreset | undefined) => void; onUpload: (file: File) => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const label = characterFaceRoleLabels[role];
    const characterIds = new Set(characters.map((asset) => asset.id));
    const missingIds = value?.assetIds.filter((assetId) => !characterIds.has(assetId)) || [];
    return <section className="min-w-0 rounded-lg border border-border bg-surface-active p-4" aria-label={`${label}人脸预设`}>
        <h3 className="mb-3 flex items-center gap-2 font-medium"><UserRound className="size-4" />{label}人脸参考</h3>
        <div className="mb-3 flex h-52 items-center justify-center overflow-hidden rounded-lg bg-surface">{value ? <CachedResourceImage key={value.resourceId} eager storageKey={`resource:${value.resourceId}`} alt={`${label}人脸参考图`} className="max-h-52 max-w-full object-contain" fallback={<span className="text-xs text-foreground/50">图片无法读取，请重新上传</span>} loadingFallback={<span className="text-xs text-foreground/50">读取参考图…</span>} /> : <span className="text-xs text-foreground/50">未设置人脸参考图</span>}</div>
        <p className="mb-3 truncate text-xs text-foreground/50" title={value?.fileName}>{value?.fileName || "支持 JPG、PNG、WebP"}</p>
        <div className="mb-4 flex flex-wrap gap-2"><Button icon={<Upload className="size-3.5" />} loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>{value ? `替换${label}参考图` : `上传${label}参考图`}</Button>{value ? <Button disabled={disabled} onClick={() => onChange(undefined)}>清除</Button> : null}</div>
        <input ref={inputRef} aria-label={`上传${label}人脸参考图`} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }} />
        <label className="mb-2 block text-xs" htmlFor={`face-preset-${role}`}>应用到角色（可多选不同造型版本）</label>
        <Select id={`face-preset-${role}`} aria-label={`${label}绑定角色`} mode="multiple" className="w-full" value={value?.assetIds || []} disabled={disabled || !value} placeholder={value ? "选择对应角色" : "请先上传人脸图"} optionFilterProp="label" options={[...characters.map((asset) => ({ value: asset.id, label: asset.title, disabled: otherIds.includes(asset.id) })), ...missingIds.map((assetId) => ({ value: assetId, label: "已移出项目的角色（请移除）" }))]} onChange={(assetIds: string[]) => value && onChange({ ...value, assetIds })} />
        <p className="mt-2 text-xs text-foreground/50">{value?.assetIds.length ? `已绑定 ${value.assetIds.length} 个角色，生成时使用此面孔。` : "未绑定角色，暂不应用此面孔。"}</p>
    </section>;
}
