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
    const [managedAccount, setManagedAccount] = useState("");
    const [quotaOpen, setQuotaOpen] = useState(false);
    const [quotaFeedback, setQuotaFeedback] = useState<{ accountId: string; state: "saving" | "saved" | "failed"; text: string }>();
    const [busy, setBusy] = useState(false);
    const [accountAction, setAccountAction] = useState("");
    const [loginFeedback, setLoginFeedback] = useState<{ type: "success" | "warning" | "info" | "error"; text: string }>();
    const [saving, setSaving] = useState(false);
    const [saveFeedback, setSaveFeedback] = useState<{ tab: string; state: "saving" | "saved" | "failed"; text: string }>();
    const settingsRevision = useRef(0);
    const saveSequence = useRef(0);
    const [smsBusy, setSmsBusy] = useState(false);
    const [smsAction, setSmsAction] = useState("");
    const [error, setError] = useState("");
    const [activeTab, setActiveTab] = useState("accounts");
    const [errorTab, setErrorTab] = useState("accounts");
    const [orders, setOrders] = useState<HanbaoOrder[]>([]);
    const [projects, setProjects] = useState<FeihuProject[]>([]);
    const [platformName, setPlatformName] = useState("豆包");
    const [searchedPlatform, setSearchedPlatform] = useState("");
    const [balance, setBalance] = useState<{ money?: number; max_num?: number; available_num?: number }>();
    const [filters, setFilters] = useState<Record<string, string>>({ mode: "1" });
    const [autoPoll, setAutoPoll] = useState(false);
    const polling = useRef(false);
    const alive = useRef(true);
    const loginController = useRef<AbortController | null>(null);
    const [plan, setPlan] = useState("normal");
    const [dailyLimit, setDailyLimit] = useState<number | null>(null);
    const [dailySeconds, setDailySeconds] = useState<number | null>(null);

    useEffect(() => {
        alive.current = true;
        const controller = new AbortController();
        void getHanbaoStatus(controller.signal).then(async (value) => {
            if (controller.signal.aborted) return;
            setStatus(value); setSettings(value.settings); setAccount(value.settings.account);
            if (value.available) {
                const result = await hanbaoAccountAction("accounts", {}, controller.signal);
                if (!controller.signal.aborted) setAccounts(result.accounts || []);
            }
        }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
        void hanbaoSMS<HanbaoOrder[]>("orders", {}, controller.signal).then(setOrders).catch((e) => { if (!controller.signal.aborted) { setError(e.message); setErrorTab("sms"); } });
        return () => { alive.current = false; controller.abort(); loginController.current?.abort(); };
    }, []);

    const run = async (operation: () => Promise<unknown>, sms = false, action = "") => {
        if (sms ? smsBusy || polling.current : busy) return;
        (sms ? setSmsBusy : setBusy)(true);
        if (sms) setSmsAction(action);
        setError("");
        try { await operation(); }
        catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : "操作失败"); setErrorTab(activeTab); } }
        finally { if (alive.current) { (sms ? setSmsBusy : setBusy)(false); if (sms) setSmsAction(""); } }
    };
    const refreshAccounts = async () => { const result = await hanbaoAccountAction("accounts"); if (alive.current) setAccounts(result.accounts || []); };
    const control = (action: Parameters<typeof hanbaoAccountAction>[0], label = account) => run(async () => {
        const controller = new AbortController();
        if (action === "login") { loginController.current = controller; setLoginFeedback(undefined); }
        setAccountAction(action);
        if (action === "set-plan") setQuotaFeedback({ accountId: label, state: "saving", text: "正在保存…" });
        try {
            const result = await hanbaoAccountAction(action, { account: label, plan, ...(dailyLimit == null ? {} : { dailyLimit }), ...(dailySeconds == null ? {} : { dailySeconds }) }, controller.signal);
            if (!alive.current || controller.signal.aborted) return;
            if (action === "login") {
                if (result.logged_in !== true) throw new Error("未确认登录完成，请点击账号的“检查登录”核对；如未登录，请重新打开登录窗口");
                const text = `账号 ${result.account || label} 登录已完成，登录态已保存，窗口已自动关闭。生成时会自动匹配可用账号。`;
                setLoginFeedback({ type: "success", text });
                message.success("登录已完成，登录态已保存");
            }
            else if (action === "checklogin") {
                setLoginFeedback({ type: result.logged_in ? "success" : "warning", text: `账号 ${label}：${result.logged_in ? "浏览器校验已登录" : "浏览器校验未登录，请重新登录"}` });
                message.info(result.logged_in ? "浏览器校验已登录" : "浏览器校验未登录");
            }
            else if (action === "set-plan") {
                setQuotaFeedback({ accountId: label, state: "saved", text: "本地阈值已保存，后续调度按此账号的新阈值判断" });
                message.success("本地阈值已保存");
            }
            else message.success("账号操作完成");
            try { await refreshAccounts(); }
            catch (error) {
                if (action === "set-plan") {
                    if (alive.current) setQuotaFeedback({ accountId: label, state: "saved", text: "本地阈值已保存，但账号列表刷新失败，请点击刷新账号核对" });
                } else {
                    if (action !== "login") throw error;
                    if (alive.current) setLoginFeedback({ type: "warning", text: `登录已完成，登录态已保存，但账号列表刷新失败：${error instanceof Error ? error.message : "请点击刷新账号重试"}` });
                }
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                if (action === "set-plan" && alive.current) setQuotaFeedback({ accountId: label, state: "failed", text: `未保存：${error instanceof Error ? error.message : "请重试"}` });
                if (action !== "login") throw error;
                if (alive.current) setLoginFeedback({ type: "error", text: `登录未完成：${error instanceof Error ? error.message : "登录组件异常退出，请重试"}` });
            }
        }
        finally {
            if (loginController.current === controller) loginController.current = null;
            if (alive.current) {
                if (action === "login" && controller.signal.aborted) setLoginFeedback({ type: "info", text: "已结束登录等待，本次未确认登录完成。已有账号资料保留，可点击“检查登录”核对。" });
                setAccountAction("");
            }
        }
    });
    const save = async (value = settings) => {
        if (!value) return;
        const tab = activeTab;
        const revision = settingsRevision.current;
        const sequence = ++saveSequence.current;
        setSaving(true);
        setSaveFeedback({ tab, state: "saving", text: "正在保存…" });
        try {
            const result = await saveHanbaoSettings(value);
            if (result.saved !== true) throw new Error("后端未确认保存成功，请重新打开核对设置");
            if (!alive.current) return;
            setSettings((current) => current === settings ? value : current);
            setSaveFeedback({ tab, state: "saved", text: settingsRevision.current === revision ? "已保存" : "提交的设置已保存，当前修改尚未保存" });
            message.success("憨包设置已保存");
            void getHanbaoStatus().then((result) => {
                if (!alive.current || saveSequence.current !== sequence) return;
                setStatus(result);
                setSettings((current) => current === value ? result.settings : current);
            }).catch((error) => {
                if (!alive.current || saveSequence.current !== sequence) return;
                setSaveFeedback({ tab, state: "saved", text: `设置已保存，但状态刷新失败：${error instanceof Error ? error.message : "请重新打开确认"}${settingsRevision.current !== revision ? "；当前修改尚未保存" : ""}` });
            });
        } catch (error) {
            if (alive.current) setSaveFeedback({ tab, state: "failed", text: "未确认保存成功，请查看上方原因" });
            throw error;
        } finally { if (alive.current) setSaving(false); }
    };
    const saveStatus = saveFeedback?.tab === activeTab ? <span className="min-w-0 max-w-full" role="status" aria-live="polite"><Tag style={{ whiteSpace: "normal", overflowWrap: "anywhere" }} color={saveFeedback.state === "saved" ? "success" : saveFeedback.state === "failed" ? "error" : "processing"}>{saveFeedback.text}</Tag></span> : null;
    const updateOrder = (order: HanbaoOrder) => setOrders((current) => [order, ...current.filter((item) => item.order_id !== order.order_id)]);
    const smsOrderAction = (action: "message" | "release" | "blacklist", order: HanbaoOrder) => run(async () => updateOrder(await hanbaoSMS<HanbaoOrder>(action, { orderId: order.order_id })), true, action);
    const searchProjects = () => run(async () => {
        const name = platformName.trim();
        if (!name) throw new Error("请填写平台名称");
        setProjects([]);
        setSearchedPlatform("");
        const result = await hanbaoSMS<{ list: FeihuProject[] }>("projects", { name });
        if (alive.current) { setProjects(result.list || []); setSearchedPlatform(name); }
    }, true, "projects");

    useEffect(() => {
        if (!autoPoll || !orders.some((order) => order.status === 1)) return;
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            if (smsBusy || polling.current) return;
            polling.current = true;
            try {
                const updates: HanbaoOrder[] = [];
                for (const order of orders.filter((item) => item.status === 1)) {
                    const updated = await hanbaoSMS<HanbaoOrder>("message", { orderId: order.order_id }, controller.signal);
                    updates.push(updated);
                }
                if (!controller.signal.aborted) setOrders((current) => current.map((order) => updates.find((item) => item.order_id === order.order_id) || order));
            } catch (e) {
                if (!controller.signal.aborted) { setAutoPoll(false); setError(e instanceof Error ? e.message : "收码失败"); setErrorTab("sms"); }
            } finally { polling.current = false; }
        }, 11000);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [autoPoll, orders, smsBusy]);

    const markSettingsEdited = () => {
        settingsRevision.current++;
        setSaveFeedback((current) => current?.state === "saving" ? current : undefined);
    };
    const field = (key: keyof HanbaoSettings, value: unknown) => { markSettingsEdited(); setSettings((current) => current ? { ...current, [key]: value } : current); };
    const smsField = (key: keyof HanbaoSettings["feihu"], value: string) => { markSettingsEdited(); setSettings((current) => current ? { ...current, feihu: { ...current.feihu, [key]: value } } : current); };
    const filterField = (key: string, value?: string) => setFilters((current) => ({ ...current, [key]: value || "" }));
    const input = (label: string, key: string, value: string, onChange: (value: string) => void, secret = false, placeholder?: string) => <label className="flex min-w-0 flex-col gap-1.5 text-xs" key={key}>
        {label}{secret ? <Input.Password autoComplete="new-password" aria-label={label} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <Input aria-label={label} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
    </label>;
    const managedAccountLabel = accounts.find((item) => item.id === managedAccount)?.label || managedAccount;

    return <AppModal open flush title={null} footer={null} width={960} onCancel={onClose}>
        <div className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold">憨包账号管理</h2>
            <p className="mb-4 mt-1 text-xs text-foreground/55">Windows 浏览器账号 · Seedance 2.5 / 2.0 Mini / 2.0 Fast</p>
            {error && errorTab === activeTab ? <Alert className="mb-3" type="error" showIcon title={error} /> : null}
            {status && !status.available ? <Alert className="mb-3" type="warning" showIcon title={status.reason} /> : null}
            {loginFeedback ? <Alert className="mb-3" type={loginFeedback.type} showIcon title={loginFeedback.text} /> : null}
            {accountAction === "login" ? <Alert className="mb-3" type="info" showIcon title="正在等待浏览器登录完成；已有接码配置仍可取号和收码。修改设置前请先结束登录等待，保存后再重新打开登录窗口。" action={<Button size="small" onClick={() => loginController.current?.abort()}>结束登录等待</Button>} /> : null}
            {!settings ? <Button onClick={onClose}>关闭</Button> : <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
                { key: "accounts", label: "账号", children: <div className="space-y-4">
                    <Alert type="info" title="先填写账号标签；使用接码时在“飞狐接码”取号，再打开登录窗口填写手机号、发送验证码，收码后填写验证码完成登录。自动收码仅轮询短信，不会自动注册。" />
                    <div className="flex flex-wrap items-end gap-2">
                        {input("账号标签", "account", account, setAccount, false, "例如：创作账号1")}
                        <Button type="primary" loading={accountAction === "login"} disabled={busy || !account || !status?.available} onClick={() => void control("login")}>登录 / 添加账号</Button>
                        <Button disabled={busy || !status?.available} onClick={() => void run(refreshAccounts)}>刷新账号</Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm">生成账号选择：<strong>{settings.account ? `优先 ${settings.account}，不可用时轮换其他账号` : "自动轮换可用账号"}</strong></p>
                        {settings.account ? <Button size="small" disabled={busy} onClick={() => void run(() => save({ ...settings, account: "" }))}>恢复自动匹配</Button> : null}
                    </div>
                    <p className="text-xs text-foreground/55">提交前自动跳过未登录、冷却或本地额度不足的账号。账号清单为本地记录，“检查登录”会联网验证；任务受理后始终用实际提交账号查询，提交未确认时不会自动换号重发。</p>
                    {!accounts.length ? <p className="text-sm text-foreground/55">点击刷新查看账号，或填写标签后登录。</p> : accounts.map((item) => <section key={item.id} className="rounded-lg border border-border p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2"><strong>{item.label || item.id}</strong><Tag>{item.logged_in ? "本地已登录" : "本地未登录"}</Tag>{item.blocked ? <Tag color="warning">{item.block_kind === "cooldown" ? "冷却中" : "账号受限"}</Tag> : null}{settings.account === item.id ? <Tag color="success">优先账号</Tag> : null}{managedAccount === item.id ? <Tag color="processing">正在管理</Tag> : null}</div>
                        <p className="mb-2 select-text break-all text-xs">用户名：{item.id}</p>
                        <p className="mb-2 text-xs text-foreground/55">套餐标签 {item.plan || "normal"} · 今日 {item.used_today ?? 0}/{item.daily_limit || "不限"} 条 · 已用 {item.used_seconds_today ?? 0}/{item.daily_seconds_limit || "不限"} 秒</p>
                        <Space wrap>
                            <Button size="small" disabled={busy} onClick={() => void run(() => save({ ...settings, account: item.id }))}>用于生成</Button>
                            <Button size="small" aria-pressed={managedAccount === item.id} disabled={busy} onClick={() => { setManagedAccount(item.id); setQuotaOpen(true); setPlan(item.plan || "normal"); setDailyLimit(item.daily_limit ?? null); setDailySeconds(item.daily_seconds_limit ?? null); setQuotaFeedback(undefined); }}>选择管理</Button>
                            <Button size="small" disabled={busy} onClick={() => void control("checklogin", item.id)}>检查登录</Button>
                            <Button size="small" disabled={busy} onClick={() => void control("open", item.id)}>打开浏览器</Button>
                            <Popconfirm title="移除此账号的本地登录态？" onConfirm={() => control("logout", item.id)}><Button size="small" disabled={busy}>登出</Button></Popconfirm>
                            <Popconfirm title="删除账号及其浏览器资料？" description="该操作会清除此账号在憨包中的本地登录资料。" onConfirm={() => control("delete-account", item.id)}><Button size="small" danger disabled={busy}>删除账号</Button></Popconfirm>
                        </Space>
                    </section>)}
                    <Collapse activeKey={quotaOpen ? ["quota"] : []} onChange={(keys) => setQuotaOpen(keys.includes("quota"))} items={[{ key: "quota", label: "本地套餐与额度计数", children: <div role="region" aria-label={`${managedAccountLabel}的本地额度设置`} className="space-y-3">
                            <p className="text-sm font-medium">当前管理：{managedAccountLabel || "请先选择账号"}</p>
                            {managedAccount ? <p className="select-text break-all text-xs">用户名：{managedAccount}</p> : null}
                            <p className="text-xs text-foreground/55">体验订阅等账号可按实际额度单独设置。本地阈值只影响调度，不改变上游套餐或真实额度；0 表示不限，留空保留原值。</p>
                            <div className="flex flex-wrap items-end gap-3">
                                <label className="flex flex-col gap-1.5 text-xs">套餐标签<Select aria-label="套餐标签" value={plan} disabled={busy} onChange={(value) => { setPlan(value); setQuotaFeedback(undefined); }} options={[{ value: "normal", label: "普通" }, { value: "standard", label: "标准" }]} /></label>
                                <label className="flex flex-col gap-1.5 text-xs">每日条数<InputNumber aria-label="每日条数" placeholder="留空保留" min={0} precision={0} value={dailyLimit} disabled={busy} onChange={(value) => { setDailyLimit(value); setQuotaFeedback(undefined); }} /></label>
                                <label className="flex flex-col gap-1.5 text-xs">每日秒数<InputNumber aria-label="每日秒数" placeholder="留空保留" min={0} precision={0} value={dailySeconds} disabled={busy} onChange={(value) => { setDailySeconds(value); setQuotaFeedback(undefined); }} /></label>
                                <Button loading={busy && accountAction === "set-plan"} disabled={busy || !managedAccount} onClick={() => void control("set-plan", managedAccount)}>保存本地阈值</Button>
                                <Popconfirm title="重置这个账号的本地额度计数？" onConfirm={() => control("reset-quota", managedAccount)}><Button disabled={busy || !managedAccount}>重置本地计数</Button></Popconfirm>
                            </div>
                            {quotaFeedback?.accountId === managedAccount ? <p role="status" aria-live="polite"><Tag color={quotaFeedback.state === "saved" ? "success" : quotaFeedback.state === "failed" ? "error" : "processing"} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{quotaFeedback.text}</Tag></p> : null}
                    </div> }]} />
                </div> },
                { key: "sms", label: "飞狐接码 · 仅憨包", children: <div className="space-y-4">
                    <p className="text-xs text-foreground/55">在飞狐「用户中心 → API对接」获取 API账号（文档字段 api_key）和 API密钥，先保存再连接。两项均不是网页登录用户名或密码；留空保留已存值。取号可能按平台规则计费。</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {input("飞狐 API 地址", "base", settings.feihu.baseUrl, (value) => smsField("baseUrl", value))}
                        {input("接码项目 ID", "pid", settings.feihu.projectId, (value) => smsField("projectId", value))}
                        {input("飞狐 API账号", "key", settings.feihu.apiKey, (value) => smsField("apiKey", value), false, settings.feihu.hasApiKey ? "已保存账号；留空保留" : "填写飞狐 API账号")}
                        {input("飞狐 API密钥", "secret", settings.feihu.apiSecret, (value) => smsField("apiSecret", value), true, settings.feihu.hasApiSecret ? "已保存密钥；留空保留" : "填写飞狐 API密钥")}
                    </div>
                    <Space wrap>
                        <Button loading={saving} disabled={busy || smsBusy} onClick={() => void run(() => save())}>保存接码设置</Button>
                        {saveStatus}
                        <Button loading={smsAction === "connect"} disabled={smsBusy || saving} onClick={() => void run(async () => { await hanbaoSMS("connect"); message.success("飞狐连接成功"); }, true, "connect")}>连接 / 重新认证</Button>
                        <Button loading={smsAction === "info"} disabled={smsBusy || saving} onClick={() => void run(async () => setBalance(await hanbaoSMS("info")), true, "info")}>查询余额</Button>
                    </Space>
                    {balance ? <p className="text-sm">余额：{balance.money ?? "—"} · 可用取号配额：{balance.available_num ?? "—"} / {balance.max_num ?? "—"}<span className="ml-2 text-xs text-foreground/55">这是账号的并行取号配额，不是当前项目的实时号源库存；未完成的订单用完请及时释放。</span></p> : null}
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">平台名称<Input aria-label="平台名称" placeholder="例如：豆包、豆包三次" value={platformName} onChange={(event) => setPlatformName(event.target.value)} onPressEnter={() => void searchProjects()} /></label>
                        <Button loading={smsAction === "projects"} disabled={smsBusy || saving || !platformName.trim()} onClick={() => void searchProjects()}>查询项目 ID</Button>
                    </div>
                    {searchedPlatform && !projects.length ? <p className="text-sm text-foreground/55">未找到“{searchedPlatform}”对应的项目</p> : null}
                    {projects.length ? <div className="space-y-2">
                        <Select className="w-full" aria-label="接码项目搜索结果" placeholder="选择项目后自动保存 ID" disabled={smsBusy || busy} value={projects.some((item) => String(item.project_id) === settings.feihu.projectId) ? settings.feihu.projectId : undefined} onChange={(value) => void run(() => save({ ...settings, feihu: { ...settings.feihu, projectId: value } }), true)} options={projects.map((item) => ({ value: String(item.project_id), label: `${item.name} · ID ${item.project_id} · ${item.price} 元${item.status !== 2 ? " · 未审核或已停用" : !/豆包|憨包|doubao/i.test(item.name) ? " · 非憨包项目，仅供查询" : ""}`, disabled: item.status !== 2 || !/豆包|憨包|doubao/i.test(item.name) }))} />
                        <p className="text-xs text-foreground/55">可按平台名称查询；憨包账号取号仅使用已审核的豆包或憨包项目。手动修改上方 ID 后需保存设置。</p>
                    </div> : null}
                    <div className="border-t border-border pt-4">
                        <h3 className="mb-2 font-medium">为憨包账号取号</h3>
                        <p className="mb-3 text-xs text-foreground/55">填写用于管理本次登录的账号标签（不是飞狐 API账号）。取号后仍需在憨包登录页手动发送验证码。</p>
                        <div className="grid items-end gap-3 sm:grid-cols-3">
                            {input("接码所属憨包标签", "smsAccount", account, setAccount)}
                            <label className="flex min-w-0 flex-col gap-1.5 text-xs">取号来源<Select aria-label="取号模式" value={filters.mode || "1"} onChange={(value) => filterField("mode", value)} options={[{ value: "1", label: "平台号码（公共池）" }, { value: "2", label: "对接码号码" }, { value: "3", label: "优先对接码，无号走平台" }]} /></label>
                            <Select aria-label="运营商" placeholder="不限运营商" allowClear value={filters.isp || undefined} onChange={(value) => filterField("isp", value)} options={["不限", "移动", "联通", "电信", "广电", "虚商", "仅香港"].map((label, index) => ({ label, value: index === 6 ? "hk" : String(index) }))} />
                            <Select aria-label="省份" placeholder="不限省份" allowClear value={filters.province || undefined} onChange={(value) => filterField("province", value)} options={provinces.map((label, index) => ({ label, value: String(index + 1) }))} />
                            <Select aria-label="卡类型" placeholder="不限卡类型" allowClear value={filters.cardType || undefined} onChange={(value) => filterField("cardType", value)} options={[{ value: "1", label: "实卡" }, { value: "2", label: "虚卡" }]} />
                            {input("包含号段（| 分隔）", "include", filters.include || "", (value) => filterField("include", value))}
                            {input("排除号段（| 分隔）", "exclude", filters.exclude || "", (value) => filterField("exclude", value))}
                        </div>
                        <Collapse className="my-3" items={[{ key: "more", label: "更多取号筛选", children: <div className="grid items-end gap-3 sm:grid-cols-2">
                            {input("指定手机号", "phone", filters.phone || "", (value) => filterField("phone", value))}
                            {input("号码作者（可选）", "author", filters.author || "", (value) => filterField("author", value))}
                            <p className="text-xs text-foreground/55 sm:col-span-2">号码作者填写对方的网页登录用户名，用于分成归属；不是 API账号或 API密钥，不影响号码来源，普通用户留空即可。</p>
                            {input("对接码", "code", filters.code || "", (value) => filterField("code", value))}
                            <label className="flex items-center gap-2 text-xs"><Switch checked={filters.hk === "1"} onChange={(checked) => filterField("hk", checked ? "1" : "")} />混入香港号码</label>
                            <p className="text-xs text-foreground/55 sm:col-span-2">“仅香港”只取港卡；“混入香港号码”将港卡与大陆卡一起取。指定手机号时由平台忽略对接码。</p>
                        </div> }]} />
                        <p className="mb-3 text-xs text-foreground/55">{filters.mode === "2" || filters.mode === "3" ? "使用对接码前，请先在飞狐平台加入该项目的对接码，再在更多筛选中填写；收到“未加入对接码”提示时，可改选平台号码后手动重试。" : "当前明确使用平台公共池（mode=1），无需加入对接码；首次使用请先保存配置、连接并选好项目，再取号。"}</p>
                        <Space wrap><Button type="primary" loading={smsAction === "receive"} disabled={smsBusy || saving || !account || !settings.feihu.projectId} onClick={() => void run(async () => updateOrder(await hanbaoSMS<HanbaoOrder>("receive", { account, filters })), true, "receive")}>取号</Button>
                            <label className="flex items-center gap-2 text-xs"><Switch checked={autoPoll} onChange={setAutoPoll} />自动收码（间隔 ≥ 10 秒）</label>
                        </Space>
                        {!account ? <p className="mt-2 text-xs text-foreground/55">请先填写接码所属憨包标签，才能取号。</p> : null}
                        {filters.isp === "hk" ? <p className="mt-2 text-xs text-foreground/55">当前仅取香港号码；有余额仍可能因该项目的香港号源或筛选条件取号失败。</p> : null}
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
                    <p className="text-xs text-foreground/55">4～30 秒，5 种比例，最多 9 张参考图；不支持参考视频和音频。图片大小不由本地界面额外限制，以上游实际返回为准。画面参数在生成面板中设置。</p>
                    <label className="flex flex-col gap-2 text-xs">网页通道<Select aria-label="网页通道" value={settings.channel} onChange={(value) => field("channel", value)} options={[{ value: "auto", label: "自动（画布）" }, { value: "canvas", label: "画布" }, { value: "chat", label: "对话" }]} /></label>
                    <label className="flex flex-col gap-2 text-xs">画布尝试次数<InputNumber aria-label="画布尝试次数" min={1} max={3} precision={0} value={settings.canvasAttempts} onChange={(value) => field("canvasAttempts", value ?? 1)} /></label>
                    <p className="text-xs text-foreground/55">建议保持 1。大于 1 时组件内部可能重复提交，消耗额外额度。</p>
                    {input("网页版本号", "version", settings.versionCode, (value) => field("versionCode", value))}
                    {input("PC 版本号", "pcVersion", settings.pcVersion, (value) => field("pcVersion", value))}
                    <div className="flex flex-wrap items-center gap-3">
                        <Button type="primary" loading={saving} disabled={busy || smsBusy} onClick={() => void run(() => save())}>保存调用参数</Button>
                        {saveStatus}
                    </div>
                </div> },
            ]} />}
        </div>
    </AppModal>;
}
