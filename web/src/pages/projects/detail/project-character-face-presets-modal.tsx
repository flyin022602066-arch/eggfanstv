import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { CharacterFacePresetFields } from "@/components/assets/character-face-preset-fields";
import { parseCharacterFacePresets, type CharacterFacePreset, type CharacterFacePresets, type CharacterFaceRole } from "@/lib/project-character-face-presets";
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
        {query.data ? <CharacterFacePresetFields presets={presets} characters={query.data.characters} disabled={busy} uploading={uploading} onChange={change} onUpload={(role, file) => void upload(role, file)} /> : null}
        {error ? <Alert className="mt-4" type="error" showIcon title={error} /> : null}
    </AppModal>;
}
