import { ConfigProvider, Segmented, Select } from "antd";
import { ModelPicker } from "@/components/model-picker";
import { SkillRuntimePicker } from "@/components/skills/skill-runtime-picker";
import { Callout } from "@/components/ui/product/callout";
import { navigateToSettings } from "@/lib/settings-navigation";
import type { ChapterDialogueConstraintMode, ChapterStoryboardMode } from "@/lib/chapter-storyboard-mode";
import type { SystemPresentationSettings } from "@/lib/chapter-system-presentation";
import type { Skill } from "@/services/api/skills";
import type { AiConfig } from "@/stores/use-config-store";
import { ProjectSystemPresentationSettings } from "./project-system-presentation-settings";

export function ChapterGenerationSettings({ config, textModel, textModelUnavailable, onTextModelChange, systemPresentation, onSystemPresentationChange, skills, skillsLoading, selectedSkillIds, onSkillsChange, storyboardMode, onStoryboardModeChange, dialogueConstraintMode, onDialogueConstraintModeChange, includeStoryboard = true, disabled = false }: {
    config: AiConfig; textModel: string; textModelUnavailable: boolean; onTextModelChange: (model: string) => void;
    systemPresentation: SystemPresentationSettings; onSystemPresentationChange: (value: SystemPresentationSettings) => void;
    skills: Skill[]; skillsLoading: boolean; selectedSkillIds: string[]; onSkillsChange: (ids: string[]) => void;
    storyboardMode: ChapterStoryboardMode; onStoryboardModeChange: (mode: ChapterStoryboardMode) => void;
    dialogueConstraintMode: ChapterDialogueConstraintMode; onDialogueConstraintModeChange: (mode: ChapterDialogueConstraintMode) => void;
    includeStoryboard?: boolean; disabled?: boolean;
}) {
    return <ConfigProvider componentDisabled={disabled}>
        <fieldset disabled={disabled} className="grid min-w-0 gap-4 border-0 p-0" aria-label="章节生成设置">
            <ProjectSystemPresentationSettings value={systemPresentation} onChange={onSystemPresentationChange} />
            <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground/68">文本模型</span>
                <ModelPicker config={config} capability="text" value={textModel} onChange={onTextModelChange} variant="creation" fullWidth placeholder={includeStoryboard ? "选择用于生成分镜的文本模型" : "选择用于提取角色、场景与道具的文本模型"} onMissingConfig={() => navigateToSettings({ continueCreation: true })} />
                <p className="mt-2 text-xs text-foreground/50">未选择时跟随模型配置；选择后记住本项目的文本模型。</p>
            </label>
            {textModelUnavailable ? <Callout tone="warning" title="文本模型不可用">上次选择的文本模型当前不可用，请重新选择；不会自动切换到其他模型。</Callout> : null}
            {includeStoryboard ? <>
                <div>
                    <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-foreground/68">分镜技能</span>
                        <SkillRuntimePicker profile="shortDrama" skills={skills} loading={skillsLoading} value={selectedSkillIds} onChange={onSkillsChange} placeholder="选择本项目分镜默认使用的技能" />
                    </label>
                    <p className="mt-2 text-[var(--fs-tiny)] leading-5 text-foreground/42">可不选，最多 5 个，建议选择互补技能，避免重复规则。已按项目自动记忆，后续各集及重启后沿用；修改后作为本项目新的默认选择。生成时按需读取技能，并记录实际使用的版本和文件。</p>
                </div>
                <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-foreground/68">分镜拆解模式</span>
                    <Select className="w-full" aria-label="分镜拆解模式" value={storyboardMode} onChange={onStoryboardModeChange} options={[{ value: "standard", label: "常规精细分镜" }, { value: "continuous_30s", label: "30 秒连续分镜（2.5 视频模型）" }]} />
                    <span className="mt-2 block text-xs leading-5 text-foreground/50">{storyboardMode === "continuous_30s" ? "每段总时长 30 秒，优先按自然语速和完整对白分配剧情；对白密集时增加连续分镜，不强塞 800–1000 字原文。资产与声音说明优先精简至 600 字符以内，镜头已有台词不重复附加；提示词整体不受此字数限制。按整体设定、镜头1 / 镜头2 / 镜头3 …、结尾约束组织，每镜写起幅 → 落幅、单一运镜、动作与声音，不写秒数或阶段。保留场景道具绑定。已记住本项目的选择。" : "按动作与对白拆分短镜头，每镜绑定对应场景和实际可见道具。"}</span>
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-foreground/68">对白字数规则</span>
                    <Segmented block aria-label="分镜对白限制模式" value={dialogueConstraintMode} onChange={(value) => onDialogueConstraintModeChange(value as ChapterDialogueConstraintMode)} options={[{ value: "paced", label: "当前节奏限制" }, { value: "unrestricted", label: "不限制对白字数" }]} />
                    <span className="mt-2 block text-xs leading-5 text-foreground/50">{dialogueConstraintMode === "paced" ? "按当前对白节奏规则评估承载量；仍保留完整台词，超出时在自然边界安排后续分镜。此选择会记住并沿用到本项目后续各集。" : "不套用对白字数区间、语速换算或超字阈值；按剧情和自然话轮拆解，仍保留原文台词，不截断、不删改。此选择会记住并沿用到本项目后续各集。"}</span>
                </label>
            </> : null}
        </fieldset>
    </ConfigProvider>;
}
