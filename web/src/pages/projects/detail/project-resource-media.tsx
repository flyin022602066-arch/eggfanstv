import { useEffect, useState, type VideoHTMLAttributes } from "react";

import { resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";

export function ProjectResourceMedia({ storageKey, src = "", kind = "video", ...props }: Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & { storageKey?: string; src?: string; kind?: "video" | "audio" }) {
    const [media, setMedia] = useState({ key: "", url: "", failed: false });
    const key = `${storageKey || ""}\n${src}`;
    useEffect(() => {
        let cancelled = false;
        const pending = resourceIdFromStorageKey(storageKey) ? cacheResourceObjectUrl(storageKey!) : resolveMediaUrl(storageKey, src);
        void pending.then((url) => {
            if (!cancelled) setMedia({ key, url, failed: !url });
        }).catch(() => {
            if (!cancelled) setMedia({ key, url: "", failed: true });
        });
        return () => { cancelled = true; };
    }, [key, src, storageKey]);
    if (media.key !== key || !media.url) return <span role="status" className="grid h-full min-h-12 place-items-center text-xs text-foreground/45">{media.key === key && media.failed ? "媒体加载失败，请刷新重试" : "正在加载媒体…"}</span>;
    return kind === "audio" ? <audio {...props} src={media.url} /> : <video {...props} src={media.url} />;
}
