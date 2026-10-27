import { Button, Form, Select, Tabs, Tooltip } from "antd";
import { AudioLines, ChevronRight, Coins, FileAudio, Send, Upload, X } from "lucide-react";
import { useId, useRef } from "react";
import { SUNO_MODELS, SUNO_OPERATIONS, type SunoOperation } from "@/lib/suno-contract";
import { StudioField } from "@/components/suno-field";
import { fieldValue, fieldVisible, STUDIO_GROUPS } from "./studio-helpers";

type Props = {
    operation: SunoOperation;
    values: Record<string, unknown>;
    errors: Record<string, string>;
    disabled: boolean;
    submitting: boolean;
    uploading: boolean;
    referenceFile: File | null;
    canUpload: boolean;
    onOperation: (id: string) => void;
    onValue: (key: string, value: unknown) => void;
    onFile: (file: File | null) => void;
    onUpload: () => void;
    onSubmit: () => void;
};

export function StudioParameters({ operation, values, errors, disabled, submitting, uploading, referenceFile, canUpload, onOperation, onValue, onFile, onUpload, onSubmit }: Props) {
    const fileInput = useRef<HTMLInputElement>(null);
    const operationId = useId();
    const fields = operation.fields.filter((field) => fieldVisible(field, values));
    const advancedFields = fields.filter((field) => field.type === "json" && field.key === "metadata_params");
    const regularFields = fields.filter((field) => !advancedFields.includes(field));
    const advancedError = advancedFields.some((field) => errors[field.key]);
    return (
        <section className="suno-studio-parameters" aria-label="创作参数">
            <div className="suno-studio-section-heading"><AudioLines size={16} /><h2>创作工作台</h2><span className="suno-studio-count">{SUNO_OPERATIONS.length} API</span></div>
            <Tabs className="suno-studio-group-tabs" size="small" activeKey={operation.group} items={STUDIO_GROUPS.map((group) => ({ key: group.value, label: group.label }))} onChange={(group) => {
                const first = SUNO_OPERATIONS.find((item) => item.group === group);
                if (first) onOperation(first.id);
            }} />
            <div className="suno-studio-parameter-scroll">
                <label className="suno-studio-label" htmlFor={operationId}>操作</label>
                <Select id={operationId} aria-label="Suno 操作" className="suno-studio-operation-select" value={operation.id} options={SUNO_OPERATIONS.filter((item) => item.group === operation.group).map((item) => ({ value: item.id, label: item.label }))} onChange={onOperation} disabled={disabled} showSearch optionFilterProp="label" />
                <div className="suno-studio-endpoint"><span>{operation.method}</span><code>{operation.path}</code></div>
                <Form layout="vertical" className="suno-studio-form" disabled={disabled} onFinish={onSubmit}>
                    {regularFields.map((field) => <StudioField key={field.key} field={field.key === "mv" ? { ...field, type: "select", options: field.options?.length ? field.options : SUNO_MODELS } : field.key === "upload_type" ? { ...field, options: field.options?.map((option) => ({ ...option, label: option.value === "MUSIC_COPYRIGHT" ? "版权上传 · 30 积分" : "普通上传 · NORMAL（依渠道支持）" })) } : /(^|\.)(ids|mashup_clip_ids)$/.test(field.key) ? { ...field, label: field.label.replace("（JSON 数组）", "（每行一个）") } : field} value={fieldValue(values, field.key)} error={errors[field.key]} disabled={disabled} onChange={(value) => onValue(field.key, value)} />)}
                    {operation.id === "post-suno-uploads-audio" && values.upload_type === "MUSIC_COPYRIGHT" && <div className="suno-studio-upload-cost"><Coins size={15} /><span>版权上传 · 本次消耗 30 积分</span></div>}
                    {advancedFields.length > 0 && <details className="suno-studio-details" open={advancedError || undefined}>
                        <summary><ChevronRight size={14} />高级元数据{advancedError && <span className="suno-studio-error">待修正</span>}</summary>
                        {advancedFields.map((field) => <StudioField key={field.key} field={field} value={fieldValue(values, field.key)} error={errors[field.key]} disabled={disabled} onChange={(value) => onValue(field.key, value)} />)}
                    </details>}
                </Form>
                <section className="suno-studio-reference" aria-label="本地参考音频">
                    <div className="suno-studio-section-heading"><FileAudio size={15} /><h3>参考音频</h3><Tooltip title="选择本地音频"><Button type="text" aria-label="选择本地音频" icon={<Upload size={15} />} disabled={disabled || uploading} onClick={() => fileInput.current?.click()} /></Tooltip></div>
                    <input ref={fileInput} className="suno-studio-hidden-input" type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac" aria-label="本地音频文件" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onFile(file);
                        event.target.value = "";
                    }} />
                    {referenceFile ? <div className="suno-studio-reference-file"><FileAudio size={16} /><span title={referenceFile.name}>{referenceFile.name}</span><Tooltip title="移除本地引用"><Button type="text" size="small" aria-label="移除本地引用" disabled={uploading} icon={<X size={14} />} onClick={() => onFile(null)} /></Tooltip></div> : <div className="suno-studio-reference-empty">未选择本地音频</div>}
                    {referenceFile && <Button block icon={<Upload size={14} />} loading={uploading} disabled={disabled || !canUpload} onClick={onUpload}>上传引用</Button>}
                </section>
            </div>
            <footer className="suno-studio-submit-bar">
                <Button block type="primary" size="large" icon={<Send size={16} />} loading={submitting} disabled={disabled || uploading} onClick={onSubmit}>{operation.method === "GET" || operation.id === "post-suno-fetch" ? "查询" : "提交"}{operation.label}</Button>
            </footer>
        </section>
    );
}
