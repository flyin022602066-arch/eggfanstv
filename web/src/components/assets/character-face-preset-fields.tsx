import { useId, useRef } from "react";
import { Button, Select } from "antd";
import { Upload, UserRound } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { CHARACTER_FACE_ROLES, characterFaceRoleLabels, type CharacterFacePreset, type CharacterFacePresets, type CharacterFaceRole } from "@/lib/project-character-face-presets";

type Props = {
    presets: CharacterFacePresets;
    characters: { id: string; title: string }[];
    disabled: boolean;
    uploading: CharacterFaceRole | null;
    onChange: (role: CharacterFaceRole, value: CharacterFacePreset | undefined) => void;
    onUpload: (role: CharacterFaceRole, file: File) => void;
};

export function CharacterFacePresetFields({ presets, characters, disabled, uploading, onChange, onUpload }: Props) {
    return <div className="grid gap-4 sm:grid-cols-2">{CHARACTER_FACE_ROLES.map((role) => <FacePresetSlot key={role} role={role} value={presets[role]} characters={characters} otherIds={presets[role === "male" ? "female" : "male"]?.assetIds || []} disabled={disabled} uploading={uploading === role} onChange={(value) => onChange(role, value)} onUpload={(file) => onUpload(role, file)} />)}</div>;
}

function FacePresetSlot({ role, value, characters, otherIds, disabled, uploading, onChange, onUpload }: { role: CharacterFaceRole; value?: CharacterFacePreset; characters: Props["characters"]; otherIds: string[]; disabled: boolean; uploading: boolean; onChange: (value: CharacterFacePreset | undefined) => void; onUpload: (file: File) => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const selectId = useId();
    const label = characterFaceRoleLabels[role];
    const characterIds = new Set(characters.map((asset) => asset.id));
    const missingIds = value?.assetIds.filter((assetId) => !characterIds.has(assetId)) || [];
    return <section className="min-w-0 rounded-lg border border-border bg-surface-active p-4" aria-label={`${label}人脸预设`}>
        <h3 className="mb-3 flex items-center gap-2 font-medium"><UserRound className="size-4" />{label}人脸参考</h3>
        <div className="mb-3 flex h-52 items-center justify-center overflow-hidden rounded-lg bg-surface">{value ? <CachedResourceImage key={value.resourceId} eager storageKey={`resource:${value.resourceId}`} alt={`${label}人脸参考图`} className="max-h-52 max-w-full object-contain" fallback={<span className="text-xs text-foreground/50">图片无法读取，请重新上传</span>} loadingFallback={<span className="text-xs text-foreground/50">读取参考图…</span>} /> : <span className="text-xs text-foreground/50">未设置人脸参考图</span>}</div>
        <p className="mb-3 truncate text-xs text-foreground/50" title={value?.fileName}>{value?.fileName || "支持 JPG、PNG、WebP"}</p>
        <div className="mb-4 flex flex-wrap gap-2"><Button icon={<Upload className="size-3.5" />} loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>{value ? `替换${label}参考图` : `上传${label}参考图`}</Button>{value ? <Button disabled={disabled} onClick={() => onChange(undefined)}>清除</Button> : null}</div>
        <input ref={inputRef} aria-label={`上传${label}人脸参考图`} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }} />
        <label className="mb-2 block text-xs" htmlFor={selectId}>应用到角色（可多选不同造型版本）</label>
        <Select id={selectId} aria-label={`${label}绑定角色`} mode="multiple" className="w-full" value={value?.assetIds || []} disabled={disabled || !value} placeholder={value ? "选择对应角色" : "请先上传人脸图"} optionFilterProp="label" options={[...characters.map((asset) => ({ value: asset.id, label: asset.title, disabled: otherIds.includes(asset.id) })), ...missingIds.map((assetId) => ({ value: assetId, label: "已移除的角色（请移除）" }))]} onChange={(assetIds: string[]) => value && onChange({ ...value, assetIds })} />
        <p className="mt-2 text-xs text-foreground/50">{value?.assetIds.length ? `已绑定 ${value.assetIds.length} 个角色，生成时使用此面孔。` : "未绑定角色，暂不应用此面孔。"}</p>
    </section>;
}
