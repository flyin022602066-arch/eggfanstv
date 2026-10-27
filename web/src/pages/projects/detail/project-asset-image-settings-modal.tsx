import { useState } from "react";
import { App, Button, Tabs } from "antd";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { PROJECT_ASSET_IMAGE_CATEGORIES, projectAssetImageCategoryLabels, type ProjectAssetImageCategory } from "@/lib/project-asset-image-preferences";
import type { Project } from "@/services/api/projects";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { commitModelConfig, flushModelConfig, getModelConfigPersistenceState } from "@/services/model-config-repository";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { resolveProjectAssetImagePreset } from "./project-asset-image";
import { ProjectAssetImageFields } from "./project-asset-image-fields";

export function ProjectAssetImageSettingsModal({ project, initialCategory = "character", onClose }: { project: Project; initialCategory?: ProjectAssetImageCategory; onClose: () => void }) {
    const config = useEffectiveConfig();
    const { message } = App.useApp();
    const [presets, setPresets] = useState(() => Object.fromEntries(PROJECT_ASSET_IMAGE_CATEGORIES.map((category) => [category, resolveProjectAssetImagePreset(config, project, category)])) as Required<NonNullable<typeof config.projectAssetImagePresets>>);
    const [saving, setSaving] = useState(false);
    const save = async () => {
        setSaving(true);
        try {
            const store = useConfigStore.getState();
            store.updateConfig("projectAssetImagePresets", presets);
            if (isLocalWorkspaceMode()) { await commitModelConfig(useConfigStore.getState().config); await flushModelConfig(); }
            if (getModelConfigPersistenceState().status === "error") throw new Error(getModelConfigPersistenceState().error || "本地配置保存失败，请重试");
            message.success("三类资产生图设置已保存");
            onClose();
        } catch (error) { message.error(error instanceof Error ? error.message : "生图设置保存失败，请重试"); }
        finally { setSaving(false); }
    };
    return <AppModal open title="统一生图设置" width={720} onCancel={() => !saving && onClose()} footer={<div className="flex justify-end gap-2"><Button disabled={saving} onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={() => void save()}>保存设置</Button></div>}>
        <p className="mb-3 text-xs text-foreground/55">同类资产统一使用这里的参数，适用于各项目的单张和批量生图；三类模型独立保存，可单独为场景选择其他模型。每个资产仍保留自己的设定与项目画风。</p>
        <Tabs defaultActiveKey={initialCategory} items={PROJECT_ASSET_IMAGE_CATEGORIES.map((category) => ({ key: category, label: `${projectAssetImageCategoryLabels[category]}参数`, children: <ProjectAssetImageFields config={config} value={presets[category]} disabled={saving} onChange={(value) => setPresets((current) => ({ ...current, [category]: value }))} /> }))} />
    </AppModal>;
}
