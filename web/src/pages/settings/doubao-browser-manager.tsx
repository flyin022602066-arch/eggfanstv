import { Alert, Button, Space, Switch, Table, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { clearDoubaoBrowser, configureDoubaoBrowser, getDoubaoBrowserStatus, openDoubaoBrowser, type DoubaoBrowserStatus } from "@/services/api/doubao-browser";

const labels: Record<string, string> = { cold: "可用待预热", idle: "空闲就绪", busy: "任务占用", pending: "成功待取回", attention: "需检查", exhausted: "上游额度不足", used: "成功待清理" };
export function DoubaoBrowserManager({ onClose }: { onClose: () => void }) {
    const [status, setStatus] = useState<DoubaoBrowserStatus>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [feedback, setFeedback] = useState("");
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const controller = useRef<AbortController | null>(null);
    const running = useRef(false);
    const acting = useRef(false);
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        const refresh = async () => {
            if (running.current || acting.current) return;
            running.current = true;
            try { const value = await getDoubaoBrowserStatus(abort.signal); if (!abort.signal.aborted) setStatus(value); }
            catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "读取账号池失败"); }
            finally { running.current = false; }
        };
        void refresh(); const timer = window.setInterval(() => void refresh(), 10000);
        return () => { abort.abort(); window.clearInterval(timer); };
    }, []);
    const run = async (action: (signal: AbortSignal) => Promise<void>) => {
        const signal = controller.current?.signal;
        if (acting.current || !signal || signal.aborted) return;
        acting.current = true;
        setBusy(true); setError(""); setFeedback("");
        try { await action(signal); }
        catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : "操作失败"); }
        finally { acting.current = false; if (!signal.aborted) setBusy(false); }
    };
    return <AppModal open title="eggfansTV · 豆包浏览器账号池" width={920} footer={null} onCancel={onClose}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert type="info" showIcon title="环境独立并发，预热不阻塞提交" description="基础储备 300 个环境，不足时自动新增，不设本地任务并发数量上限。已有就绪环境直接使用；没有时各任务独立准备环境，不等待凑齐空闲储备。后台预热、清理与其他任务互不等待，每个环境同时只分配一个任务。明确失败后释放；已保存视频的环境可清理复用，跳过生成中、提交未确认及成功待取回环境，不删除本地视频、素材或 output。清理不代表上游额度已恢复。" />
            {error ? <Alert type="error" showIcon title={error} /> : null}
            {feedback ? <Alert type="info" showIcon title={feedback} /> : null}
            <Space wrap>
                <span>自动维护</span><Switch checked={status?.enabled || false} disabled={!status || busy} onChange={enabled => void run(async signal => { const value = await configureDoubaoBrowser(enabled, signal); if (!signal.aborted) setStatus(value); })} />
                <Tag>环境储备 {status?.total ?? 0}（基础 {status?.target ?? 300}）</Tag><Tag color="green">空闲 {status?.idle ?? 0}（后台补充，不限提交）</Tag><Tag color="blue">占用 {status?.busy ?? 0}</Tag>
                <Tag>待预热 {status?.cold ?? 0}</Tag><Tag color={status?.attention ? "warning" : undefined}>需检查 {status?.attention ?? 0}</Tag>
                <Tag>成功任务 {status?.succeeded ?? 0}</Tag><Tag>失败任务 {status?.failed ?? 0}（不占用）</Tag>
                <Tag color={status?.pending ? "warning" : undefined}>成功待取回 {status?.pending ?? 0}</Tag><Tag>成功待清理 {Math.max(0, (status?.used ?? 0) - (status?.pending ?? 0))}</Tag>
                {status?.warming ? <Tag color="processing">后台预热中 · 不阻塞提交</Tag> : null}
                {status?.cleaning ? <Tag color="processing">正在清理网站数据</Tag> : null}
                <Button loading={busy} onClick={() => void run(async signal => { const value = await getDoubaoBrowserStatus(signal); if (!signal.aborted) setStatus(value); })}>刷新</Button>
                <Button danger disabled={busy || !status?.total} onClick={() => setClearConfirmOpen(true)}>一键清理缓存 / 网站数据</Button>
                <AppModal open={clearConfirmOpen} title="清理可释放环境的网站数据？" okText="确认清理" cancelText="取消" okButtonProps={{ danger: true }} onCancel={() => setClearConfirmOpen(false)} onOk={() => { setClearConfirmOpen(false); void run(async signal => {
                    const result = await clearDoubaoBrowser(signal);
                    if (signal.aborted) return;
                    setFeedback("网站数据已清理 " + result.cleared + " 个并恢复可调度，跳过占用 / 待取回 " + result.skipped + " 个，清理失败 " + result.failed.length + " 个。本地视频与素材未删除；上游额度尚未确认。");
                    const value = await getDoubaoBrowserStatus(signal); if (!signal.aborted) setStatus(value);
                }); }}>按照四项清理：历史记录、缓存文件（含着色器缓存）、Cookie 与认证信息、网站存储（LocalStorage、IndexedDB、Service Worker 和 CacheStorage）。不保留登录状态，保留环境配置；清理成功后可重新调度。自动跳过生成中、提交未确认及待取回任务，不动本地视频和素材；不保证恢复上游额度。</AppModal>
            </Space>
            <Table rowKey="id" size="small" scroll={{ x: 760 }} pagination={{ pageSize: 10 }} dataSource={status?.profiles || []} columns={[
                { title: "环境", dataIndex: "label", width: 310, render: (label: string) => <span style={{ overflowWrap: "anywhere" }}>{label}</span> },
                { title: "状态", dataIndex: "state", render: (state: string) => labels[state] || state },
                { title: "说明", render: (_, item) => item.reason || (item.visitor ? "游客环境 · 额度未确认" : "额度未确认") },
                { title: "操作", render: (_, item) => <Button size="small" disabled={busy || item.state === "busy"} onClick={() => void run(async signal => { const result = await openDoubaoBrowser(item.id, signal); if (!signal.aborted && !result.opened) throw new Error("未确认浏览器已打开"); })}>打开环境</Button> },
            ]} />
        </Space>
    </AppModal>;
}
