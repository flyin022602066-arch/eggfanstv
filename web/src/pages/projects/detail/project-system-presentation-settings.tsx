import { Input, Segmented } from "antd";
import type { SystemPresentationSettings } from "@/lib/chapter-system-presentation";

export function ProjectSystemPresentationSettings({ value, onChange }: { value: SystemPresentationSettings; onChange: (value: SystemPresentationSettings) => void }) {
    return <div className="grid gap-3">
        <div>
            <span className="mb-1.5 block text-xs font-medium text-foreground/68">系统表现模式</span>
            <Segmented block aria-label="系统表现模式" value={value.mode} options={[{ value: "panel", label: "系统面板" }, { value: "character", label: "拟人化系统" }]} onChange={(mode) => onChange({ ...value, mode: mode as SystemPresentationSettings["mode"] })} />
            <p className="mt-2 text-xs leading-5 text-foreground/50">按项目记忆，后续各集沿用。修改只影响后续提取和分镜；已有资产与分镜可保留或由你重新生成。</p>
        </div>
        {value.mode === "character" ? <>
            <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground/68">系统角色名称</span><Input aria-label="系统角色名称" value={value.characterName} maxLength={80} onChange={(event) => onChange({ ...value, characterName: event.target.value })} placeholder="例如：小白" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground/68">系统形象设定</span><Input.TextArea aria-label="系统形象设定" value={value.characterAppearance} rows={2} maxLength={2000} onChange={(event) => onChange({ ...value, characterAppearance: event.target.value })} placeholder="例如：会说话的白狐狸，蓝色翅膀，可悬浮在主角身旁" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground/68">系统声音设定</span><Input.TextArea aria-label="系统声音设定" value={value.characterVoice} rows={2} maxLength={1000} onChange={(event) => onChange({ ...value, characterVoice: event.target.value })} placeholder="例如：清亮活泼的少女音，普通话，自然语速" /></label>
            <p className="text-xs leading-5 text-foreground/50">系统提取为角色，可生成形象图并绑定镜头。由该角色说出原文系统台词和状态，保持形象、音色一致，不凭空增加对白。</p>
        </> : <p className="text-xs leading-5 text-foreground/50">系统提取为界面道具，参考图只固定面板布局；文字、数值和提示音按各镜原文变化。</p>}
    </div>;
}
