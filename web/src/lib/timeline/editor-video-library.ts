import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import type { TimelineProject } from "@/types/timeline";
import { makeClipFromAsset } from "./asset-ingest";
import type { EditCommand } from "./editor-commands";

type EpisodeContext = Pick<ProjectDetail, "units" | "shots" | "shotArtifacts">;

export type EditorVideoGroup = {
    id: string;
    label: string;
    unitId?: string;
    items: ProjectAsset[];
};

export function buildEditorVideoGroups(assets: ProjectAsset[], context?: EpisodeContext): EditorVideoGroup[] {
    const units = [...(context?.units ?? [])].sort((left, right) => left.position - right.position);
    const shots = new Map(context?.shots.map((shot) => [shot.id, shot]) ?? []);
    const artifacts = new Map<string, NonNullable<EpisodeContext["shotArtifacts"]>>();
    for (const artifact of context?.shotArtifacts ?? []) {
        if (!artifact.resourceId || !["video", "delivery"].includes(artifact.type)) continue;
        const entries = artifacts.get(artifact.resourceId) ?? [];
        entries.push(artifact);
        artifacts.set(artifact.resourceId, entries);
    }
    const groups = units.map((unit, index) => ({
        id: unit.id, unitId: unit.id, label: unit.title || `第${index + 1}集`, items: [] as ProjectAsset[],
    }));
    const unassigned: EditorVideoGroup = { id: "unassigned", label: "未分集视频", items: [] };
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const positions = new Map<string, Map<string, number>>();
    for (const asset of assets) {
        if (asset.mediaType !== "video") continue;
        const resourceId = asset.storageKey?.startsWith("resource:") ? asset.storageKey.slice("resource:".length) : asset.id;
        const versions = artifacts.get(resourceId);
        const adopted = versions?.filter((artifact) => artifact.selected && artifact.status === "ready");
        if (versions && !adopted?.length) continue;
        const unitIds = new Set<string>();
        for (const artifact of adopted ?? []) {
            const shot = shots.get(artifact.shotId);
            const unitId = shot?.unitId || artifact.unitId;
            if (!unitId || !groupsById.has(unitId)) continue;
            unitIds.add(unitId);
            const order = positions.get(unitId) ?? new Map<string, number>();
            order.set(asset.id, Math.min(order.get(asset.id) ?? Infinity, shot?.position ?? asset.position));
            positions.set(unitId, order);
        }
        if (!unitIds.size) {
            for (const unitId of asset.unitIds ?? []) {
                if (groupsById.has(unitId)) unitIds.add(unitId);
            }
        }
        if (!unitIds.size) unassigned.items.push(asset);
        for (const unitId of unitIds) {
            const shot = (adopted ?? []).map((artifact) => shots.get(artifact.shotId)).find((entry) => entry?.unitId === unitId);
            groupsById.get(unitId)!.items.push({ ...asset, durationMs: asset.durationMs || shot?.durationMs });
        }
    }
    return [...groups, unassigned].filter((group) => group.items.length > 0).map((group) => ({
        ...group,
        items: group.items.sort((left, right) => {
            const order = positions.get(group.id);
            return (order?.get(left.id) ?? left.position) - (order?.get(right.id) ?? right.position)
                || left.title.localeCompare(right.title, "zh-CN", { numeric: true });
        }),
    }));
}

export function createVideoAppendCommands(project: TimelineProject, assets: ProjectAsset[]): EditCommand[] {
    if (!assets.length) return [];
    const track = project.tracks.find((entry) => entry.kind === "video");
    if (!track) throw new Error("时间线缺少视频轨道，请先添加视频轨道");
    if (track.locked) throw new Error("视频轨道已锁定，请解锁后再导入");
    const videoTrackIds = new Set(project.tracks.filter((entry) => entry.kind === "video").map((entry) => entry.id));
    let startMs = project.clips.filter((clip) => videoTrackIds.has(clip.trackId))
        .reduce((end, clip) => Math.max(end, clip.startMs + clip.durationMs), 0);
    const ids = new Set(project.clips.map((clip) => clip.id));
    return assets.map((asset) => {
        if (asset.mediaType !== "video" || !asset.storageKey?.trim()) {
            throw new Error(`「${asset.title}」缺少可用视频资源，未导入，请刷新后重试`);
        }
        let suffix = 1;
        let id = `asset:${asset.id}`;
        while (ids.has(id)) id = `asset:${asset.id}:${suffix++}`;
        ids.add(id);
        const clip = makeClipFromAsset(asset, { id, trackId: track.id, startMs, defaultDurationMs: 5_000 })!;
        startMs += clip.durationMs;
        return { op: "addClip", payload: { clip } };
    });
}
