import { Form } from "antd";
import { Link } from "react-router";
import { StudioField } from "@/components/suno-field";
import { sunoOperation } from "@/lib/suno-contract";
import { fieldValue, fieldVisible, updateStudioValues } from "@/lib/suno-form";
import { sunoMusicSettings } from "@/lib/suno-generation";

export function SunoMusicSettings({ value, model, onChange }: { value?: string; model?: string; onChange: (value: string) => void }) {
    const operation = sunoOperation("post-suno-submit-music");
    let values: Record<string, unknown>;
    try { values = sunoMusicSettings(value, model); } catch (error) {
        return <div role="alert">{error instanceof Error ? error.message : "音乐参数记录无效"}<button type="button" onClick={() => onChange("")}>重置音乐参数</button></div>;
    }
    return <section aria-label="Suno 音乐参数" data-canvas-no-zoom data-canvas-wheel-scroll>
        <p className="mb-3 text-xs">音乐描述或歌词填写在节点提示词中。模型版本、风格及参考片段在此设置。</p>
        <Form layout="vertical" component="div">
            {operation.fields.filter((field) => !["prompt", "gpt_description_prompt"].includes(field.key) && fieldVisible(field, values)).map((field) => <StudioField key={field.key} field={field} value={fieldValue(values, field.key)} onChange={(next) => onChange(JSON.stringify(updateStudioValues(operation, values, field.key, next)))} />)}
        </Form>
        <Link to="/music" className="text-sm underline">打开音乐导演台 · 分轨、歌词、歌手及全部工具</Link>
    </section>;
}
