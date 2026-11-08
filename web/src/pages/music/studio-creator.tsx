import { Alert, Button, Input, Select } from "antd";
import { AudioLines, FileText, Lightbulb, LoaderCircle, Tags, WandSparkles, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { buildMusicWritingPrompt, MUSIC_WRITING_SKILLS, type MusicWritingOutput } from "./studio-helpers";

const OUTPUT_OPTIONS: Array<{ value: MusicWritingOutput; label: string; icon: ReactNode }> = [
    { value: "inspiration", label: "灵感描述", icon: <Lightbulb size={15} /> },
    { value: "lyrics", label: "歌词", icon: <FileText size={15} /> },
    { value: "tags", label: "曲风标签", icon: <Tags size={15} /> },
];

type Props = {
    onApply: (kind: MusicWritingOutput, text: string) => void;
    busy: boolean;
};

export function StudioCreator({ onApply, busy }: Props) {
    const config = useConfigStore((state) => state.config);
    const configReady = useConfigStore((state) => state.isAiConfigReady);
    const textModels = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const [model, setModel] = useState(config.textModel);
    const [skillId, setSkillId] = useState(MUSIC_WRITING_SKILLS[0].id);
    const [output, setOutput] = useState<MusicWritingOutput>("inspiration");
    const [context, setContext] = useState("");
    const [result, setResult] = useState("");
    const [error, setError] = useState("");
    const [generating, setGenerating] = useState(false);
    const controller = useRef<AbortController | null>(null);
    const skill = MUSIC_WRITING_SKILLS.find((item) => item.id === skillId) || MUSIC_WRITING_SKILLS[0];
    const selectedModel = textModels.includes(model) ? model : textModels.includes(config.textModel) ? config.textModel : textModels[0] || "";

    useEffect(() => {
        if (selectedModel && model !== selectedModel) setModel(selectedModel);
    }, [selectedModel, model]);

    useEffect(() => () => controller.current?.abort(), []);

    const generate = async () => {
        if (generating || busy) return;
        if (!context.trim()) { setError("请先填写创作素材"); return; }
        if (!selectedModel || !configReady(config, selectedModel)) { setError("请先在模型配置中设置可用的文本模型"); return; }
        const abort = new AbortController();
        controller.current = abort;
        setGenerating(true);
        setError("");
        setResult("");
        try {
            const response = await runBackendGenerationTask({
                mode: "text",
                prompt: buildMusicWritingPrompt(skill, output, context),
                config: { ...config, model: selectedModel, textModel: selectedModel },
                signal: abort.signal,
                streamText: true,
                metadata: { source: "suno-music-creator", skillId: skill.id, output },
                onTextDelta: (fullText) => setResult(fullText),
            });
            if (response.text?.trim()) setResult(response.text.trim());
            else if (!abort.signal.aborted) setError("文本模型没有返回创作内容");
        } catch (cause) {
            if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "创作请求失败");
        } finally {
            if (controller.current === abort) controller.current = null;
            setGenerating(false);
        }
    };

    return <section className="suno-studio-creator" aria-label="AI 音乐创作助手">
        <div className="suno-studio-section-heading"><WandSparkles size={17} /><h2>AI 音乐创作</h2><span className="suno-studio-count">内置 Skill</span></div>
        <div className="suno-studio-creator-content">
            <div className="suno-studio-creator-controls">
                <label className="suno-studio-label" htmlFor="suno-creator-skill">创作 Skill</label>
                <Select id="suno-creator-skill" aria-label="音乐创作 Skill" value={skillId} options={MUSIC_WRITING_SKILLS.map((item) => ({ value: item.id, label: item.name }))} onChange={setSkillId} disabled={generating || busy} />
                <p className="suno-studio-muted">{skill.description}</p>
                <label className="suno-studio-label" htmlFor="suno-creator-output">产出类型</label>
                <Select id="suno-creator-output" aria-label="音乐创作产出类型" value={output} options={OUTPUT_OPTIONS.map((item) => ({ value: item.value, label: <span className="suno-studio-creator-option">{item.icon}{item.label}</span> }))} onChange={setOutput} disabled={generating || busy} />
                <label className="suno-studio-label" htmlFor="suno-creator-model">文本模型</label>
                <Select id="suno-creator-model" aria-label="音乐创作文本模型" value={selectedModel || undefined} placeholder="选择文本模型" options={textModels.map((item) => ({ value: item, label: modelOptionLabel(config, item) }))} onChange={setModel} disabled={generating || busy || !textModels.length} />
                {!textModels.length && <Alert type="warning" showIcon title={<>没有可用文本模型。<Link to="/settings">前往模型配置</Link></>} />}
                <label className="suno-studio-label" htmlFor="suno-creator-context">创作素材</label>
                <Input.TextArea id="suno-creator-context" aria-label="歌曲创作素材" value={context} onChange={(event) => setContext(event.target.value)} placeholder="主题、剧情、人物、情绪、语言或希望保留的句子" autoSize={{ minRows: 6, maxRows: 14 }} disabled={generating || busy} />
                <div className="suno-studio-creator-actions">
                    <Button type="primary" icon={generating ? <LoaderCircle size={15} /> : <AudioLines size={15} />} loading={generating} disabled={busy || !selectedModel || !context.trim()} onClick={() => void generate()}>{generating ? "创作中" : "生成草稿"}</Button>
                    {generating && <Button aria-label="停止文本创作" icon={<X size={15} />} onClick={() => controller.current?.abort()}>停止</Button>}
                </div>
                {error && <Alert type="error" showIcon title={error} />}
            </div>
            <div className="suno-studio-creator-result" aria-live="polite">
                <div className="suno-studio-creator-result-heading"><FileText size={15} /><h3>{output === "lyrics" ? "歌词草稿" : output === "tags" ? "风格设计" : "灵感描述"}</h3>{generating && <span className="suno-studio-count">流式生成中</span>}</div>
                {result ? <>
                    <pre>{result}</pre>
                    <Button icon={<FileText size={14} />} disabled={generating || busy} onClick={() => onApply(output, result)}>{output === "lyrics" ? "填入歌词" : output === "tags" ? "填入风格" : "填入灵感描述"}</Button>
                </> : <div className="suno-studio-empty"><WandSparkles size={28} /><span>创作结果会显示在这里</span></div>}
            </div>
        </div>
        <p className="suno-studio-creator-note">生成草稿会调用文本模型，不会提交 Suno 歌曲任务。</p>
    </section>;
}
