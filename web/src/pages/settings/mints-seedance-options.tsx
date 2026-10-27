import { Input, InputNumber, Select, Switch } from "antd";

export function MintsSeedanceOptions({ value = {}, onChange }: { value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
    const update = (key: string, next: unknown) => {
        const result = { ...value };
        if (next === undefined || next === null || next === "") delete result[key];
        else result[key] = next;
        onChange(result);
    };
    return <section className="space-y-3 rounded-md bg-surface-active p-3">
        <div className="text-xs font-medium">Mints Seedance 专属参数</div>
        <label className="block space-y-1 text-xs">
            <span>资产组 ID（可选）</span>
            <Input aria-label="Mints 资产组 ID" value={typeof value.asset_group_id === "string" ? value.asset_group_id : ""} placeholder="留空使用平台默认素材组" onChange={(event) => update("asset_group_id", event.target.value.trim())} />
        </label>
        <p className="text-xs text-foreground/50">生成时自动上传 Uguu 并绑定平台 URI。真人素材需先在平台完成本人认证，再填写认证组 ID。</p>
        <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs"><span>随机种子</span><InputNumber aria-label="Mints 随机种子" className="w-full" precision={0} value={typeof value.seed === "number" ? value.seed : null} placeholder="平台默认" onChange={(next) => update("seed", next)} /></label>
            <label className="space-y-1 text-xs"><span>服务等级</span><Select aria-label="Mints 服务等级" className="w-full" allowClear placeholder="平台默认" value={typeof value.service_tier === "string" ? value.service_tier : undefined} options={[{ value: "default", label: "default" }, { value: "flex", label: "flex" }]} onChange={(next) => update("service_tier", next)} /></label>
        </div>
        <div className="flex items-center justify-between text-xs"><span>固定镜头</span><Switch aria-label="Mints 固定镜头" checked={value.camera_fixed === true} onChange={(next) => update("camera_fixed", next)} /></div>
        <div className="flex items-center justify-between text-xs"><span>草稿模式</span><Switch aria-label="Mints 草稿模式" checked={value.draft === true} onChange={(next) => update("draft", next)} /></div>
    </section>;
}
