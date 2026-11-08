import { createRoot } from "react-dom/client";
import { StudioPlayer, type StudioTrack } from "@/pages/music/studio-player";
import { configureApiRuntime } from "@/services/api/request";
import { downloadSunoClip } from "@/services/suno-studio";
import { saveLocalMedia } from "@/services/local-media-repository";
import { addSunoStudioJob, useSunoStudioStore, type SunoStudioJob } from "@/stores/use-suno-studio-store";

configureApiRuntime(location.origin + "/api", "synthetic-suno-media-token");
const source = new URLSearchParams(location.search).get("source");
const clip = { id: "song", title: "测试歌曲", audioUrl: source === "remote" ? "https://cors-blocked.invalid/song.wav" : location.origin + "/api/resources/song/file", storageKey: source === "legacy" || source === "remote" ? undefined : "resource:song", assetId: source === "remote" ? undefined : "saved-song" };
const job: SunoStudioJob = { id: "saved-job", channelId: "fixture", baseUrl: "https://unused.invalid", operationId: "post-suno-submit-music", label: "已取回歌曲", status: "succeeded", values: {}, clips: [clip], createdAt: "fixture", updatedAt: "fixture" };
await useSunoStudioStore.getState().hydrate("guest");
await addSunoStudioJob("guest", job);
let track: StudioTrack = { clip, job };
if (source === "local") {
    const response = await fetch("/fixture.wav");
    if (!response.ok) throw new Error("Fixture audio missing");
    await saveLocalMedia("audio:guest:local-song", await response.blob());
    track = { local: true, clip: { id: "local-song", title: "本地缓存歌曲", storageKey: "audio:guest:local-song" } };
}
createRoot(document.getElementById("root")!).render(<StudioPlayer track={track} playIntent={0} busy={null} canApplyRange onSource={() => {}} onImport={() => {}} onRange={() => {}} onDownload={() => { void downloadSunoClip(job.id, clip.id).catch(error => { const alert = document.createElement("p"); alert.setAttribute("role", "alert"); alert.textContent = String(error); document.body.append(alert); }); }} />);
