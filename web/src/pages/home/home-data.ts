import { AudioLines, Bot, Plug, Clapperboard, Image, Layers3, Scissors, Video } from "lucide-react";

export const eggfansCapabilityItems = [
    { id: "agent", label: "Eggfans Agent", detail: "进入创作工作台", to: "/create", icon: Bot, disabled: false },
    { id: "mcp", label: "Eggfans MCP", detail: "连接外部 MCP 工具", to: "/agents", icon: Plug, disabled: false },
    { id: "canvas", label: "自由画布", detail: "组织镜头与素材", to: "/canvas?mode=new", icon: Layers3, disabled: false },
    { id: "video", label: "视频生成", detail: "在画布中创建视频节点", to: "/canvas?mode=new&add=video", icon: Video, disabled: false },
    { id: "image", label: "图片生成", detail: "在画布中创建图片节点", to: "/canvas?mode=new&add=image", icon: Image, disabled: false },
    // Audio generation is a creation entry, not an asset filter. Start a
    // local canvas and let the canvas insert the correctly configured node.
    { id: "audio", label: "音频生成", detail: "配音与声音素材", to: "/canvas?mode=new&add=audio", icon: AudioLines, disabled: false },
    { id: "edit", label: "智能剪辑", detail: "打开完整剪辑工作台", to: "/editor", icon: Scissors, disabled: false },
    { id: "projects", label: "项目制作", detail: "打开项目库管理创作", to: "/project", icon: Clapperboard, disabled: false },
] as const;
