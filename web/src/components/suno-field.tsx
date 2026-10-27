import { Form, Input, InputNumber, Segmented, Select, Switch } from "antd";
import { useId } from "react";
import type { SunoField } from "@/lib/suno-contract";

type Props = {
    field: SunoField;
    value: unknown;
    error?: string;
    disabled?: boolean;
    onChange: (value: unknown) => void;
};

export function StudioField({ field, value, error, disabled, onChange }: Props) {
    const id = useId();
    const common = { id, disabled, "aria-label": field.label, "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined };
    const stringValue = value === undefined || value === null ? "" : String(value);
    let control;
    if (field.type === "boolean") {
        control = <Switch {...common} checked={value === true} onChange={onChange} />;
    } else if (field.type === "number") {
        control = <InputNumber {...common} min={field.min} max={field.max} step={field.step ?? 1} value={typeof value === "number" ? value : null} onChange={onChange} />;
    } else if (field.type === "select") {
        const options = field.options || [];
        control = /^(mode|creation_mode|musicMode|_mode)$/.test(field.key)
            ? <Segmented {...common} block options={options} value={stringValue} onChange={onChange} />
            : <Select {...common} getPopupContainer={(trigger) => trigger.parentElement!} options={options} value={stringValue || (options.some((option) => option.value === "") ? "" : undefined)} onChange={onChange} allowClear={!field.required} showSearch optionFilterProp="label" />;
    } else if (field.type === "json" && /(^|\.)(ids|mashup_clip_ids)$/.test(field.key)) {
        control = <Input.TextArea {...common} rows={3} value={Array.isArray(value) ? value.join("\n") : stringValue} onChange={(event) => onChange(event.target.value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))} />;
    } else if (field.type === "json") {
        control = <Input.TextArea {...common} className="suno-studio-json" autoSize={{ minRows: 4, maxRows: 16 }} spellCheck={false} value={typeof value === "string" ? value : value ? JSON.stringify(value, null, 2) : ""} onChange={(event) => {
            const raw = event.target.value;
            try { onChange(raw.trim() ? JSON.parse(raw) : undefined); } catch { onChange(raw); }
        }} />;
    } else if (field.type === "textarea") {
        control = <Input.TextArea {...common} className={field.key === "prompt" ? "suno-studio-lyrics-input" : undefined} autoSize={{ minRows: field.key === "prompt" ? 8 : 3, maxRows: 22 }} value={stringValue} onChange={(event) => onChange(event.target.value)} />;
    } else {
        control = <Input {...common} value={stringValue} onChange={(event) => onChange(event.target.value)} allowClear />;
    }
    return (
        <Form.Item className={field.type === "boolean" ? "suno-studio-switch-field" : undefined} label={field.label} htmlFor={id} required={field.required} validateStatus={error ? "error" : undefined} help={error ? <span id={`${id}-error`}>{error}</span> : undefined}>
            {control}
        </Form.Item>
    );
}
