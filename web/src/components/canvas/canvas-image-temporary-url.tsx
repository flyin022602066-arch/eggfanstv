import { useEffect, useRef, useState } from "react";
import { Button, Input } from "antd";
import { Copy, UploadCloud } from "lucide-react";

import { useCopyText } from "@/hooks/use-copy-text";
import { temporaryImageLink } from "@/lib/temporary-image-url";
import { refreshResource, uploadResourceToUguu, type RemoteResource } from "@/services/api/resources";

export function CanvasImageTemporaryURL({ resourceId }: { resourceId: string }) {
    const copyText = useCopyText();
    const [resource, setResource] = useState<RemoteResource | null>(null);
    const [error, setError] = useState("");
    const [now, setNow] = useState(Date.now);
    const [uploading, setUploading] = useState(false);
    const uploadControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const refresh = async () => {
            try {
                const latest = await refreshResource(resourceId, { signal: controller.signal });
                if (controller.signal.aborted) return;
                setResource(latest);
                setError("");
            } catch (cause) {
                if (controller.signal.aborted) return;
                setError(cause instanceof Error ? cause.message : "读取临时链接失败");
            }
            if (controller.signal.aborted) return;
            setNow(Date.now());
            timer = setTimeout(refresh, 5_000);
        };
        void refresh();
        return () => {
            controller.abort();
            clearTimeout(timer);
            uploadControllerRef.current?.abort();
        };
    }, [resourceId]);

    const uploadToUguu = async () => {
        if (uploading) return;
        const controller = new AbortController();
        uploadControllerRef.current = controller;
        setUploading(true);
        setError("");
        try {
            await uploadResourceToUguu(resourceId, { signal: controller.signal });
            const latest = await refreshResource(resourceId, { signal: controller.signal });
            if (controller.signal.aborted) return;
            setResource(latest);
            setNow(Date.now());
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "上传到 Uguu 失败");
        } finally {
            if (uploadControllerRef.current === controller) {
                uploadControllerRef.current = null;
                setUploading(false);
            }
        }
    };

    const link = resource ? temporaryImageLink(resource, now) : null;
    const expiresAt = link?.status === "ready" ? link.expiresAt : undefined;
    useEffect(() => {
        if (expiresAt === undefined) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now()));
        return () => clearTimeout(timer);
    }, [expiresAt]);
    return (
        <section className="canvas-node-inspector-section" data-temporary-image-link={link?.status || "loading"}>
            <div className="canvas-node-inspector-section-heading"><span>Uguu 临时图片链接</span></div>
            {error ? <p role="alert" className="canvas-node-inspector-help">{error}</p> : null}
            {link?.status === "ready" ? <>
                <Input.TextArea aria-label="Uguu 临时图片 URL" value={link.url} readOnly autoSize={{ minRows: 2, maxRows: 4 }} />
                <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="canvas-node-inspector-help">预计有效至 {new Date(link.expiresAt).toLocaleString()}</span>
                    <div className="flex shrink-0 gap-2">
                        <Button icon={<UploadCloud className="size-3.5" />} loading={uploading} onClick={() => void uploadToUguu()}>重新上传到 Uguu</Button>
                        <Button icon={<Copy className="size-3.5" />} onClick={() => copyText(link.url, "图片链接已复制")}>复制链接</Button>
                    </div>
                </div>
            </> : <div className="flex items-center justify-between gap-3">
                <p className="canvas-node-inspector-help">{!link ? "正在读取上传状态…" : link.status === "expired" ? "链接已过期，可手动重新上传。" : link.status === "invalid" ? "临时链接无效，可手动重新上传。" : "尚未上传；需要公网参考图的模型会在生成时自动上传。"}</p>
                {resource ? <Button icon={<UploadCloud className="size-3.5" />} loading={uploading} onClick={() => void uploadToUguu()}>上传到 Uguu</Button> : null}
            </div>}
        </section>
    );
}
