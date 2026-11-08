import { App, Alert, Button, Collapse, Input, InputNumber, Popconfirm, Select, Space, Switch, Tabs, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { getHanbaoStatus, hanbaoAccountAction, hanbaoSMS, saveHanbaoSettings, type FeihuProject, type HanbaoAccount, type HanbaoOrder, type HanbaoSettings, type HanbaoStatus } from "@/services/api/hanbao";

const statusNames: Record<number, string> = { 1: "等待短信", 3: "已完成", 4: "失败", 5: "已释放", 6: "超时" };
const provinces = ["北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "宁夏", "新疆", "内蒙古", "广西", "西藏"];

export function HanbaoAccountManager({ onClose }: { onClose: () => void }) {
    const { message } = App.useApp();
    const [status, setStatus] = useState<HanbaoStatus>();
    const [settings, setSettings] = useState<HanbaoSettings>();
    const [accounts, setAccounts] = useState<HanbaoAccount[]>([]);
    const [account, setAccount] = useState("");
    const [busy, setBusy] = useState(false);
    const [smsBusy, setSmsBusy] = useState(false);
    const [error, setError] = useState("");
    const [orders, setOrders] = useState<HanbaoOrder[]>([]);
    const [projects, setProjects] = useState<FeihuProject[]>([]);
    const [balance, setBalance] = useState<{ money?: number; available_num?: number }>();
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [autoPoll, setAutoPoll] = useState(false);
    const polling = useRef(false);
    const alive = useRef(true);
    const [plan, setPlan] = useState("normal");
    const [dailyLimit, setDailyLimit] = useState<number | null>(null);
    const [dailySeconds, setDailySeconds] = useState<number | null>(null);

    useEffect(() => {
        alive.current = true;
        const controller = new AbortController();
        void getHanbaoStatus(controller.signal).then((value) => { setStatus(value); setSettings(value.settings); setAccount(value.settings.account); }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
        void hanbaoSMS<HanbaoOrder[]>("orders", {}, controller.signal).then(setOrders).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
        return () => { alive.current = false; controller.abort(); };
    }, []);

    const run = async (operation: () => Promise<unknown>, sms = false) => {
        if (sms ? smsBusy || polling.current : busy) return;
        (sms ? setSmsBusy : setBusy)(true);
        setError("");
        try { await operation(); }
        catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "操作失败"); }
        finally { if (alive.current) (sms ? setSmsBusy : setBusy)(false); }
    };
    const refreshAccounts = async () => { const result = await hanbaoAccountAction("accounts"); if (alive.current) setAccounts(result.accounts || []); };
    const control = (action: Parameters<typeof hanbaoAccountAction>[0], label = account) => run(async () => {
        const result = await hanbaoAccountAction(action, { account: label, plan, ...(dailyLimit == null ? {} : { dailyLimit }), ...(dailySeconds == null ? {} : { dailySeconds }) });
        if (action === "checklogin") message.info(result.logged_in ? "浏览器校验已登录" : "浏览器校验未登录");
        else message.success(action === "login" ? "登录完成，请选择生成账号" : "账号操作完成");
        await refreshAccounts();
    });
    const save = async (value = settings) => {
        if (!value) return;
        await saveHanbaoSettings(value);
        const result = await getHanbaoStatus();
        if (alive.current) { setStatus(result); setSettings(result.settings); }
        message.success("憨包设置已保存");
    };
    const updateOrder = (order: HanbaoOrder) => setOrders((current) => [order, ...current.filter((item) => item.order_id !== order.order_id)]);
    const smsOrderAction = (action: "message" | "release" | "blacklist", order: HanbaoOrder) => run(async () => updateOrder(await hanbaoSMS<HanbaoOrder>(action, { orderId: order.order_id })), true);

    useEffect(() => {
        if (!autoPoll || !orders.some((order) => order.status === 1)) return;
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            if (smsBusy || polling.current) return;
            polling.current = true;
            try {
                for (const order of orders.filter((item) => item.status === 1)) {
                    const updated = await hanbaoSMS<HanbaoOrder>("message", { orderId: order.order_id }, controller.signal);
                    if (!controller.signal.aborted) updateOrder(updated);
                }
            } catch (e) {
                if (!controller.signal.aborted) { setAutoPoll(false); setError(e instanceof Error ? e.message : "收码失败"); }
            } finally { polling.current = false; }
        }, 11000);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [autoPoll, orders, smsBusy]);

    const field = (key: keyof HanbaoSettings, value: unknown) => setSettings((current) => current ? { ...current, [key]: value } : current);
    const smsField = (key: keyof HanbaoSettings["feihu"], value: string) => setSettings((current) => current ? { ...current, feihu: { ...current.feihu, [key]: value } } : current);
    const filterField = (key: string, value?: string) => setFilters((current) => ({ ...current, [key]: value || "" }));
    const input = (label: string, key: string, value: string, onChange: (value: string) => void, secret = false, placeholder?: string) => <label className="flex min-w-0 flex-col gap-1.5 text-xs" key={key}>
        {label}{secret ? <Input.Password autoComplete="new-password" aria-label={label} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <Input aria-label={label} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
    </label>;

    return <AppModal open flush title={null} footer={null} width={960} onCancel={onClose}>
        <div className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold">憨包账号管理</h2>
            <p className="mb-4 mt-1 text-xs text-foreground/55">Windows 浏览器账号 · Seedance 2.5 / 2.0 Mini / 2.0 Fast</p>
            {error ? <Alert className="mb-3" type="error" showIcon title={error} /> : null}
            {status && !status.available ? <Alert className="mb-3" type="warning" showIcon title={status.reason} /> : null}
            {!settings ? <Button onClick={onClose}>关闭</Button> : <Tabs items={[
                { key: "accounts", label: "账号", children: <div className="space-y-4">
                    <Alert type="info" title="点击登录后，在打开的浏览器完成扫码或手机号登录；手机号和验证码需要手动填写。" />
                    <div className="flex flex-wrap items-end gap-2">
                        {input("账号标签", "account", account, setAccount, false, "例如：创作账号1")}
                        <Button type="primary" loading={busy} disabled={!account || !status?.available} onClick={() => void control("login")}>登录 / 添加账号</Button>
                        <Button disabled={busy || !status?.available} onClick={() => void run(refreshAccounts)}>刷新账号</Button>
                    </div>
                    <p className="text-sm">当前生成账号：<strong>{settings.account || "尚未选择"}</strong></p>
                    <p className="text-xs text-foreground/55">账号清单为本地登录记录；“检查登录”会联网验证。组件可能根据额度轮换账号，任务查询始终使用实际提交账号。</p>
                    {!accounts.length ? <p className="text-sm text-foreground/55">点击刷新查看账号，或填写标签后登录。</p> : accounts.map((item) => <section key={item.id} className="rounded-lg border border-border p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2"><strong>{item.label || item.id}</strong><Tag>{item.logged_in ? "本地已登录" : "本地未登录"}</Tag>{item.blocked ? <Tag color="warning">本地额度受限</Tag> : null}{settings.account === item.id ? <Tag color="success">生成账号</Tag> : null}</div>
                        <p className="mb-2 text-xs text-foreground/55">套餐标签 {item.plan || "normal"} · 今日 {item.used_today ?? 0}/{item.daily_limit || "不限"} 条 · 已用 {item.used_seconds_today ?? 0}/{item.daily_seconds_limit || "不限"} 秒</p>
                        <Space wrap>
                            <Button size="small" disabled={busy} onClick={() => void run(() => save({ ...settings, account: item.id }))}>用于生成</Button>
                            <Button size="small" disabled={busy} onClick={() => { setAccount(item.id); setPlan(item.plan || "normal"); setDailyLimit(item.daily_limit ?? null); setDailySeconds(item.daily_seconds_limit ?? null); }}>选择管理</Button>
                            <Button size="small" disabled={busy} onClick={() => void control("checklogin", item.id)}>检查登录</Button>
                            <Button size="small" disabled={busy} onClick={() => void control("open", item.id)}>打开浏览器</Button>
                            <Popconfirm title="移除此账号的本地登录态？" onConfirm={() => control("logout", item.id)}><Button size="small" disabled={busy}>登出</Button></Popconfirm>
                            <Popconfirm title="删除账号及其浏览器资料？" description="该操作会清除此账号在憨包中的本地登录资料。" onConfirm={() => control("delete-account", item.id)}><Button size="small" danger disabled={busy}>删除账号</Button></Popconfirm>
                        </Space>
                    </section>)}
                    <Collapse items={[{ key: "quota", label: "本地套餐与额度计数", children: <div className="space-y-3">
                        <p className="text-xs text-foreground/55">当前管理：{account || "请先选择账号"}。以下参数只影响本地调度，不购买会员或增加上游真实额度；0 表示不限，留空保留原值。</p>
                        <div className="flex flex-wrap gap-3">
                            <Select aria-label="套餐标签" value={plan} onChange={setPlan} options={[{ value: "normal", label: "普通" }, { value: "standard", label: "标准" }]} />
                            <InputNumber aria-label="每日条数" placeholder="每日条数" min={0} precision={0} value={dailyLimit} onChange={setDailyLimit} />
                            <InputNumber aria-label="每日秒数" placeholder="每日秒数" min={0} precision={0} value={dailySeconds} onChange={setDailySeconds} />
                            <Button disabled={busy || !account} onClick={() => void control("set-plan")}>保存本地阈值</Button>
                            <Popconfirm title="重置这个账号的本地额度计数？" onConfirm={() => control("reset-quota")}><Button disabled={busy || !account}>重置本地计数</Button></Popconfirm>
                        </div>
                    </div> }]} />
                </div> },
                { key: "sms", label: "飞狐接码 · 仅憨包", children: <div className="space-y-4">
                    <p className="text-xs text-foreground/55">填写飞狐用户中心的 API 对接凭据，先保存再连接。密钥留空保留已存值。取号可能按平台规则计费。</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {input("飞狐 API 地址", "base", settings.feihu.baseUrl, (value) => smsField("baseUrl", value))}
                        {input("接码项目 ID", "pid", settings.feihu.projectId, (value) => smsField("projectId", value))}
                        {input("飞狐 API Key", "key", settings.feihu.apiKey, (value) => smsField("apiKey", value), true, settings.feihu.hasApiKey ? "已保存；留空保留" : "API Key")}
                        {input("飞狐 API 密钥", "secret", settings.feihu.apiSecret, (value) => smsField("apiSecret", value), true, settings.feihu.hasApiSecret ? "已保存；留空保留" : "API 密钥")}
                    </div>
                    <Space wrap>
                        <Button loading={busy} onClick={() => void run(() => save())}>保存接码设置</Button>
                        <Button loading={smsBusy} onClick={() => void run(async () => { await hanbaoSMS("connect"); message.success("飞狐连接成功"); }, true)}>连接 / 重新认证</Button>
                        <Button disabled={smsBusy} onClick={() => void run(async () => setBalance(await hanbaoSMS("info")), true)}>查询余额</Button>
                        <Button disabled={smsBusy} onClick={() => void run(async () => { const result = await hanbaoSMS<{ list: FeihuProject[] }>("projects"); setProjects(result.list || []); }, true)}>搜索豆包项目</Button>
                    </Space>
                    {balance ? <p className="text-sm">余额：{balance.money ?? "—"} · 可用号码数量：{balance.available_num ?? "—"}</p> : null}
                    {projects.length ? <Select className="w-full" aria-label="豆包接码项目" placeholder="选择项目后点击保存接码设置" value={settings.feihu.projectId || undefined} onChange={(value) => smsField("projectId", value)} options={projects.map((item) => ({ value: String(item.project_id), label: `${item.name} · ${item.project_id} · ${item.price} 元`, disabled: item.status !== 2 }))} /> : null}
                    <div className="border-t border-border pt-4">
                        <h3 className="mb-2 font-medium">为憨包账号取号</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                            {input("接码所属憨包标签", "smsAccount", account, setAccount)}
                            <Select aria-label="运营商" placeholder="不限运营商" allowClear value={filters.isp || undefined} onChange={(value) => filterField("isp", value)} options={["不限", "移动", "联通", "电信", "广电", "虚商", "仅香港"].map((label, index) => ({ label, value: index === 6 ? "hk" : String(index) }))} />
                            <Select aria-label="省份" placeholder="不限省份" allowClear value={filters.province || undefined} onChange={(value) => filterField("province", value)} options={provinces.map((label, index) => ({ label, value: String(index + 1) }))} />
                            <Select aria-label="卡类型" placeholder="不限卡类型" allowClear value={filters.cardType || undefined} onChange={(value) => filterField("cardType", value)} options={[{ value: "1", label: "实卡" }, { value: "2", label: "虚卡" }]} />
                            {input("包含号段（| 分隔）", "include", filters.include || "", (value) => filterField("include", value))}
                            {input("排除号段（| 分隔）", "exclude", filters.exclude || "", (value) => filterField("exclude", value))}
                        </div>
                        <Collapse className="my-3" items={[{ key: "more", label: "更多取号筛选", children: <div className="grid gap-3 sm:grid-cols-2">
                            {input("指定手机号", "phone", filters.phone || "", (value) => filterField("phone", value))}
                            {input("号码作者（可选）", "author", filters.author || "", (value) => filterField("author", value))}
                            <Select aria-label="取号模式" placeholder="平台默认模式" allowClear value={filters.mode || undefined} onChange={(value) => filterField("mode", value)} options={[{ value: "1", label: "平台号码" }, { value: "2", label: "对接码" }, { value: "3", label: "优先对接码" }]} />
                            {input("对接码", "code", filters.code || "", (value) => filterField("code", value))}
                            <label className="flex items-center gap-2 text-xs"><Switch checked={filters.hk === "1"} onChange={(checked) => filterField("hk", checked ? "1" : "")} />混入香港号码</label>
                        </div> }]} />
                        <Space wrap><Button type="primary" loading={smsBusy} disabled={!account || !settings.feihu.projectId} onClick={() => void run(async () => updateOrder(await hanbaoSMS<HanbaoOrder>("receive", { account, filters })), true)}>取号</Button>
                            <label className="flex items-center gap-2 text-xs"><Switch checked={autoPoll} onChange={setAutoPoll} />自动收码（间隔 ≥ 10 秒）</label>
                        </Space>
                    </div>
                    {!orders.length ? <p className="text-sm text-foreground/55">暂无憨包接码订单</p> : orders.map((order) => <section key={order.order_id} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap gap-2"><strong className="select-text">{order.phone}</strong><span>{order.account}</span><Tag>{statusNames[order.status] || "未知"}</Tag></div>
                        <p className="mt-1 select-text text-xs text-foreground/55">订单：{order.order_id}</p>
                        {order.code ? <p className="my-2 select-text text-lg font-semibold">验证码：{order.code}</p> : null}
                        {order.message ? <p className="my-2 select-text break-words text-sm">{order.message}</p> : null}
                        <Space wrap><Button size="small" disabled={smsBusy || polling.current || order.status !== 1} onClick={() => void smsOrderAction("message", order)}>查询短信</Button>
                            <Popconfirm title="释放这个憨包接码订单？" onConfirm={() => smsOrderAction("release", order)}><Button size="small" disabled={smsBusy || order.status !== 1}>释放号码</Button></Popconfirm>
                            <Popconfirm title="将此号码加入当前项目黑名单？" onConfirm={() => smsOrderAction("blacklist", order)}><Button size="small" danger disabled={smsBusy || polling.current}>拉黑号码</Button></Popconfirm>
                        </Space>
                    </section>)}
                </div> },
                { key: "advanced", label: "调用参数", children: <div className="space-y-4">
                    <p className="text-xs text-foreground/55">4～30 秒，5 种比例，最多 9 张参考图、总计不超过 4 MiB；不支持参考视频和音频。画面参数在生成面板中设置。</p>
                    <label className="flex flex-col gap-2 text-xs">网页通道<Select aria-label="网页通道" value={settings.channel} onChange={(value) => field("channel", value)} options={[{ value: "auto", label: "自动（画布）" }, { value: "canvas", label: "画布" }, { value: "chat", label: "对话" }]} /></label>
                    <label className="flex flex-col gap-2 text-xs">画布尝试次数<InputNumber aria-label="画布尝试次数" min={1} max={3} precision={0} value={settings.canvasAttempts} onChange={(value) => field("canvasAttempts", value ?? 1)} /></label>
                    <p className="text-xs text-foreground/55">建议保持 1。大于 1 时组件内部可能重复提交，消耗额外额度。</p>
                    {input("网页版本号", "version", settings.versionCode, (value) => field("versionCode", value))}
                    {input("PC 版本号", "pcVersion", settings.pcVersion, (value) => field("pcVersion", value))}
                    <Button type="primary" loading={busy} onClick={() => void run(() => save())}>保存调用参数</Button>
                </div> },
            ]} />}
        </div>
    </AppModal>;
}
