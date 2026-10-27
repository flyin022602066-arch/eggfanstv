import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, AutoComplete, Button, Form, Input, Select } from "antd";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { createProjectPropAsset } from "@/services/project-prop-creation";
import { ProjectAssetImageModal, type ProjectAssetImageSubmission } from "./project-asset-image-modal";
import { submitProjectAssetImage } from "./project-asset-image-generation";

type PropValues = { name: string; unitId?: string; description?: string; aliases?: string };

export function ProjectPropCreateModal({ detail, unitId, initialName = "", onClose, onSaved }: { detail: ProjectDetail; unitId?: string; initialName?: string; onClose: () => void; onSaved: () => Promise<void> }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<PropValues>();
    const [generateAsset, setGenerateAsset] = useState<ProjectAsset | null>(null);
    const units = detail.units.slice().sort((left, right) => left.position - right.position);
    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["project", detail.project.id, "assets"] }),
            queryClient.invalidateQueries({ queryKey: ["project", detail.project.id, "asset-candidates"] }),
            onSaved(),
        ]);
    };
    const save = useMutation({
        mutationFn: async ({ generate }: { generate: boolean }) => {
            const values = await form.validateFields();
            const result = await createProjectPropAsset({ ...values, projectId: detail.project.id });
            return { ...result, generate };
        },
        onSuccess: (result) => {
            void refresh().catch(() => message.warning("道具已保存，请刷新资产列表"));
            message.success(result.reused ? "已找到同名道具，可直接补充道具图" : "道具已保存；有参考图后点击补齐本章资产自动绑定");
            if (result.generate) setGenerateAsset(result.asset);
            else onClose();
        },
        onError: (error) => { if (error instanceof Error) message.error(error.message); },
    });
    const generate = useMutation({
        mutationFn: (input: ProjectAssetImageSubmission) => submitProjectAssetImage(detail.project, input),
        onSuccess: () => { void refresh().catch(() => message.warning("生图任务已提交，请刷新任务列表")); message.success("道具生图已提交，完成后点击补齐本章资产"); onClose(); },
        onError: (error) => message.error(error instanceof Error ? error.message : "道具生图提交失败"),
    });

    if (generateAsset) return <ProjectAssetImageModal asset={generateAsset} project={detail.project} submitting={generate.isPending} onClose={onClose} onGenerate={(input) => generate.mutate(input)} />;
    return <AppModal open title="新增道具" width={560} onCancel={() => !save.isPending && onClose()} footer={<div className="flex flex-wrap justify-end gap-2"><Button disabled={save.isPending} onClick={onClose}>取消</Button><Button loading={save.isPending && !save.variables?.generate} disabled={save.isPending} onClick={() => save.mutate({ generate: false })}>仅保存道具</Button><Button type="primary" loading={save.isPending && save.variables?.generate} disabled={save.isPending} onClick={() => save.mutate({ generate: true })}>保存并配置道具图</Button></div>}>
        <p className="mb-4 text-xs text-foreground/55">名称或别名与分镜中的道具名称保持一致。已有同名道具会直接复用，补好图片后点击「补齐本章资产」自动关联对应镜头。</p>
        <Form form={form} layout="vertical" disabled={save.isPending} initialValues={{ name: initialName, unitId: units.some((unit) => unit.id === unitId) ? unitId : "" }}>
            <Form.Item name="name" label="道具名称" rules={[{ required: true, whitespace: true, message: "请输入道具名称" }]}><AutoComplete options={detail.assets.filter((asset) => asset.category === "prop").map((asset) => ({ value: asset.title }))} filterOption={(input, option) => Boolean(option?.value.includes(input))}><Input aria-label="道具名称" autoFocus maxLength={100} placeholder="例如：残缺古籍（同名道具可补图）" /></AutoComplete></Form.Item>
            <Form.Item name="unitId" label="所属集数"><Select aria-label="道具所属集数" showSearch optionFilterProp="label" options={[{ value: "", label: "未关联集数" }, ...units.map((unit, index) => ({ value: unit.id, label: `第${index + 1}集 · ${unit.title}` }))]} /></Form.Item>
            <Form.Item name="aliases" label="别名（可选）"><Input aria-label="道具别名" placeholder="与分镜用词对应，用逗号分隔，例如：古籍、旧书" /></Form.Item>
            <Form.Item name="description" label="外观与生图设定（可选）"><Input.TextArea aria-label="道具外观设定" rows={4} placeholder="材质、颜色、年代、造型及需要保持一致的细节" /></Form.Item>
        </Form>
    </AppModal>;
}
