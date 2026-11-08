import { useEffect, useMemo, useState } from "react";
import { Button, Form, Select } from "antd";

import { AppModal } from "@/components/ui/product/app-modal";
import {
    compatibleProjectStyleCharacters,
    compileCanvasStylePreset,
    defaultProjectStyleSelection,
    normalizeProjectStyleSelection,
    projectStyleMedia,
    projectStyleTones,
    projectStyleWorlds,
    type CanvasStylePreset,
    type ProjectStyleSelection,
} from "@/lib/canvas/canvas-style-system";

export function ProjectStyleComposerModal({ open, initialSelection, applying, onClose, onApply, onEdit }: {
    open: boolean;
    initialSelection?: ProjectStyleSelection;
    applying: boolean;
    onClose: () => void;
    onApply: (preset: CanvasStylePreset) => void;
    onEdit: (preset: CanvasStylePreset) => void;
}) {
    const [selection, setSelection] = useState(defaultProjectStyleSelection);
    useEffect(() => {
        if (open) setSelection(normalizeProjectStyleSelection(initialSelection || defaultProjectStyleSelection));
    }, [open, initialSelection]);
    const preset = useMemo(() => compileCanvasStylePreset(selection), [selection]);
    const characters = compatibleProjectStyleCharacters(selection.medium);
    const changeSelection = (patch: Partial<ProjectStyleSelection>) => setSelection((current) => normalizeProjectStyleSelection({ ...current, ...patch }));
    const options = (items: Array<{ id: string; label: string; description: string }>) => items.map((item) => ({ value: item.id, label: item.label, title: item.description }));

    return <AppModal open={open} title="组合项目画风" width={760} centered onCancel={onClose} destroyOnHidden footer={<div className="flex flex-wrap justify-end gap-2"><Button onClick={onClose}>取消</Button><Button disabled={applying} onClick={() => onEdit(preset)}>编辑完整规范并保存</Button><Button type="primary" disabled={applying} onClick={() => onApply(preset)}>应用组合画风</Button></div>}>
        <p className="mb-4 text-xs leading-5 text-foreground/60">题材与视觉媒介分别选择。同一故事可做真人、3D或二维版本；角色、场景、道具和后续视频统一沿用所选媒介。</p>
        <Form layout="vertical" className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <Form.Item label="题材世界"><Select aria-label="题材世界" virtual={false} value={selection.world} options={options(projectStyleWorlds)} onChange={(world) => changeSelection({ world })} /></Form.Item>
            <Form.Item label="叙事气质"><Select aria-label="叙事气质" virtual={false} value={selection.tone} options={options(projectStyleTones)} onChange={(tone) => changeSelection({ tone })} /></Form.Item>
            <Form.Item label="视觉媒介"><Select aria-label="视觉媒介" virtual={false} value={selection.medium} options={options(projectStyleMedia)} onChange={(medium) => changeSelection({ medium })} /></Form.Item>
            <Form.Item label="角色造型"><Select aria-label="角色造型" virtual={false} value={selection.character} options={options(characters)} onChange={(character) => changeSelection({ character })} /></Form.Item>
        </Form>
        <div className="rounded-md border border-foreground/10 bg-foreground/5 p-3" aria-label="组合画风预览">
            <h3 className="text-sm font-semibold">{preset.title}</h3>
            <p className="mt-1 text-xs leading-5 text-foreground/60">{preset.description}</p>
            <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-foreground/70 sm:max-h-60" tabIndex={0} aria-label="组合画风完整规范">{preset.prompt}</div>
        </div>
    </AppModal>;
}
