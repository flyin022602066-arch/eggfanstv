import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, AutoComplete, Button, Form, Input, Select } from "antd";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { createProjectReferenceAsset } from "@/services/project-prop-creation";
import { ProjectAssetImageModal, type ProjectAssetImageSubmission } from "./project-asset-image-modal";
import { submitProjectAssetImage } from "./project-asset-image-generation";

type PropValues = { name: string; unitId?: string; description?: string; aliases?: string };

export function ProjectPropCreateModal({ detail, unitId, initialName = "", category = "prop", onClose, onSaved }: { detail: ProjectDetail; unitId?: string; initialName?: string; category?: "prop" | "environment"; onClose: () => void; onSaved: () => Promise<void> }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<PropValues>();
    const [generateAsset, setGenerateAsset] = useState<ProjectAsset | null>(null);
    const label = category === "environment" ? "场景" : "道具";
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
            const result = await createProjectReferenceAsset({ ...values, projectId: detail.project.id, category });
            return { ...result, generate };
        },
        onSuccess: (result) => {
            void refresh().catch(() => message.warning(`${label}已保存，请刷新资产列表`));
            message.success(result.reused ? `已找到同名${label}，可直接补充参考图` : `${label}已保存；有参考图后点击补齐本章资产自动绑定`);
            if (result.generate) setGenerateAsset(result.asset);
            else onClose();
        },
        onError: (error) => { if (error instanceof Error) message.error(error.message); },
    });
    const generate = useMutation({
        mutationFn: (input: ProjectAssetImageSubmission) => submitProjectAssetImage(detail.project, input),
        onSuccess: () => { void refresh().catch(() => message.warning("生图任务已提交，请刷新任务列表")); message.success(`${label}生图已提交，完成后点击补齐本章资产`); onClose(); },
        onError: (error) => message.error(error instanceof Error ? error.message : `${label}生图提交失败`),
    });

    if (generateAsset) return <ProjectAssetImageModal asset={generateAsset} project={detail.project} submitting={generate.isPending} onClose={onClose} onGenerate={(input) => generate.mutate(input)} />;
    return <AppModal open title={`新增${label}`} width={560} onCancel={() => !save.isPending && onClose()} footer={<div className="flex flex-wrap justify-end gap-2"><Button disabled={save.isPending} onClick={onClose}>取消</Button><Button loading={save.isPending && !save.variables?.generate} disabled={save.isPending} onClick={() => save.mutate({ generate: false })}>{`仅保存${label}`}</Button><Button type="primary" loading={save.isPending && save.variables?.generate} disabled={save.isPending} onClick={() => save.mutate({ generate: true })}>{`保存并配置${label}图`}</Button></div>}>
        <p className="mb-4 text-xs text-foreground/55">名称或别名与分镜中的{label}名称保持一致。已有同名{label}会直接复用，补好图片后点击「补齐本章资产」自动关联对应镜头。</p>
        <Form form={form} layout="vertical" disabled={save.isPending} initialValues={{ name: initialName, unitId: units.some((unit) => unit.id === unitId) ? unitId : "" }}>
            <Form.Item name="name" label={`${label}名称`} rules={[{ required: true, whitespace: true, message: `请输入${label}名称` }]}><AutoComplete options={detail.assets.filter((asset) => asset.category === category).map((asset) => ({ value: asset.title }))} filterOption={(input, option) => Boolean(option?.value.includes(input))}><Input aria-label={`${label}名称`} autoFocus maxLength={100} placeholder={category === "environment" ? "例如：文化楼台阶下（同名场景可补图）" : "例如：残缺古籍（同名道具可补图）"} /></AutoComplete></Form.Item>
            <Form.Item name="unitId" label="所属集数"><Select aria-label={`${label}所属集数`} showSearch optionFilterProp="label" options={[{ value: "", label: "未关联集数" }, ...units.map((unit, index) => ({ value: unit.id, label: `第${index + 1}集 · ${unit.title}` }))]} /></Form.Item>
            <Form.Item name="aliases" label="别名（可选）"><Input aria-label={`${label}别名`} placeholder="与分镜用词对应，用逗号分隔" /></Form.Item>
            <Form.Item name="description" label="外观与生图设定（可选）"><Input.TextArea aria-label={`${label}外观设定`} rows={4} placeholder={category === "environment" ? "地点、空间布局、内外景、光照及需要保持一致的细节" : "材质、颜色、年代、造型及需要保持一致的细节"} /></Form.Item>
        </Form>
    </AppModal>;
}
