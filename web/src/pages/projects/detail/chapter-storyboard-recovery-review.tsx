import { useMemo, useState } from "react";
import { Select } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import type { StoryboardRow } from "@/types/canvas";
import type { ProjectDetail } from "@/services/api/projects";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";
import type { ShotAssetAmbiguity } from "@/lib/project-shot-asset-matching";
import { reviewStoryboardCharacterReferences, storyboardRowsToProjectShots, type ChapterStoryboardReplaceImpact, type ProjectShotReplacementInput } from "./chapter-storyboard-production";

export function ChapterStoryboardRecoveryReview({ rows, detail, versions, impact, onCancel, onConfirm }: {
    rows: StoryboardRow[];
    detail: ProjectDetail;
    versions: CharacterReferenceVersion[];
    impact: ChapterStoryboardReplaceImpact;
    onCancel: () => void;
    onConfirm: (shots: ProjectShotReplacementInput[]) => void;
}) {
    const [selections, setSelections] = useState<Record<string, string>>({});
    const [versionSelections, setVersionSelections] = useState<Record<string, string>>({});
    const versionChoices = useMemo(() => reviewStoryboardCharacterReferences(rows, detail, versions).issues, [rows, detail, versions]);
    const review = useMemo(() => {
        const issues = new Map<string, ShotAssetAmbiguity>();
        const characterReview = reviewStoryboardCharacterReferences(rows, detail, versions, versionSelections);
        try {
            const shots = characterReview.issues.length ? [] : storyboardRowsToProjectShots(characterReview.rows, detail, versions, {
                assetSelections: selections,
                onAmbiguousAsset: (issue) => issues.set(issue.key, issue),
            });
            return { shots, issues: [...issues.values()], versionIssues: characterReview.issues, error: "" };
        } catch (error) {
            return { shots: [], issues: [...issues.values()], versionIssues: characterReview.issues, error: error instanceof Error ? error.message : "分镜资产核对失败" };
        }
    }, [rows, detail, versions, selections, versionSelections]);
    const [discoveredChoices, setDiscoveredChoices] = useState<ShotAssetAmbiguity[]>([]);
    const choices = [...new Map([...discoveredChoices, ...review.issues].map((issue) => [issue.key, issue])).values()];
    const unresolved = review.issues.length > 0 || review.versionIssues.length > 0 || Boolean(review.error) || !review.shots.length;
    return <AppModal open title={impact.shotCount ? `用已生成的 ${rows.length} 个分镜替换本章当前分镜？` : `把已生成的 ${rows.length} 个分镜写入本章？`} width={640}
        okText="写入已生成的分镜" cancelText="先不写入" centered
        okButtonProps={{ danger: Boolean(impact.shotCount), disabled: unresolved }}
        onCancel={onCancel} onOk={() => { if (!unresolved) onConfirm(review.shots); }}>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto text-sm leading-6 text-foreground/70">
            <p>不会重新生成，也不会再次扣费。确认后才会写入；取消则结果仍保留。</p>
            {impact.shotCount ? <p>替换会移除 {impact.shotCount} 个镜头、{impact.revisionCount} 个脚本版本、{impact.referenceCount} 个资产引用、{impact.artifactCount} 个生成产物{impact.candidateCount ? `及 ${impact.candidateCount} 个相关候选资产` : ""}，此操作无法撤销。</p> : null}
            {versionChoices.length ? <Callout tone="warning" title="请核对角色造型版本">已定位 {versionChoices.length} 处无效引用。保留全部分镜正文；只需为下列镜头选择该角色的正确版本，不会自动猜选或绑定其他角色。</Callout> : null}
            {versionChoices.map((issue) => <div key={issue.key} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
                <p className="font-medium text-foreground">{issue.shotLabel} · {issue.characterName}</p>
                <p className="break-all text-xs">资产 ID：{issue.assetId}<br />返回版本 ID：{issue.versionId}</p>
                <p className="break-words">{issue.reason}</p>
                {issue.candidates.length ? <Select className="w-full min-w-0" aria-label={`核对${issue.shotLabel}${issue.characterName}版本`} placeholder="请选择该角色的正确版本" value={versionSelections[issue.key]}
                    options={issue.candidates.map((version) => ({ value: version.versionId, label: `v${version.version} · ${version.referenceProfile?.name || String(version.definition.clothing || version.definition.appearance || "基础造型").slice(0, 50)} · ID ${version.versionId.slice(0, 12)}` }))}
                    onChange={(value) => setVersionSelections((current) => ({ ...current, [issue.key]: value }))} />
                    : <p>该角色没有可用版本，请先到“角色与资产”确认角色后重新打开核对。原分镜结果仍保留，不需要重新生成。</p>}
            </div>)}
            {choices.length ? <Callout tone="warning" title="请核对同名资产">同名资产不会自动猜选。为本次分镜明确选择正确资产后即可写入，不需要重新拆解。</Callout> : null}
            {choices.map((issue) => <label key={issue.key} className="block space-y-1">
                <span>{issue.name} · {issue.assets[0]?.category === "character" ? "角色" : issue.assets[0]?.category === "environment" ? "场景" : "道具"}</span>
                <Select className="w-full" aria-label={`核对${issue.name}资产`} placeholder="请选择本次使用的资产" value={selections[issue.key]}
                    options={issue.assets.map((asset) => ({ value: asset.id, label: `${asset.title} · ${String(asset.character?.definition.clothing || asset.previewText || "未填写造型描述").slice(0, 70)} · ID ${asset.id.slice(0, 12)}` }))}
                    onChange={(value) => { setDiscoveredChoices(choices); setSelections((current) => ({ ...current, [issue.key]: value })); }} />
            </label>)}
            {review.error ? <Callout tone="error" title="暂时无法写入">{review.error}</Callout> : null}
        </div>
    </AppModal>;
}
