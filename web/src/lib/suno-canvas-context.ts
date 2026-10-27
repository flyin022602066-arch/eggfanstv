import type { SunoStudioClip, SunoStudioJob } from "@/stores/use-suno-studio-store";

export type SunoCanvasTextSource = {
    id: string;
    title: string;
    text: string;
};

export type SunoCanvasAudioSource = {
    id?: string;
    title: string;
    channelId?: string;
    taskId?: string;
    clips: SunoStudioClip[];
};

export type SunoCanvasContext = {
    projectId: string;
    nodeId: string;
    title: string;
    preferredChannelId?: string;
    textSources?: SunoCanvasTextSource[];
    audioSources?: SunoCanvasAudioSource[];
    onReturnClip: (job: SunoStudioJob, clip: SunoStudioClip) => Promise<void>;
    onReturnText: (text: string) => void;
    onClose: () => void;
};
