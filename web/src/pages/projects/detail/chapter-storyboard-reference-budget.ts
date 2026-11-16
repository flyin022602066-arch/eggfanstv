import type { StoryboardRow } from "@/types/canvas";
import type { ProjectAsset } from "@/services/api/projects";
import { matchProjectShotSequenceAssets } from "@/lib/project-shot-asset-matching";
import type { ChapterStoryboardAsset, ChapterStoryboardCharacter } from "./chapter-storyboard-production";

export function chapterStoryboardReferencePlan(rows: StoryboardRow[], assets: ChapterStoryboardAsset[], characters: ChapterStoryboardCharacter[]) {
    const catalog = assets.filter((asset) => asset.type === "image" || asset.type === "character").map((asset) => ({
        id: asset.id, title: asset.title, category: asset.category || (asset.type === "character" ? "character" : "prop"),
        primaryVersionId: asset.characterVersionId || asset.id,
        definitionJson: JSON.stringify({ aliases: asset.aliases || characters.find((character) => character.assetId === asset.id)?.definition.aliases || [] }),
    })) as ProjectAsset[];
    const matches = matchProjectShotSequenceAssets(catalog, rows.map((row) => ({ script: {
        ...row, referenceAssetIds: undefined, action: row.performanceBlocking, imagePrompt: row.imageGenerationPrompt, videoPrompt: row.videoMotionPrompt,
    } })));
    const counts = matches.map((references) => new Set(references.map((reference) => reference.assetVersionId)).size);
    const issues = counts.flatMap((count, index) => count > 9 ? [`第${index + 1}个单元需要${count}张参考图（${matches[index]!.map(({ asset }) => asset.title).join("、")}），请在完整话轮和动作承接点重新拆分，不删除必要人物、道具或剧情。`] : []);
    return { rows: rows.map((row, index) => ({ ...row, referenceAssetIds: matches[index]!.map(({ asset }) => asset.id) })), counts, issues };
}
