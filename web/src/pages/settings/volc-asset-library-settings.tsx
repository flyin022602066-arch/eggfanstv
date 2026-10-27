import { App, Button, Form, Input, Switch } from "antd";
import { useState } from "react";
import { commitModelConfig, flushModelConfig, getModelConfigPersistenceState } from "@/services/model-config-repository";
import { useConfigStore } from "@/stores/use-config-store";
import { VolcAssetLibraryButton } from "@/components/volc-asset-library-modal";

export function VolcAssetLibrarySettings() {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [saving, setSaving] = useState(false);
    const library = config.volcAssetLibrary;
    const patch = (value: Partial<typeof library>) => updateConfig("volcAssetLibrary", { ...library, ...value });
    const save = async () => {
        setSaving(true);
        try {
            await commitModelConfig(useConfigStore.getState().config);
            await flushModelConfig();
            if (getModelConfigPersistenceState().dirty) throw new Error(getModelConfigPersistenceState().error || "配置尚未保存");
            message.success("火山资产库配置已保存");
        } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
        finally { setSaving(false); }
    };
    return <section className="settings-section mb-3">
        <div className="mb-3 flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold">火山 URI 资产库</h3><p className="mt-1 text-xs text-foreground/55">按文档使用山河资产服务。图片自动经 Uguu 上传并获取火山 URI；视频生成仍使用原视频渠道。</p></div>
            <Switch aria-label="启用火山 URI 资产库" checked={library.enabled} onChange={(enabled) => patch({ enabled })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
            <Form.Item label="资产上传 Key" htmlFor="volc-library-key" extra="填写文档的 asset_material_upload_api_key，独立于 Eggfans 视频 Key。">
                <Input.Password id="volc-library-key" aria-label="火山资产上传 Key" autoComplete="off" value={library.apiKey === "__BEEFTV_REDACTED__" ? "" : library.apiKey} placeholder={library.apiKey === "__BEEFTV_REDACTED__" ? "已保存；留空保留，输入可替换" : "填写资产服务 Bearer Key"} onChange={(event) => patch({ apiKey: event.target.value })} />
            </Form.Item>
            <Form.Item label="资产服务 Base URL" htmlFor="volc-library-url"><Input id="volc-library-url" value={library.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} /></Form.Item>
            <Form.Item label="素材组名称" htmlFor="volc-library-group"><Input id="volc-library-group" value={library.groupName} maxLength={120} onChange={(event) => patch({ groupName: event.target.value })} /></Form.Item>
            <Form.Item label="项目名称" htmlFor="volc-library-project" extra="按文档使用 default；其他值必须是火山已开通的项目名，不是本地项目标题。"><Input id="volc-library-project" value={library.projectName} onChange={(event) => patch({ projectName: event.target.value })} /></Form.Item>
        </div>
        <p className="mb-3 text-xs text-foreground/55">原图与 URI 记录自动保存至项目根目录 asset-library/volc；重启后可在本地资产库继续使用。文档的此接口支持图片资产，视频和音频参考继续使用公网 URL。</p>
        <div className="flex flex-wrap gap-2"><Button loading={saving} onClick={() => void save()}>保存资产库配置</Button><VolcAssetLibraryButton /></div>
    </section>;
}
