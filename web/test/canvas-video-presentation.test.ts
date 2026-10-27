import { expect, test } from "bun:test";

import { canvasVideoPresentationState } from "../src/lib/canvas/canvas-video-presentation";

test("manual playback exposes controls without starting playback or waiting for a decoded frame", () => {
    expect(canvasVideoPresentationState({ active: true, hasSource: true, firstFramePresented: false, manualPlayback: true })).toEqual({ showPoster: false, showVideo: true, showLoading: false });
    expect(canvasVideoPresentationState({ active: true, hasSource: false, firstFramePresented: false, manualPlayback: true })).toEqual({ showPoster: true, showVideo: false, showLoading: true });
    expect(canvasVideoPresentationState({ active: true, hasSource: true, firstFramePresented: false, playbackFailed: true, manualPlayback: true })).toEqual({ showPoster: true, showVideo: false, showLoading: false });
    expect(canvasVideoPresentationState({ active: false, hasSource: true, firstFramePresented: false, manualPlayback: true })).toEqual({ showPoster: true, showVideo: false, showLoading: false });
});

test("the poster remains visible until the active video presents its first frame", () => {
    expect(canvasVideoPresentationState({ active: false, hasSource: false, firstFramePresented: false })).toEqual({
        showPoster: true,
        showVideo: false,
        showLoading: false,
    });
    expect(canvasVideoPresentationState({ active: true, hasSource: false, firstFramePresented: false })).toEqual({
        showPoster: true,
        showVideo: false,
        showLoading: true,
    });
    expect(canvasVideoPresentationState({ active: true, hasSource: true, firstFramePresented: false })).toEqual({
        showPoster: true,
        showVideo: false,
        showLoading: true,
    });
    expect(canvasVideoPresentationState({ active: true, hasSource: true, firstFramePresented: true })).toEqual({
        showPoster: false,
        showVideo: true,
        showLoading: false,
    });
});

test("playback errors end loading and autoplay denial exposes manual controls", () => {
    expect(canvasVideoPresentationState({ active: true, hasSource: true, firstFramePresented: false, playbackFailed: true })).toEqual({ showPoster: true, showVideo: false, showLoading: false });
    expect(canvasVideoPresentationState({ active: true, hasSource: true, firstFramePresented: false, autoplayBlocked: true })).toEqual({ showPoster: false, showVideo: true, showLoading: false });
});
