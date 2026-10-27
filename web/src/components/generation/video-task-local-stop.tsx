import { useState } from "react";
import { Alert, App, Button } from "antd";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { stopVideoTaskLocally, type GenerationTask } from "@/services/api/task-center";

export function VideoTaskLocalStop({ task, onStopped }: { task: GenerationTask; onStopped: (task: GenerationTask) => void }) {
    const { message } = App.useApp();
    const [confirmTask, setConfirmTask] = useState(false);
    const [stopping, setStopping] = useState(false);
    const active = task.status === "queued" || task.status === "running";
    const video = task.type === "canvas_video" || task.type.startsWith("canvas_video_") || task.type.startsWith("video_");
    if (!active || !video || task.id.startsWith("local:")) return null;

    const stop = async () => {
        if (!confirmTask || stopping) return;
        setStopping(true);
        try {
            const stopped = await stopVideoTaskLocally(task.id);
            setConfirmTask(false);
            onStopped(stopped);
            message.success("已停止本地跟进，可重新提交生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "本地停止失败，请刷新任务状态后重试");
        } finally {
            setStopping(false);
        }
    };

    return <>
        <details key={task.id} className="rounded-lg border border-border p-3 text-xs">
            <summary className="cursor-pointer text-foreground/55">高级任务操作</summary>
            <div className="mt-3 space-y-3">
                <p className="text-foreground/60">任务长时间没有结果时，可单独停止本地跟进，解除当前视频的生成占用。</p>
                <Button size="small" danger onClick={() => setConfirmTask(true)}>仅本地停止此视频</Button>
            </div>
        </details>
        <AppModal title="仅停止本地跟进？" open={confirmTask} onCancel={() => !stopping && setConfirmTask(false)} onOk={() => void stop()} confirmLoading={stopping} cancelButtonProps={{ disabled: stopping }} okText="确认本地停止" okButtonProps={{ danger: true }} centered>
            <div className="space-y-3">
                <Alert type="warning" showIcon title="不会取消上游任务" description="只停止本软件的轮询并释放当前视频的生成状态。上游可能继续生成和计费；之后点击生成会提交一条新任务。" />
                <p className="break-all text-xs text-foreground/60">本地任务：{task.id}<br />上游任务：{task.providerRequestId || "尚未取得任务 ID"}</p>
                <p className="text-xs text-foreground/60">原任务记录和已有资产会保留，不会自动重新提交。</p>
            </div>
        </AppModal>
    </>;
}
