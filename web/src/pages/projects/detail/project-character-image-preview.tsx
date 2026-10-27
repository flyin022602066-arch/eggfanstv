import { useEffect, useState } from "react";
import { Button } from "antd";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";

type OriginalImage = { src: string; width: number; height: number };

export function ProjectCharacterImagePreview({ resourceId, title }: { resourceId: string; title: string }) {
    const [image, setImage] = useState<OriginalImage | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [open, setOpen] = useState(false);
    const openOriginal = () => { if (image) setOpen(true); };
    return <div className="project-character-image-preview">
        <button type="button" className="project-character-image-button" aria-label={`查看角色原图：${title}`} title="点击放大查看原图" disabled={!image} onClick={openOriginal}>
            <CachedResourceImage eager storageKey={`resource:${resourceId}`} alt={title} className="project-asset-preview-media" onLoad={(event) => {
                const element = event.currentTarget;
                if (element.naturalWidth && element.naturalHeight) { setLoadFailed(false); setImage({ src: element.currentSrc || element.src, width: element.naturalWidth, height: element.naturalHeight }); }
            }} onError={() => { setImage(null); setLoadFailed(true); }} fallback={<span>原图加载失败，请关闭后重试</span>} />
        </button>
        <div className="project-character-image-info">
            <span role="status">{image ? `原图：${image.width} × ${image.height} px` : loadFailed ? "原图加载失败" : "正在读取原图尺寸…"}</span>
            <Button size="small" icon={<Maximize2 className="size-3.5" />} disabled={!image} onClick={openOriginal}>查看原图</Button>
        </div>
        {open && image ? <CharacterOriginalImage image={image} title={title} onClose={() => setOpen(false)} /> : null}
    </div>;
}

function CharacterOriginalImage({ image, title, onClose }: { image: OriginalImage; title: string; onClose: () => void }) {
    const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [zoom, setZoom] = useState<number | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!viewportElement) return;
        const observer = new ResizeObserver(() => setViewport({ width: viewportElement.clientWidth, height: viewportElement.clientHeight }));
        observer.observe(viewportElement);
        return () => observer.disconnect();
    }, [viewportElement]);
    const fitScale = Math.min(1, Math.max(1, viewport.width) / image.width, Math.max(1, viewport.height) / image.height);
    const scale = zoom ?? fitScale;
    const changeZoom = (factor: number) => setZoom(Math.max(0.01, Math.min(4, Math.round(scale * factor * 100) / 100)));
    return <AppModal open centered width="calc(100vw - 32px)" className="project-character-original-modal" title={`${title} · 角色原图`} onCancel={onClose} footer={<Button onClick={onClose}>返回角色卡</Button>}>
        <div className="project-character-original-toolbar">
            <span>原图：{image.width} × {image.height} px</span>
            <div className="project-character-original-controls">
                <Button size="small" aria-pressed={zoom === null} onClick={() => setZoom(null)}>适应窗口</Button>
                <Button size="small" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>100% 原尺寸</Button>
                <Button size="small" aria-label="缩小原图" icon={<ZoomOut className="size-3.5" />} disabled={scale <= 0.01} onClick={() => changeZoom(1 / 1.25)} />
                <span role="status" className="project-character-original-scale">{Math.round(scale * 100)}%</span>
                <Button size="small" aria-label="放大原图" icon={<ZoomIn className="size-3.5" />} disabled={scale >= 4} onClick={() => changeZoom(1.25)} />
            </div>
        </div>
        <div ref={setViewportElement} className="project-character-original-viewport thin-scrollbar" tabIndex={0} aria-label="角色原图滚动区域">
            <div className="project-character-original-content">
                {failed ? <p role="alert">原图读取失败，请返回角色卡后重新打开。</p> : <img src={image.src} alt={`${title}原图`} className="project-character-original-image" draggable={false} style={{ width: image.width * scale, height: image.height * scale }} onError={() => setFailed(true)} />}
            </div>
        </div>
        <p className="project-character-original-hint">100% 按原图像素显示，可滚动查看细节；点击“适应窗口”查看完整图片。</p>
    </AppModal>;
}
