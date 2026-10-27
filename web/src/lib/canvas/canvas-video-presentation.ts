type CanvasVideoPresentationInput = {
    active: boolean;
    hasSource: boolean;
    firstFramePresented: boolean;
    playbackFailed?: boolean;
    autoplayBlocked?: boolean;
    manualPlayback?: boolean;
};

export function canvasVideoPresentationState({ active, hasSource, firstFramePresented, playbackFailed = false, autoplayBlocked = false, manualPlayback = false }: CanvasVideoPresentationInput) {
    const showVideo = active && hasSource && (firstFramePresented || autoplayBlocked || manualPlayback) && !playbackFailed;
    return {
        showPoster: !showVideo,
        showVideo,
        showLoading: active && !firstFramePresented && !playbackFailed && !autoplayBlocked && !(manualPlayback && hasSource),
    };
}
