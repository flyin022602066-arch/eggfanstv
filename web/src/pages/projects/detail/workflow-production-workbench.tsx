import { ImageSizePicker } from "@/components/image-size-picker";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, InputNumber, Select } from "antd";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Switch } from "@/components/ui/base/switch";
import { EmptyState } from "@/components/ui/product/empty-state";
import { StatusBadge } from "@/components/ui/base/badges";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { Box, ChevronDown, ChevronLeft, ChevronRight, Download, Film, Image as ImageIcon, Layers3, List, Maximize2, Play, Plus, RefreshCcw, Save, Search, SlidersHorizontal, Trash2, UsersRound, WandSparkles, X } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ModelPicker } from "@/components/model-picker";
import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { VideoTaskLocalStop } from "@/components/generation/video-task-local-stop";
import { explainGenerationError } from "@/lib/generation-error";
import { JiasuVideoReferenceSettings } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { hasAutomaticVideoAudio, modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationOptions } from "@/lib/model-capabilities";
import { customShotTitle, formatShotOrdinal, normalizeDefaultShotTitle } from "@/lib/shot-label";
import { modelCompatibilityError, resolveActiveWorkflowModel, resolveCompatibleModel, resolveModelVideoBooleanOptions, resolveWorkflowModelPreference, type ModelRequirements } from "@/lib/model-selection";
import { formatVideoResolutionLabel } from "@/lib/video-generation-options";
import type { ProjectWorkflowModelStage } from "@/lib/project-workflow-model-preferences";
import { latestWorkflowShotTasks } from "@/lib/workflow-shot-task";
import { shotActionBeats } from "@/lib/project-shot-asset-matching";
import { reviewChapterStoryboardPrompt } from "@/lib/chapter-storyboard-mode";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { prepareProjectShotAssets, prepareProjectUnitShotAssets } from "@/services/project-shot-assets";
import { queryFailedVideoProviderTask, type GenerationTask } from "@/services/api/task-center";
import {
    createUnitWorkflow,
    deleteProjectShot,
    linkShotAsset,
    listProjectAssetsPage,
    saveProjectShot,
    unlinkShotAsset,
    type ProjectAsset,
    type ProjectDetail,
    type ProjectShot,
    type ShotAssetReference,
    type ShotArtifact,
    type ShotRevisionInput,
    type WorkflowStep,
} from "@/services/api/projects";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { downloadOwnedOrBrowserMedia, isWailsNativeShell } from "@/services/desktop-media-save";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";
import { skillRuntime } from "@/services/skill-runtime";
import { configuredModelMatchesCapability, modelDisplayName, modelOptionName, modelOptionsFromChannels, resolveModelChannel, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { SkillRuntimePicker, useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";

import {
    ArtifactStatus,
    artifactTypeForStage,
    assetCategoryLabel,
    currentArtifact,
    currentRevision,
    formatDuration,
    type ShortDramaWorkflowStage,
} from "./workflow-shared";
import { buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, resolveShotAssetMentionPrompt } from "./workflow-shot-references";
import { ProjectResourceMedia } from "./project-resource-media";
import { ProjectPropCreateModal } from "./project-prop-create-modal";
import { prepareWorkflowVideoPrompt, resolveWorkflowVideoSubmissionPrompt } from "./workflow-video-prompt";

type ShotEditorValues = Omit<ShotRevisionInput, "durationMs"> & {
    title: string;
    durationSeconds: number;
};

type Props = {
    activeStage: ShortDramaWorkflowStage;
    detail: ProjectDetail;
    projectId: string;
    unitId: string;
    workflowStep?: WorkflowStep;
    selectedShot?: ProjectShot;
    onSelectShot: (id: string) => void;
    onRefresh: () => Promise<void>;
    onAddShot: () => void;
    addingShot: boolean;
};

const productionStageCopy: Record<"storyboard" | "previz" | "video", { label: string; action: string; empty: string }> = {
    storyboard: { label: "分镜图", action: "生成分镜图", empty: "生成静态分镜图，确认构图、景别与角色位置" },
    previz: { label: "动作预演", action: "生成黑白预演", empty: "生成黑白动作预演，确认表演节拍与镜头运动" },
    video: { label: "镜头视频", action: "生成镜头视频", empty: "选择视频模型后生成当前镜头" },
};

export default function WorkflowProductionWorkbench(props: Props) {
    const { activeStage, detail, projectId, unitId, workflowStep, selectedShot, onSelectShot, onRefresh, onAddShot, addingShot } = props;
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const theme = canvasThemes[useActiveTheme()];
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [form] = Form.useForm<ShotEditorValues>();
    const watchedDuration = Form.useWatch("durationSeconds", form);
    const watchedTitle = Form.useWatch("title", form);
    const watchedPromptValues = Form.useWatch((values) => values, form) as ShotEditorValues | undefined;
    const debouncedPromptValues = useDebouncedValue(watchedPromptValues, 250);
    const [leftTab, setLeftTab] = useState<"assets" | "episodes" | "shots">("episodes");
    const [previewTab, setPreviewTab] = useState<"latest" | "history">("latest");
    const [previewArtifactId, setPreviewArtifactId] = useState("");
    const [imagePreviewArtifact, setImagePreviewArtifact] = useState<ShotArtifact | null>(null);
    const [newPropName, setNewPropName] = useState<string | null>(null);
    const [editorDirty, setEditorDirty] = useState(false);
    const [submittingShotIds, setSubmittingShotIds] = useState<Set<string>>(() => new Set());
    const submittingShotsRef = useRef(new Set<string>());
    const [submissionError, setSubmissionError] = useState<{ shotId: string; text: string; submitted: boolean } | null>(null);
    const [generationSettingsOpen, setGenerationSettingsOpen] = useState(true);
    const [advancedOpen, setAdvancedOpen] = useState(true);
    const [promptOpen, setPromptOpen] = useState(true);
    const [taskClock, setTaskClock] = useState(() => Date.now());
    const [locallyStoppedTask, setLocallyStoppedTask] = useState<GenerationTask | null>(null);
    const activeShotIdRef = useRef(selectedShot?.id || "");
    activeShotIdRef.current = selectedShot?.id || "";
    const shots = useMemo(() => (detail.shots || []).filter((item) => item.unitId === unitId).slice().sort((left, right) => left.position - right.position), [detail.shots, unitId]);
    const shotIndex = selectedShot ? shots.findIndex((item) => item.id === selectedShot.id) : -1;
    const revision = currentRevision(detail, selectedShot);
    const savedPromptReview = useMemo(() => {
        const timeBeats = shotActionBeats(revision?.actionBeatsJson).flatMap((beat) => typeof beat.description === "string" ? [beat.description] : []).join("\n");
        return timeBeats ? reviewChapterStoryboardPrompt([{ durationSeconds: (revision?.durationMs || 0) / 1000, videoMotionPrompt: (revision?.videoPrompt || "").split(/\n【(?:角色参考|场景与道具参考)】/u)[0], timeBeats }]) : [];
    }, [revision]);
    const artifactType = artifactTypeForStage(activeStage);
    const artifacts = useMemo(() => selectedShot ? (detail.shotArtifacts || []).filter((item) => item.shotId === selectedShot.id && item.type === artifactType).slice().sort((left, right) => right.version - left.version) : [], [artifactType, detail.shotArtifacts, selectedShot]);
    const latestShotTask = useMemo(() => latestWorkflowShotTasks(detail.tasks || [], artifactType).get(selectedShot?.id || ""), [artifactType, detail.tasks, selectedShot?.id]);
    const shotTask = locallyStoppedTask && locallyStoppedTask.id === latestShotTask?.id && Date.parse(latestShotTask.updatedAt) <= Date.parse(locallyStoppedTask.updatedAt) ? locallyStoppedTask : latestShotTask;
    const shotTaskActive = shotTask?.status === "queued" || shotTask?.status === "running";
    useEffect(() => {
        if (shotTask?.status !== "queued" && shotTask?.status !== "running") return;
        const timer = window.setInterval(() => setTaskClock(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [shotTask?.status, shotTask?.id]);
    const shotTaskElapsed = shotTask ? formatTaskElapsed(Date.parse(shotTask.startedAt || shotTask.createdAt), taskClock) : "";
    const newestArtifact = artifacts.find((item) => item.selected) || artifacts[0];
    const previewArtifact = artifacts.find((item) => item.id === previewArtifactId) || newestArtifact;
    const generationCapability = activeStage === "video" ? "video" as const : "image" as const;
    const modelOptions = useMemo(() => selectableModelsByCapability(effectiveConfig, generationCapability), [effectiveConfig, generationCapability]);
    const allModelOptions = useMemo(() => modelOptionsFromChannels(effectiveConfig.channels), [effectiveConfig.channels]);
    const projectDefaultModel = generationCapability === "video" ? detail.project.defaultVideoModel : detail.project.defaultImageModel;
    const globalDefaultModel = generationCapability === "video" ? effectiveConfig.videoModel : effectiveConfig.imageModel;
    const modelStage: ProjectWorkflowModelStage = activeStage === "video" ? "video" : activeStage === "previz" ? "previz" : "storyboard";
    const rememberedModel = effectiveConfig.projectWorkflowModels?.[projectId]?.[modelStage];
    const initialModel = resolveWorkflowModelPreference({ rememberedModel, projectDefaultModel, globalDefaultModel, selectableModels: modelOptions, allModels: allModelOptions });
    const [selectedModel, setSelectedModel] = useState(initialModel);
    const selectedModelRef = useRef(initialModel);
    const modelSettingsScopeRef = useRef("");
    const activeSelectedModel = resolveActiveWorkflowModel({ config: effectiveConfig, capability: generationCapability, selectedModel, initialModel });
    const selectedModelUnavailable = Boolean((selectedModel || initialModel) && !activeSelectedModel);
    const [aspectRatio, setAspectRatio] = useState(detail.project.aspectRatio || "16:9");
    const [resolution, setResolution] = useState(effectiveConfig.vquality || "720");
    const [imageQuality, setImageQuality] = useState(effectiveConfig.quality || "auto");
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
    const { skills: availableSkills, loading: skillsLoading } = useSkillRuntimeCatalog();
    const shotAssetReferenceContext = useMemo(() => buildShotAssetReferenceContext(detail, selectedShot?.id || ""), [detail, selectedShot?.id]);
    const referenceByVersionId = useMemo(() => {
        const references = (detail.shotReferences || []).filter((reference) => reference.shotId === selectedShot?.id && reference.role === "reference" && reference.status === "linked");
        return new Map(references.flatMap((reference) => [
            [reference.assetVersionId, reference] as const,
            ...(reference.asset?.primaryVersionId ? [[reference.asset.primaryVersionId, reference] as const] : []),
        ]));
    }, [detail.shotReferences, selectedShot?.id]);
    const currentDurationSeconds = Number(watchedDuration || Math.max(0.5, (selectedShot?.durationMs || 3000) / 1000));
    const generationSeconds = String(Math.max(1, Math.round(currentDurationSeconds)));
    const generationReferenceAudios = generationCapability === "video" ? shotAssetReferenceContext.referenceAudios : [];
    const videoEditOperation = generationCapability === "video" && shotAssetReferenceContext.referenceImages.length ? "reference_to_video" : undefined;
    const modelRequirements = useMemo<ModelRequirements>(() => ({
        capability: generationCapability,
        input: { textCount: 1, imageCount: shotAssetReferenceContext.referenceImages.length, videoCount: 0, audioCount: generationReferenceAudios.length, characterCount: 0 },
        videoOperation: videoEditOperation,
        videoSeconds: generationCapability === "video" ? generationSeconds : undefined,
        imageSize: generationCapability === "image" ? aspectRatio : undefined,
        options: generationCapability === "video"
            ? { size: aspectRatio, vquality: resolution, videoSeconds: Number(generationSeconds) }
            : { size: aspectRatio, quality: imageQuality },
    }), [aspectRatio, generationCapability, generationReferenceAudios.length, generationSeconds, imageQuality, resolution, shotAssetReferenceContext.referenceImages.length, videoEditOperation]);
    const routedModel = resolveCompatibleModel(effectiveConfig, activeSelectedModel, modelRequirements) || activeSelectedModel;
    const activeProfile = useMemo(() => modelCapabilityConfigFor(effectiveConfig, routedModel), [effectiveConfig, routedModel]);
    const videoProfile = generationCapability === "video" ? activeProfile.video : undefined;
    const durationError = generationCapability === "video" && routedModel ? modelCompatibilityError(effectiveConfig, routedModel, { capability: "video", videoSeconds: generationSeconds }) : "";
    const automaticAudio = hasAutomaticVideoAudio(resolveModelChannel(effectiveConfig, routedModel).interfaceType);
    const imageProfile = generationCapability === "image" ? activeProfile.image : undefined;
    const videoBooleanOptions = useMemo(() => generationCapability === "video"
        ? resolveModelVideoBooleanOptions(effectiveConfig, routedModel, {
              videoGenerateAudio: effectiveConfig.videoGenerateAudio,
          }, {
              videoWatermark: effectiveConfig.videoWatermark,
          })
        : undefined, [effectiveConfig, generationCapability, routedModel]);
    const generationConfig = useMemo(() => ({
        ...effectiveConfig,
        model: routedModel,
        imageModel: generationCapability === "image" ? routedModel : effectiveConfig.imageModel,
        videoModel: generationCapability === "video" ? routedModel : effectiveConfig.videoModel,
        size: aspectRatio,
        quality: imageQuality,
        vquality: resolution,
        videoSeconds: generationSeconds,
        ...(generationCapability === "video" ? { videoEggfansReferenceMode: "url" as const } : {}),
        ...(videoBooleanOptions || {}),
    }), [aspectRatio, effectiveConfig, generationCapability, generationSeconds, imageQuality, resolution, routedModel, videoBooleanOptions]);
    const modelSummary = routedModel ? modelDisplayName(effectiveConfig, routedModel) : "未选择模型";
    const durationSummary = Number(watchedDuration) === -1 ? "自动" : `${Number(watchedDuration || Math.max(0.5, (selectedShot?.durationMs || 3000) / 1000))}s`;
    const resolutionSummary = generationCapability === "video" ? formatVideoResolutionLabel(resolution) : imageQuality.toUpperCase();
    const promptPreview = useQuery({
        queryKey: ["workflow-video-prompt", selectedShot?.id, debouncedPromptValues, shotAssetReferenceContext, routedModel, selectedSkillIds, availableSkills.map((skill) => [skill.skillId, skill.versionId])],
        queryFn: () => prepareWorkflowVideoPrompt({ values: debouncedPromptValues || {}, context: shotAssetReferenceContext, interfaceType: resolveModelRequestConfig(generationConfig, routedModel).interfaceType, skills: availableSkills, selectedSkillIds }),
        enabled: generationCapability === "video" && Boolean(selectedShot && debouncedPromptValues) && !skillsLoading,
        retry: false,
    });
    const [finalPromptDraft, setFinalPromptDraft] = useState<string | undefined>(undefined);
    const finalPromptResetKey = `${selectedShot?.id || ""}|${routedModel || ""}|${selectedSkillIds.join(",")}`;
    const finalPromptResetKeyRef = useRef(finalPromptResetKey);

    const initializeModelSettings = useEffectEvent(() => {
        const scope = JSON.stringify([projectId, modelStage, detail.project.aspectRatio]);
        if (modelSettingsScopeRef.current === scope && selectedModelRef.current === initialModel) return;
        modelSettingsScopeRef.current = scope;
        selectedModelRef.current = initialModel;
        setSelectedModel(initialModel);
        if (!initialModel || !configuredModelMatchesCapability(effectiveConfig, initialModel, generationCapability)) return;
        const profile = modelCapabilityConfigFor(effectiveConfig, initialModel);
        if (generationCapability === "video" && profile.video) {
            const normalized = normalizeVideoValue(profile.video, {
                seconds: effectiveConfig.videoSeconds,
                ratio: detail.project.aspectRatio || effectiveConfig.size,
                resolution: effectiveConfig.vquality,
            });
            setAspectRatio(normalized.ratio);
            setResolution(normalized.resolution);
        } else if (generationCapability === "image" && profile.image) {
            const normalized = normalizeImageValue(profile.image, { size: detail.project.aspectRatio || effectiveConfig.size, quality: effectiveConfig.quality, count: "1" });
            setAspectRatio(normalized.size);
            setImageQuality(normalized.quality);
        }
    });
    useEffect(() => {
        initializeModelSettings();
    }, [detail.project.aspectRatio, projectId, modelStage, initialModel]);

    const initializeShotEditor = useEffectEvent(() => {
        const shotDurationSeconds = Math.max(0.5, (revision?.durationMs || selectedShot?.durationMs || 3000) / 1000);
        const videoPrompt = ensureShotAssetMentionPrompt(revision?.videoPrompt || "", shotAssetReferenceContext.mentionReferences);
        form.setFieldsValue({
            title: normalizeDefaultShotTitle(selectedShot?.title, Math.max(0, shotIndex)),
            plotDescription: revision?.plotDescription || selectedShot?.description || "",
            action: revision?.action || "",
            dialogue: revision?.dialogue || "",
            shotSize: revision?.shotSize || "",
            cameraAngle: revision?.cameraAngle || "",
            cameraMovement: revision?.cameraMovement || "",
            durationSeconds: shotDurationSeconds,
            imagePrompt: revision?.imagePrompt || "",
            videoPrompt,
            negativePrompt: revision?.negativePrompt || "",
            continuityNotes: revision?.continuityNotes || "",
        });
        setPreviewArtifactId("");
        setImagePreviewArtifact(null);
        setEditorDirty(!revision || videoPrompt !== revision.videoPrompt);
    });
    useEffect(() => {
        initializeShotEditor();
    }, [projectId, unitId, modelStage, revision?.id, selectedShot?.id]);

    useEffect(() => {
        setGenerationSettingsOpen(true);
        setAdvancedOpen(true);
        setPromptOpen(true);
    }, [activeStage, selectedShot?.id]);
    useEffect(() => {
        if (finalPromptResetKeyRef.current === finalPromptResetKey) return;
        finalPromptResetKeyRef.current = finalPromptResetKey;
        setFinalPromptDraft(undefined);
    }, [finalPromptResetKey]);
    useEffect(() => {
        setFinalPromptDraft(undefined);
    }, [promptPreview.data?.prompt]);

    const synchronizeAssetMentions = useEffectEvent(() => {
        const value = form.getFieldValue("videoPrompt") || "";
        const next = ensureShotAssetMentionPrompt(value, shotAssetReferenceContext.mentionReferences);
        if (value !== next) {
            form.setFieldValue("videoPrompt", next);
            setEditorDirty(true);
        }
    });
    useEffect(() => {
        synchronizeAssetMentions();
    }, [selectedShot?.id, shotAssetReferenceContext.mentionReferences]);

    const changeGenerationModel = (nextModel: string) => {
        selectedModelRef.current = nextModel;
        setSelectedModel(nextModel);
        const preferences = useConfigStore.getState().config.projectWorkflowModels || {};
        updateConfig("projectWorkflowModels", { ...preferences, [projectId]: { ...preferences[projectId], [modelStage]: nextModel } });
        const profile = modelCapabilityConfigFor(effectiveConfig, nextModel);
        if (generationCapability === "video" && profile.video) {
            const normalized = normalizeVideoValue(profile.video, {
                seconds: String(form.getFieldValue("durationSeconds") || generationSeconds),
                ratio: aspectRatio,
                resolution,
            });
            setAspectRatio(normalized.ratio);
            setResolution(normalized.resolution);
            return;
        }
        if (generationCapability === "image" && profile.image) {
            const normalized = normalizeImageValue(profile.image, { size: aspectRatio, quality: imageQuality, count: "1" });
            setAspectRatio(normalized.size);
            setImageQuality(normalized.quality);
        }
    };

    const saveShot = useMutation({
        mutationFn: async (values: ShotEditorValues) => {
            if (!selectedShot) throw new Error("请先选择镜头");
            return saveProjectShot(projectId, {
                id: selectedShot.id,
                unitId,
                title: values.title,
                description: values.plotDescription,
                position: selectedShot.position,
                durationMs: Math.round(values.durationSeconds * 1000),
                status: selectedShot.status,
                revision: revisionInput(values, shotActionBeats(revision?.actionBeatsJson)),
            });
        },
        onSuccess: async () => { setEditorDirty(false); await onRefresh(); message.success("镜头脚本已保存为新版本"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头保存失败"),
    });

    const recoverVideo = useMutation({
        mutationFn: (task: GenerationTask) => queryFailedVideoProviderTask(task.id),
        onSuccess: async (result) => {
            message[result.recovered ? "success" : "info"](result.recovered ? "已取回视频并保存到原镜头" : "上游仍在生成，已恢复原任务自动查询");
            try {
                await onRefresh();
            } catch {
                message.warning("任务查询已完成，界面刷新失败，请刷新项目查看最新结果");
            }
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "原任务查询失败，请稍后再次查询"),
    });
    const canRecoverVideo = generationCapability === "video" && shotTask?.status === "failed" && Boolean(shotTask.providerRequestId?.trim());

    const deleteShot = useMutation({
        mutationFn: async ({ shotId }: { shotId: string; nextShotId: string }) => deleteProjectShot(projectId, shotId),
        onSuccess: async (_result, { nextShotId }) => {
            onSelectShot(nextShotId);
            await onRefresh();
            message.success("镜头已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头删除失败"),
    });

    const changeAssetBinding = useMutation({
        mutationFn: async ({ asset, reference }: { asset?: ProjectAsset; reference?: ShotAssetReference }) => {
            if (!selectedShot) throw new Error("请先选择镜头");
            if (reference) return unlinkShotAsset(projectId, selectedShot.id, reference.id);
            if (!asset?.primaryVersionId) throw new Error("该资产还没有可绑定版本");
            return linkShotAsset(projectId, selectedShot.id, { assetVersionId: asset.primaryVersionId, role: "reference" });
        },
        onSuccess: async (_result, variables) => { await onRefresh(); message.success(variables.reference ? "已取消当前镜头的资产引用" : "资产已绑定到当前镜头"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头资产更新失败"),
    });

    const matchAssetBindings = useMutation({
        mutationFn: async () => {
            if (!selectedShot) throw new Error("请先选择镜头");
            return prepareProjectShotAssets({ projectId, unitId, shotId: selectedShot.id, script: form.getFieldsValue(true) });
        },
        onSuccess: async ({ boundCount, unresolvedSceneShotIds }) => {
            await onRefresh();
            if (unresolvedSceneShotIds.length) message.warning("当前镜头的场景尚未确定，请在资产列表绑定对应场景");
            else message.success(boundCount ? `已补齐 ${boundCount} 个资产，保留已有绑定版本` : "当前资产绑定已完整，无需重复绑定");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "镜头资产匹配失败"),
    });

    const matchChapterAssets = useMutation({
        mutationFn: () => prepareProjectUnitShotAssets({ projectId, unitId }),
        onSuccess: async ({ boundCount, unresolvedSceneShotIds, skippedShotIds }) => {
            await onRefresh();
            if (unresolvedSceneShotIds.length) message.warning(`已补齐 ${boundCount} 个绑定，另有 ${unresolvedSceneShotIds.length} 个镜头需手动确认场景`);
            else if (skippedShotIds.length) message.info(`已补齐 ${boundCount} 个绑定；跳过 ${skippedShotIds.length} 个正在生成的镜头，请任务结束后再补齐`);
            else message.success(`本章资产已检查，补齐 ${boundCount} 个绑定；未提交生成任务`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "本章资产补齐失败"),
    });

    const generateArtifact = async () => {
        if (!selectedShot || shotTaskActive || recoverVideo.isPending || submittingShotsRef.current.has(selectedShot.id) || matchAssetBindings.isPending || matchChapterAssets.isPending || changeAssetBinding.isPending) return;
        const submittingShot = selectedShot;
        let submitted = false;
        submittingShotsRef.current.add(submittingShot.id);
        setSubmissionError(null);
        setSubmittingShotIds((current) => new Set(current).add(submittingShot.id));
        try {
            if (selectedModelUnavailable) throw new Error("上次选择的模型当前不可用，请重新选择生成模型；不会自动切换到其他模型");
            const values = await form.validateFields();
            const prepared = await prepareProjectShotAssets({ projectId, unitId, shotId: submittingShot.id, script: values, generationArtifactType: artifactType });
            if (prepared.unresolvedSceneShotIds.length) throw new Error("当前镜头缺少明确的场景资产，请先绑定对应场景；未提交生成任务");
            const referenceContext = buildShotAssetReferenceContext({ ...detail, ...prepared.workspace }, submittingShot.id);
            let productionStep = workflowStep;
            if (!productionStep) {
                const initialized = await createUnitWorkflow(projectId, unitId);
                productionStep = (initialized.workflow.steps || []).find((step) => step.stepKey === activeStage);
            }
            if (!productionStep) throw new Error("当前生成阶段不可用，请刷新页面后重试");
            if (!routedModel) throw new Error(activeStage === "video" ? "请先配置视频模型" : "请先配置图片模型");
            const compatibilityError = modelCompatibilityError(effectiveConfig, routedModel, {
                ...modelRequirements,
                videoSeconds: generationCapability === "video" ? String(values.durationSeconds) : undefined,
                input: { textCount: 1, imageCount: referenceContext.referenceImages.length, videoCount: 0, audioCount: generationCapability === "video" ? referenceContext.referenceAudios.length : 0, characterCount: 0 },
                videoOperation: generationCapability === "video" && referenceContext.referenceImages.length ? "reference_to_video" : undefined,
            });
            if (compatibilityError) throw new Error(`当前模型配置不可用：${compatibilityError}`);
            const saved = await saveProjectShot(projectId, {
                id: submittingShot.id,
                unitId,
                title: values.title,
                description: values.plotDescription,
                position: submittingShot.position,
                durationMs: Math.round(values.durationSeconds * 1000),
                status: submittingShot.status,
                revision: revisionInput(values, shotActionBeats(revision?.actionBeatsJson)),
            });
            const mode = generationCapability;
            const config = { ...generationConfig, videoSeconds: String(Math.max(1, Math.round(values.durationSeconds))) };
            if (!isAiConfigReady(config, routedModel)) throw new Error("当前模型渠道配置不完整，请先到设置中补齐");
            if (selectedSkillIds.length && skillsLoading) throw new Error("技能规则正在加载，请稍后再提交");
            const skillExecution = mode === "video"
                ? await prepareWorkflowVideoPrompt({ values, context: referenceContext, interfaceType: resolveModelRequestConfig(config, routedModel).interfaceType, skills: availableSkills, selectedSkillIds })
                : await skillRuntime.prepare({ profile: "shortDrama", prompt: resolveShotAssetMentionPrompt([values.imagePrompt || values.plotDescription, values.action, "黑白分镜草图，清晰动作节拍，电影构图"].filter(Boolean).join("\n"), referenceContext, { dialogue: values.dialogue }), skills: availableSkills, selectedSkillIds });
            const submittedPrompt = mode === "video" ? resolveWorkflowVideoSubmissionPrompt(skillExecution.prompt, finalPromptDraft) : skillExecution.prompt;
            if (!submittedPrompt.trim()) throw new Error("最终提交提示词不能为空，请先填写内容");
            if (mode === "video" && Array.from(submittedPrompt).length > (videoProfile?.references.promptMaxChars || 0)) throw new Error(`最终提交提示词共 ${Array.from(submittedPrompt).length} 个字符，当前模型上限 ${videoProfile?.references.promptMaxChars}。请展开「最终提交提示词」查看镜头、资产和技能规则来源后精简。`);
            await submitBackendGenerationTask({
                projectId,
                mode,
                prompt: submittedPrompt,
                config,
                referenceImages: referenceContext.referenceImages,
                referenceAudios: mode === "video" ? referenceContext.referenceAudios : [],
                metadata: {
                    ...skillExecution.metadata,
                    workflowStepId: productionStep.id,
                    domainProjectId: projectId,
                    unitId,
                    shotId: saved.shot.id,
                    shotRevisionId: saved.shot.currentRevisionId,
                    artifactType,
                    role: "output",
                    source: "short-drama-workflow",
                    ...(mode === "video" && referenceContext.referenceImages.length ? { videoEditOperation: "reference_to_video" } : {}),
                    resolvedCharacterVersions: referenceContext.resolvedCharacterVersions,
                    artifactMetadata: { model: routedModel, aspectRatio, resolution, durationSeconds: values.durationSeconds, ...skillExecution.metadata },
                },
            });
            submitted = true;
            if (activeShotIdRef.current === submittingShot.id) setEditorDirty(false);
            await onRefresh();
            message.success(`${productionStageCopy[activeStage as "storyboard" | "previz" | "video"].label}任务已提交`);
        } catch (error) {
            const errorFields = error && typeof error === "object" && "errorFields" in error && Array.isArray(error.errorFields) ? error.errorFields : [];
            const errorText = submitted ? "任务已提交，请刷新页面查看原任务，不要重复生成" : errorFields.length
                ? errorFields.flatMap((field) => field.errors || []).join("；") || "请检查镜头脚本中的必填项"
                : error instanceof Error ? error.message : "镜头脚本在校验时发生变化，请再次点击生成";
            if (errorFields.length && activeShotIdRef.current === submittingShot.id) {
                setAdvancedOpen(true);
                window.requestAnimationFrame(() => form.scrollToField(errorFields[0].name, { focus: true }));
            }
            setSubmissionError({ shotId: submittingShot.id, text: errorText, submitted });
            message.error(errorText);
            if (!submitted) await onRefresh().catch(() => undefined);
        } finally {
            submittingShotsRef.current.delete(submittingShot.id);
            setSubmittingShotIds((current) => {
                const next = new Set(current);
                next.delete(submittingShot.id);
                return next;
            });
        }
    };

    const stageCopy = productionStageCopy[activeStage as "storyboard" | "previz" | "video"];
    const selectedShotSubmitting = submittingShotIds.has(selectedShot?.id || "");

    if (!selectedShot) {
        return <div className="workflow-empty-shot"><EmptyState size="compact" title="当前章节还没有分镜" action={<Button type="primary" icon={<Plus className="size-4" />} loading={addingShot} onClick={onAddShot}>新增第一个分镜</Button>} /></div>;
    }

    const requestShotSelection = (nextShotId: string) => {
        if (nextShotId === selectedShot.id) return;
        if (!editorDirty) {
            onSelectShot(nextShotId);
            return;
        }
        modal.confirm({
            title: "当前镜头有未保存修改",
            content: "切换镜头会放弃这些修改。",
            okText: "放弃修改并切换",
            cancelText: "继续编辑",
            onOk: () => onSelectShot(nextShotId),
        });
    };

    const requestAddShot = () => {
        if (!editorDirty) {
            onAddShot();
            return;
        }
        modal.confirm({
            title: "当前镜头有未保存修改",
            content: "新增镜头会离开当前编辑内容。",
            okText: "放弃修改并新增",
            cancelText: "继续编辑",
            onOk: onAddShot,
        });
    };

    const requestDeleteShot = () => {
        const nextShot = shots[shotIndex + 1] || shots[shotIndex - 1];
        modal.confirm({
            title: `删除镜头“${watchedTitle || selectedShot.title || "未命名镜头"}”？`,
            content: editorDirty
                ? "该镜头的未保存修改、脚本版本、资产引用和生成产物都会被删除，且无法恢复。"
                : "该镜头的脚本版本、资产引用和生成产物都会被删除，且无法恢复。",
            okText: "删除镜头",
            okButtonProps: { danger: true },
            cancelText: "取消",
            centered: true,
            onOk: () => deleteShot.mutateAsync({ shotId: selectedShot.id, nextShotId: nextShot?.id || "" }),
        });
    };

    const selectRelativeShot = (offset: number) => {
        const next = shots[shotIndex + offset];
        if (next) requestShotSelection(next.id);
    };

    return (
        <div className="workflow-production-shell">
            <div className="workflow-production-main">
                <aside className="workflow-library-panel">
                        <SegmentedControl
                        block
                        size="sm"
                        value={leftTab}
                        onChange={(value) => setLeftTab(value as typeof leftTab)}
                        options={[{ value: "episodes", label: "章节" }, { value: "shots", label: "镜头" }, { value: "assets", label: "资产" }]}
                    />
                    <div className="workflow-library-scroll thin-scrollbar">
                        {leftTab === "assets" ? <AssetLibrary detail={detail} referenceByVersionId={referenceByVersionId} changing={changeAssetBinding.isPending || matchAssetBindings.isPending || selectedShotSubmitting} onToggle={(asset, reference) => changeAssetBinding.mutate({ asset, reference })} /> : null}
                        {leftTab === "episodes" ? <EpisodeLibrary detail={detail} activeUnitId={unitId} projectId={projectId} activeStage={activeStage} /> : null}
                        {leftTab === "shots" ? <ShotLibrary detail={detail} shots={shots} selectedShotId={selectedShot.id} onSelectShot={requestShotSelection} /> : null}
                    </div>
                </aside>

                <section className="workflow-shot-editor">
                    <header className="workflow-panel-header">
                        <div className="workflow-shot-heading">
                            <span className="workflow-shot-number">{formatShotOrdinal(shotIndex)}</span>
                            {customShotTitle(watchedTitle || selectedShot.title, shotIndex) ? <h2>{customShotTitle(watchedTitle || selectedShot.title, shotIndex)}</h2> : null}
                            <StatusBadge tone={saveShot.isPending ? "loading" : editorDirty ? "warning" : revision ? "success" : "neutral"} label={saveShot.isPending ? "保存中" : editorDirty ? "有未保存修改" : revision ? "已保存" : "草稿"} className="m-0" />
                        </div>
                        <div className="flex items-center gap-1"><span className="mr-1 text-[var(--fs-micro)] text-foreground/45">{shotIndex + 1} / {shots.length}</span><Button type="text" size="small" icon={<ChevronLeft className="size-4" />} disabled={shotIndex <= 0} onClick={() => selectRelativeShot(-1)} aria-label="上一个镜头" /><Button type="text" size="small" icon={<ChevronRight className="size-4" />} disabled={shotIndex >= shots.length - 1} onClick={() => selectRelativeShot(1)} aria-label="下一个镜头" /></div>
                    </header>
                                <Form form={form} layout="vertical" className="workflow-shot-form" onValuesChange={() => { setEditorDirty(true); setFinalPromptDraft(undefined); }} onFinish={(values) => saveShot.mutate(values)}>
                        <div className="workflow-shot-form-scroll thin-scrollbar">
                            <div className="workflow-shot-editor-grid">
                                <div className="workflow-shot-script-column">
                                    <div className="workflow-form-section-heading"><span>镜头脚本</span><small>先写清镜头里发生什么，再调整生成参数</small></div>
                                    <Form.Item name="title" label="镜头名称" rules={[{ required: true, whitespace: true, message: "请输入镜头名称" }]}><Input placeholder="用一句话概括这个镜头" /></Form.Item>
                                    <Form.Item className="workflow-shot-main-prompt" name="videoPrompt" label="视频提示词" rules={[{ required: true, whitespace: true, message: "请输入视频提示词" }]}><ShotAssetMentionTextarea references={shotAssetReferenceContext.mentionReferences} /></Form.Item>
                                    <BoundAssets detail={detail} shotId={selectedShot.id} changing={changeAssetBinding.isPending || matchAssetBindings.isPending || matchChapterAssets.isPending || submittingShotIds.size > 0} matching={matchAssetBindings.isPending} matchingChapter={matchChapterAssets.isPending} onMatch={() => matchAssetBindings.mutate()} onMatchChapter={() => matchChapterAssets.mutate()} onAddProp={(name = "") => setNewPropName(name)} onUnlink={(reference) => changeAssetBinding.mutate({ reference })} />
                                    <Form.Item name="action" label="表演与动作"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="按动作节拍描述人物表演、走位和物体运动" /></Form.Item>
                                    <Form.Item name="dialogue" label="对白 / 旁白"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="填写对白、旁白或需要保留的声音信息" /></Form.Item>
                                </div>
                                <div className="workflow-shot-settings-column">
                                    <WorkflowDisclosure
                                        icon={<SlidersHorizontal />}
                                        title="生成设置"
                                        description="生成规格与镜头语言"
                                        open={generationSettingsOpen}
                                        onOpenChange={setGenerationSettingsOpen}
                                        summary={<><span>{durationSummary}</span><span>{aspectRatio}</span><span>{resolutionSummary}</span>{generationCapability === "video" ? <span>{videoBooleanOptions?.videoGenerateAudio === "true" ? "有声" : "无声"}</span> : null}<span className="is-model">{modelSummary}</span></>}
                                    >
                                        <div className="workflow-settings-section">
                                            <div className="workflow-settings-section-title">生成规格</div>
                                            <Form.Item label="生成模型">
                                                <ModelPicker
                                                    config={generationConfig}
                                                    value={activeSelectedModel}
                                                    capability={generationCapability}
                                                    requirements={modelRequirements}
                                                    onChange={changeGenerationModel}
                                                    fullWidth
                                                    className="workflow-model-picker"
                                                    placeholder={activeStage === "video" ? "选择视频模型" : "选择图片模型"}

                                                />
                                            </Form.Item>
                                            <Form.Item label="技能库" extra={generationCapability === "video" ? "内置角色、世界观及微表情技能使用视频专用规则；其他技能按原文加载，可在下方查看最终全文。" : undefined}><SkillRuntimePicker profile="shortDrama" skills={availableSkills} loading={skillsLoading} value={selectedSkillIds} onChange={setSelectedSkillIds} /></Form.Item>
                                            {selectedModelUnavailable ? <Alert type="warning" showIcon title="上次选择的模型当前不可用" description="请选择可用模型后再生成，不会自动切换到默认模型。" /> : null}
                                            {durationError ? <Alert type="warning" showIcon title={`当前模型不支持 ${generationSeconds} 秒镜头`} description="已保留分镜计划时长，请选择支持该时长的模型或手动调整；不会自动改成短片。" /> : null}
                                            <div className="workflow-form-grid is-three">
                                                <Form.Item name="durationSeconds" label="镜头时长（秒）">
                                                    {generationCapability === "video" && videoProfile?.duration.selection === "enum"
                                                        ? <Select options={Array.from(new Set([...videoDurationOptions(videoProfile), currentDurationSeconds])).sort((left, right) => left - right).map((value) => ({ value, label: value === -1 ? "自动" : `${value} 秒${videoDurationOptions(videoProfile).includes(value) ? "" : "（当前模型不支持）"}`, disabled: !videoDurationOptions(videoProfile).includes(value) }))} />
                                                        : <InputNumber className="w-full" min={generationCapability === "video" ? Math.min(videoProfile?.duration.min || 1, currentDurationSeconds) : 0.5} max={generationCapability === "video" ? Math.max(videoProfile?.duration.max || 60, currentDurationSeconds) : 60} step={generationCapability === "video" ? videoProfile?.duration.step || 1 : 0.5} />}
                                                </Form.Item>
                                                {generationCapability === "video" ? <Form.Item label="画幅"><Select value={aspectRatio} onChange={setAspectRatio} options={(videoProfile?.ratios || []).map((value) => ({value, label:value}))} /></Form.Item> : null}
                                                {generationCapability === "video" ? (
                                                    <Form.Item label="分辨率"><Select value={resolution || undefined} placeholder="采用模型默认分辨率" onChange={setResolution} options={(videoProfile?.resolutions || []).map((value) => ({ value, label: formatVideoResolutionLabel(value) }))} /></Form.Item>
                                                ) : imageProfile?.quality.supported && !imageResolutionUsesQuality(imageProfile) ? (
                                                    <Form.Item label="生成画质"><Select value={imageQuality} onChange={setImageQuality} options={imageProfile.quality.values.map((value) => ({ value, label: value.toUpperCase() }))} /></Form.Item>
                                                ) : <div />}
                                            </div>
                                            {generationCapability === "video" ? <Form.Item label="生成声音" extra={automaticAudio ? "该渠道默认同步生成声音" : videoProfile?.generateAudio.supported ? "同步生成音频，自动记住上次选择" : "当前渠道未提供声音切换参数"}>{automaticAudio ? <StatusBadge tone="success" label="同步声音已开启" /> : <Switch aria-label="生成声音" checked={videoBooleanOptions?.videoGenerateAudio === "true"} disabled={!videoProfile?.generateAudio.supported} onChange={(checked) => updateConfig("videoGenerateAudio", String(checked))} />}</Form.Item> : null}
                                            {generationCapability === "video" ? <JiasuVideoReferenceSettings config={generationConfig} theme={theme} onConfigChange={(key, value) => updateConfig(key, value)} /> : null}
                                            {generationCapability === "image" && imageProfile ? <ImageSizePicker profile={imageProfile} size={aspectRatio} quality={imageQuality} onChange={(size, quality) => { setAspectRatio(size); if (quality) setImageQuality(quality); }} /> : null}
                                        </div>
                                        <div className="workflow-settings-section">
                                            <div className="workflow-settings-section-title">镜头语言</div>
                                            <div className="workflow-form-grid is-three">
                                                <Form.Item name="shotSize" label="景别"><Select allowClear placeholder="自动" options={["特写", "近景", "中景", "全景", "远景"].map((value) => ({ value, label: value }))} /></Form.Item>
                                                <Form.Item name="cameraAngle" label="机位角度"><Select allowClear placeholder="自动" options={["平视", "俯拍", "仰拍", "侧面", "过肩"].map((value) => ({ value, label: value }))} /></Form.Item>
                                                <Form.Item name="cameraMovement" label="运镜方式"><Select allowClear placeholder="自动" options={["固定", "推镜", "拉镜", "摇镜", "移镜", "跟拍"].map((value) => ({ value, label: value }))} /></Form.Item>
                                            </div>
                                        </div>
                                    </WorkflowDisclosure>
                                </div>
                            </div>
                            {savedPromptReview.length ? <Alert type="warning" showIcon title="已保存分镜的格式检查" description={`${savedPromptReview[0].replace(/^第 1 段：/u, "")}。此处仅检查已保存脚本的镜头格式，不是额外的生成步骤，也不会自动改写内容或发起生成。`} /> : null}
                            <div className="workflow-shot-lower-grid">
                                <WorkflowDisclosure
                                    className="is-advanced"
                                    open={advancedOpen}
                                    onOpenChange={setAdvancedOpen}
                                    icon={<WandSparkles />}
                                    title="生成补充"
                                    description="仅在模型需要额外约束时填写"
                                    summary={<span>提示词 · 排除内容 · 接戏</span>}
                                >
                                    <div className="workflow-advanced-fields">
                                        <Form.Item name="plotDescription" label="镜头画面" rules={[{ required: true, whitespace: true, message: "请输入镜头画面" }]}><ShotAssetMentionTextarea variant="scene" references={shotAssetReferenceContext.mentionReferences} /></Form.Item>
                                        <Form.Item name="imagePrompt" label="画面提示词"><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="留空时根据镜头画面自动生成" /></Form.Item>
                                        <Form.Item name="negativePrompt" label="排除内容"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="填写不希望出现的元素、动作或画面问题" /></Form.Item>
                                        <Form.Item name="continuityNotes" label="接戏备注"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="记录人物位置、朝向、服装、道具及前后镜延续关系" /></Form.Item>
                                    </div>
                                </WorkflowDisclosure>
                                {generationCapability === "video" ? <WorkflowDisclosure
                                    icon={<List />}
                                    title="最终提交提示词"
                                    description="包含镜头内容、资产引用与技能规则；可编辑，提交以编辑后的全文为准"
                                    open={promptOpen}
                                    onOpenChange={setPromptOpen}
                                    summary={<span>{promptPreview.data ? `${Array.from(finalPromptDraft ?? promptPreview.data.prompt).length} / ${videoProfile?.references.promptMaxChars || 0} 字符${finalPromptDraft !== undefined ? " · 已编辑" : ""}` : promptPreview.isFetching ? "正在整理" : "等待镜头内容"}</span>}
                                >
                                    {promptPreview.error ? <Alert type="warning" showIcon title="提示词尚未就绪" description={promptPreview.error.message} /> : promptPreview.data ? <>
                                        <div className="flex flex-wrap items-center gap-3 text-xs"><span>当前模型上限 {videoProfile?.references.promptMaxChars} 字符</span>{promptPreview.data.sections.map((section) => <span key={section.label}>{section.label} {section.chars} 字符</span>)}{finalPromptDraft !== undefined ? <span className="text-amber-600">已手动编辑</span> : null}<Button size="small" onClick={() => void navigator.clipboard.writeText(finalPromptDraft ?? promptPreview.data!.prompt).then(() => message.success("已复制完整提示词"), () => message.error("复制失败，请从下方选择文本复制"))}>复制全文</Button>{finalPromptDraft !== undefined ? <Button size="small" onClick={() => setFinalPromptDraft(undefined)}>恢复自动整理</Button> : null}</div>
                                        <Input.TextArea aria-label="最终提交提示词全文" value={finalPromptDraft ?? promptPreview.data.prompt} onChange={(event) => setFinalPromptDraft(event.target.value)} autoSize={{ minRows: 5, maxRows: 14 }} />
                                        {Array.from(finalPromptDraft ?? promptPreview.data.prompt).length > (videoProfile?.references.promptMaxChars || 0) ? <Alert type="warning" showIcon title="完整提示词超过模型上限" description="请精简镜头文本或取消不需要的技能。提交时将严格使用当前编辑框中的全文，不会自动截断对白、镜头序列或资产引用。" /> : null}
                                    </> : null}
                                </WorkflowDisclosure> : null}
                            </div>
                        </div>
                        <footer className="workflow-editor-actions">
                            <div className="flex items-center gap-2"><Button danger icon={<Trash2 className="size-4" />} loading={deleteShot.isPending} disabled={saveShot.isPending || selectedShotSubmitting || recoverVideo.isPending || changeAssetBinding.isPending || matchAssetBindings.isPending} onClick={requestDeleteShot}>删除镜头</Button><Button htmlType="submit" icon={<Save className="size-4" />} loading={saveShot.isPending} disabled={!editorDirty || deleteShot.isPending}>保存脚本</Button><Button type="primary" icon={<Play className="size-4" />} loading={selectedShotSubmitting || shotTask?.status === "queued" || shotTask?.status === "running"} disabled={recoverVideo.isPending || deleteShot.isPending || changeAssetBinding.isPending || matchAssetBindings.isPending} onClick={() => void generateArtifact()}>{selectedShotSubmitting ? `${stageCopy.action}（正在提交）` : shotTask?.status === "queued" || shotTask?.status === "running" ? `${stageCopy.action}（已运行${shotTaskElapsed}）` : shotTask?.status === "failed" ? `${stageCopy.action}（重新提交）` : shotTask?.status === "succeeded" && !newestArtifact ? `${stageCopy.action}（已完成，正在同步）` : newestArtifact ? `${stageCopy.action}（已生成）` : stageCopy.action}</Button></div>
                        </footer>
                    </Form>
                </section>

                <aside className="workflow-preview-panel">
                    <header className="workflow-preview-header">
                        <div className="workflow-preview-header-row">
                            <div className="workflow-preview-title"><Film className="size-4 shrink-0" /><span>产物预览</span></div>
<SegmentedControl size="sm" value={previewTab} onChange={(value) => setPreviewTab(value as typeof previewTab)} options={[{ value: "latest", label: "最新" }, { value: "history", label: `历史 ${artifacts.length}` }]} />
                        </div>
<SegmentedControl
                            block
                            size="sm"
                            className="workflow-preview-stage-switch"
                            value={activeStage}
                            options={[{ value: "storyboard", label: "分镜图" }, { value: "previz", label: "动作预演" }, { value: "video", label: "镜头视频" }]}
                            onChange={(nextStage) => navigate(`/projects/${projectId}/workflow/${unitId}/${nextStage}`)}
                        />
                    </header>
                    <div className="workflow-preview-scroll thin-scrollbar">
                        {previewTab === "latest" ? <LatestPreview artifact={previewArtifact} emptyText={stageCopy.empty} onPreviewImage={setImagePreviewArtifact} /> : <ArtifactHistory artifacts={artifacts} activeId={previewArtifact?.id} onSelect={(artifact) => { setPreviewArtifactId(artifact.id); setPreviewTab("latest"); }} />}
                        <div className="workflow-preview-summary"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">当前产物</span><ArtifactStatus artifact={newestArtifact} compact /></div><div className="mt-1 text-[var(--fs-micro)] text-foreground/45">{newestArtifact ? `${formatDuration(selectedShot.durationMs)} · ${resolution}p · v${newestArtifact.version}` : "当前镜头还没有生成产物"}</div></div>
                        <div className="workflow-preview-actions"><Button icon={<RefreshCcw className="size-3.5" />} loading={selectedShotSubmitting || shotTaskActive} disabled={shotTaskActive || recoverVideo.isPending || deleteShot.isPending || changeAssetBinding.isPending || matchAssetBindings.isPending} onClick={() => void generateArtifact()}>重新生成</Button><Button icon={<Download className="size-3.5" />} disabled={!previewArtifact?.resourceId} onClick={() => previewArtifact?.resourceId && void downloadArtifact(previewArtifact, selectedShot.title, message.error)}>下载{activeStage === "video" ? "视频" : "图片"}</Button></div>
                        {submissionError?.shotId === selectedShot.id ? <Alert type={submissionError.submitted ? "warning" : "error"} showIcon title={submissionError.submitted ? "任务已提交，界面同步失败" : "生成未提交"} description={<GenerationFailureNotice key={`${selectedShot.id}:${submissionError.text}`} compact explanation={explainGenerationError(submissionError.text)} context={{ model: routedModel, failureDiagnostics: { source: submissionError.submitted ? "client_result" : "local_validation", summary: submissionError.text, stage: submissionError.submitted ? "提交后界面同步" : "生成提交前" } }} />} closable onClose={() => setSubmissionError(null)} /> : null}
                        {shotTask?.status === "failed" && !selectedShotSubmitting ? <Alert type="error" showIcon title="生成失败详情" description={<GenerationFailureNotice
                            key={shotTask.id}
                            compact
                            explanation={explainGenerationError({ code: shotTask.errorCode, message: shotTask.error }, { taskId: shotTask.id, stage: shotTask.stage })}
                            context={{ taskId: shotTask.id, providerRequestId: shotTask.providerRequestId, model: shotTask.model, stage: shotTask.stage, createdAt: shotTask.createdAt, completedAt: shotTask.completedAt, updatedAt: shotTask.updatedAt, failureDiagnostics: shotTask.failureDiagnostics }}
                        />} /> : null}
                        {canRecoverVideo ? <Alert type="warning" showIcon title="本地任务失败，上游可能仍在生成" description="渠道后台已成功时，点击“查询并取回”加载原任务结果；上游处理中会恢复自动查询。重新生成会提交新任务。" action={<Button loading={recoverVideo.isPending} disabled={selectedShotSubmitting || deleteShot.isPending} onClick={() => shotTask && recoverVideo.mutate(shotTask)}>查询并取回</Button>} /> : null}
                        {shotTask?.status === "cancelled" && shotTask.stage === "本地已停止" ? <Alert type="info" showIcon title="本地已停止跟进，可以重新生成" description="上游任务未取消，原任务 ID 和记录已保留。" /> : null}
                        {generationCapability === "video" && shotTask ? <VideoTaskLocalStop key={shotTask.id} task={shotTask} onStopped={(task) => {
                            setLocallyStoppedTask(task);
                            void onRefresh().catch(() => message.warning("本地已停止，项目刷新失败；请刷新查看最新状态"));
                        }} /> : null}
                        <ArtifactHistory artifacts={artifacts.slice(0, 4)} activeId={previewArtifact?.id} onSelect={(artifact) => setPreviewArtifactId(artifact.id)} compact />
                    </div>
                </aside>
            </div>

            <AppModal
                flush
                open={Boolean(imagePreviewArtifact?.resourceId)}
                title={imagePreviewArtifact?.type === "action_board" ? "动作预演预览" : "分镜图预览"}
                footer={null}
                centered
                width="min(960px, calc(100vw - 32px))"
                onCancel={() => setImagePreviewArtifact(null)}
            >
                {imagePreviewArtifact?.resourceId ? <CachedResourceImage eager storageKey={resourceStorageKey(imagePreviewArtifact.resourceId)} className={`workflow-image-preview-modal ${imagePreviewArtifact.type === "action_board" ? "grayscale" : ""}`} alt={imagePreviewArtifact.type === "action_board" ? "动作预演大图" : "分镜图大图"} fallback={<span>图片加载失败，请刷新重试</span>} /> : null}
            </AppModal>

            <ShotTimeline activeStage={activeStage} detail={detail} shots={shots} selectedShotId={selectedShot.id} submittingShotIds={submittingShotIds} onSelectShot={requestShotSelection} onAddShot={requestAddShot} addingShot={addingShot} />
            {newPropName !== null ? <ProjectPropCreateModal detail={detail} unitId={unitId} initialName={newPropName} onClose={() => setNewPropName(null)} onSaved={onRefresh} /> : null}
        </div>
    );
}

function formatTaskElapsed(startedAt: number, now: number) {
    const totalSeconds = Math.max(0, Math.floor((now - (Number.isFinite(startedAt) ? startedAt : now)) / 1_000));
    return `${Math.floor(totalSeconds / 60)}分钟${String(totalSeconds % 60).padStart(2, "0")}秒`;
}

function WorkflowDisclosure({ icon, title, description, summary, className = "", open, onOpenChange, children }: { icon: ReactNode; title: string; description: string; summary: ReactNode; className?: string; open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
    return (
        <details className={`workflow-disclosure ${className}`} open={open} onToggle={(event) => onOpenChange?.(event.currentTarget.open)}>
            <summary>
                <span className="workflow-disclosure-heading"><span className="workflow-disclosure-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span></span>
                <span className="workflow-disclosure-summary">{summary}<ChevronDown className="workflow-disclosure-chevron" /></span>
            </summary>
            <div className="workflow-disclosure-body"><div className="workflow-disclosure-content">{children}</div></div>
        </details>
    );
}

function AssetLibrary({ detail, referenceByVersionId, changing, onToggle }: { detail: ProjectDetail; referenceByVersionId: Map<string, ShotAssetReference>; changing: boolean; onToggle: (asset: ProjectAsset, reference?: ShotAssetReference) => void }) {
    const [category, setCategory] = useState("all");
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    const [page, setPage] = useState(1);
    const pageSize = 30;
    const assetsQuery = useQuery({
        queryKey: ["project", detail.project.id, "assets", "workflow-library", category, debouncedKeyword, page, pageSize],
        queryFn: () => listProjectAssetsPage(detail.project.id, { page, pageSize, category: category === "all" ? undefined : category, query: debouncedKeyword || undefined }),
    });
    useEffect(() => setPage(1), [debouncedKeyword]);
    const assetsPage = assetsQuery.data?.assets || [];
    const groups = useMemo(() => {
        const map = new Map<string, ProjectAsset[]>();
        assetsPage.forEach((asset) => map.set(asset.category || "other", [...(map.get(asset.category || "other") || []), asset]));
        return Array.from(map.entries());
    }, [assetsPage]);
    const total = assetsQuery.data?.total || 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return <div className="workflow-asset-groups"><Input allowClear size="small" className="mb-2 w-full" value={keyword} onChange={(event) => setKeyword(event.target.value)} prefix={<Search className="size-3.5 text-foreground/35" />} placeholder="搜索资产名称" aria-label="搜索镜头资产" /><Select size="small" className="mb-2 w-full" value={category} options={[{ value: "all", label: `全部资产（${Object.values(assetsQuery.data?.categoryCounts || {}).reduce((sum, count) => sum + count, 0)}）` }, ...Object.entries(assetsQuery.data?.categoryCounts || {}).filter(([, count]) => count > 0).map(([value, count]) => ({ value, label: `${assetCategoryLabel(value)}（${count}）` }))]} onChange={(value) => { setCategory(value); setPage(1); }} />{assetsQuery.isLoading ? <div className="py-6 text-center text-xs text-foreground/45">正在读取资产…</div> : groups.length ? groups.map(([groupCategory, assets]) => <section key={groupCategory}><h3>{assetCategoryLabel(groupCategory)} <span>({assets.length})</span></h3><div className="workflow-asset-list">{assets.map((asset) => { const reference = asset.primaryVersionId ? referenceByVersionId.get(asset.primaryVersionId) : undefined; const active = Boolean(reference); const previewUrl = assetPreviewUrl(asset); return <button key={asset.id} type="button" className={`workflow-asset-row ${active ? "is-active" : ""}`} disabled={changing || !asset.primaryVersionId} aria-pressed={active} onClick={() => onToggle(asset, reference)}><span className="workflow-asset-thumb">{previewUrl ? <CachedResourceImage storageKey={assetPreviewStorageKey(asset)} alt="" loading="lazy" fallback={<ImageIcon />} /> : asset.category === "character" ? <UsersRound /> : asset.mediaType === "image" ? <ImageIcon /> : <Box />}</span><span className="min-w-0 flex-1"><strong>{asset.title}</strong><small>{active ? "已绑定 · 点击取消" : `${assetCategoryLabel(asset.category)} · v${Math.max(1, asset.versionCount)}`}</small></span>{active ? <span className="workflow-bound-dot" /> : null}</button>; })}</div></section>) : <EmptyState size="compact" title={debouncedKeyword ? "没有找到匹配资产" : "项目还没有资产"} />}{total > pageSize ? <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[var(--fs-micro)] text-foreground/45"><span>{page}/{pages} · 共 {total} 项</span><span className="flex gap-1"><Button type="text" size="small" icon={<ChevronLeft className="size-3.5" />} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} /><Button type="text" size="small" icon={<ChevronRight className="size-3.5" />} disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} /></span></div> : null}</div>;
}

function ShotAssetMentionTextarea({ value = "", onChange = () => undefined, references, variant = "motion" }: { value?: string; onChange?: (value: string) => void; references: ReturnType<typeof buildShotAssetReferenceContext>["mentionReferences"]; variant?: "scene" | "motion" }) {
    const isScene = variant === "scene";
    return (
        <CanvasResourceMentionTextarea
            value={value}
            references={references}
            onChange={onChange}
            sendOnEnter={false}
            containerClassName={`workflow-shot-mention-container ${isScene ? "is-scene" : ""}`}
            className={`thin-scrollbar workflow-shot-mention-editor ${isScene ? "is-scene" : ""}`}
            placeholder={isScene
                ? references.length ? "描述主体、场景、动作、构图与光线；输入 @ 可引用已绑定资产" : "描述主体、场景、动作、构图与光线；先绑定资产后可用 @ 引用"
                : references.length ? "补充动作节奏、运镜变化和动态细节；输入 @ 可引用已绑定资产" : "补充动作节奏、运镜变化和动态细节；绑定资产后可用 @ 引用"}
            aria-label={isScene ? "镜头画面，可使用 @ 引用已绑定资产" : "视频提示词，可使用 @ 引用已绑定资产"}
        />
    );
}

function EpisodeLibrary({ detail, activeUnitId, projectId, activeStage }: { detail: ProjectDetail; activeUnitId: string; projectId: string; activeStage: ShortDramaWorkflowStage }) {
    return <div className="workflow-simple-list">{detail.units.slice().sort((left, right) => left.position - right.position).map((unit, index) => <Link key={unit.id} to={`/projects/${projectId}/workflow/${unit.id}/${activeStage}`} className={unit.id === activeUnitId ? "is-active" : ""}><span>{String(index + 1).padStart(2, "0")}</span><strong>{unit.title}</strong></Link>)}</div>;
}

function ShotLibrary({ detail, shots, selectedShotId, onSelectShot }: { detail: ProjectDetail; shots: ProjectShot[]; selectedShotId: string; onSelectShot: (id: string) => void }) {
    return <div className="workflow-simple-list">{shots.map((shot, index) => { const video = currentArtifact(detail, shot.id, "video"); return <button key={shot.id} type="button" className={shot.id === selectedShotId ? "is-active" : ""} onClick={() => onSelectShot(shot.id)}><span>{formatShotOrdinal(index)}</span><span className="min-w-0 flex-1"><strong>{customShotTitle(shot.title, index) || "未命名"}</strong><small>{formatDuration(shot.durationMs)}</small></span><ArtifactStatus artifact={video} compact /></button>; })}</div>;
}

function BoundAssets({ detail, shotId, changing, matching, matchingChapter, onMatch, onMatchChapter, onAddProp, onUnlink }: { detail: ProjectDetail; shotId: string; changing: boolean; matching: boolean; matchingChapter: boolean; onMatch: () => void; onMatchChapter: () => void; onAddProp: (name?: string) => void; onUnlink: (reference: ShotAssetReference) => void }) {
    const [previewAsset, setPreviewAsset] = useState<{ title: string; storageKey: string } | null>(null);
    const references = (detail.shotReferences || []).filter((item) => item.shotId === shotId && item.status === "linked" && item.role === "reference");
    const assetByVersionId = useMemo(() => new Map(detail.assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset])), [detail.assets]);
    const imageByAssetId = useMemo(() => new Map(buildShotAssetReferenceContext(detail, shotId).referenceImages.map((image) => [image.id, image])), [detail, shotId]);
    return (
        <div className="workflow-bound-assets">
            <div className="workflow-bound-assets-heading"><span className="workflow-field-label">镜头资产</span><span className="flex flex-wrap items-center justify-end gap-2"><small>{references.length ? `已绑定 ${references.length} 项` : "生成时自动匹配本项目资产"}</small><Button size="small" type="text" icon={<Plus className="size-3" />} disabled={changing} onClick={() => onAddProp()}>新增道具</Button><Button size="small" type="text" loading={matching} disabled={changing && !matching} onClick={onMatch}>按规则匹配</Button><Button size="small" type="text" loading={matchingChapter} disabled={changing && !matchingChapter} onClick={onMatchChapter}>补齐本章资产</Button></span></div>
            <>
                <div className="workflow-bound-assets-content">
                    {references.length ? references.map((reference) => {
                        const asset = reference.asset || assetByVersionId.get(reference.assetVersionId);
                        const title = asset?.title || "历史资产版本";
                        const previewStorageKey = asset ? imageByAssetId.get(asset.id)?.storageKey : undefined;
                        return <div key={reference.id} className="workflow-bound-asset-chip">
                            <span className="workflow-bound-asset-preview">{previewStorageKey ? <button type="button" onClick={() => setPreviewAsset({ title, storageKey: previewStorageKey })} aria-label={`预览 ${title}`}><CachedResourceImage storageKey={previewStorageKey} alt={`${title}预览`} width={40} height={40} loading="lazy" fallback={<ImageIcon />} /></button> : asset?.category === "prop" ? <button type="button" disabled={changing} onClick={() => onAddProp(title)} aria-label={`补充 ${title} 道具图`} title="点击补充道具图"><Plus aria-hidden /></button> : <Box aria-hidden />}</span>
                            <span className="workflow-bound-asset-copy"><em>{asset ? assetCategoryLabel(asset.category) : "历史"}</em><strong title={title}>{title}</strong></span>
                            <button type="button" disabled={changing} aria-label={`取消引用 ${title}`} onClick={() => onUnlink(reference)}><X aria-hidden /></button>
                        </div>;
                    }) : <span>尚未绑定角色、场景或道具</span>}
                </div>
            </>
            <AppModal open={Boolean(previewAsset)} title={previewAsset?.title || "资产预览"} footer={null} centered width="min(960px, calc(100vw - 32px))" onCancel={() => setPreviewAsset(null)}>
                {previewAsset ? <CachedResourceImage eager storageKey={previewAsset.storageKey} alt={previewAsset.title} className="workflow-image-preview-modal" fallback={<span>图片加载失败，请刷新重试</span>} /> : null}
            </AppModal>
        </div>
    );
}

function LatestPreview({ artifact, emptyText, onPreviewImage }: { artifact?: ShotArtifact; emptyText: string; onPreviewImage: (artifact: ShotArtifact) => void }) {
    if (!artifact?.resourceId) return <div className="workflow-media-empty"><span><Play className="size-7" /></span><p>{emptyText}</p></div>;
    if (artifact.type === "video") return <VideoArtifactPreview resourceId={artifact.resourceId} title="镜头视频" />;
    return <button type="button" className="workflow-preview-media-button" onClick={() => onPreviewImage(artifact)} aria-label={artifact.type === "action_board" ? "点击预览动作预演" : "点击预览分镜图"}>
        <CachedResourceImage eager storageKey={resourceStorageKey(artifact.resourceId)} className={`workflow-preview-media ${artifact.type === "action_board" ? "grayscale" : ""}`} alt="镜头生成预览" loading="eager" fallback={<span>图片加载失败，请刷新重试</span>} />
        <span className="workflow-preview-expand" aria-hidden="true"><Maximize2 className="size-4" /></span>
    </button>;
}

function VideoArtifactPreview({ resourceId, title }: { resourceId: string; title: string }) {
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        setPlaying(false);
    }, [resourceId]);

    if (playing) return <ProjectResourceMedia className="workflow-preview-media" storageKey={resourceStorageKey(resourceId)} controls autoPlay playsInline preload="metadata" aria-label={title} />;
    return <button type="button" className="workflow-preview-media-button workflow-video-poster" onClick={() => setPlaying(true)} aria-label={`点击播放${title}`}>
        <span className="workflow-preview-media workflow-video-placeholder" aria-hidden="true"><Film /></span>
        <span className="workflow-video-play" aria-hidden="true"><Play className="size-6" fill="currentColor" /></span>
    </button>;
}

function ArtifactHistory({ artifacts, activeId, onSelect, compact = false }: { artifacts: ShotArtifact[]; activeId?: string; onSelect: (artifact: ShotArtifact) => void; compact?: boolean }) {
    if (!artifacts.length) return compact ? null : <EmptyState size="compact" title="暂无历史版本" />;
    return <section className={`workflow-history ${compact ? "is-compact" : ""}`}><div className="workflow-history-title">历史版本</div>{artifacts.map((artifact) => <button key={artifact.id} type="button" className={artifact.id === activeId ? "is-active" : ""} onClick={() => onSelect(artifact)}>{artifact.resourceId ? artifact.type === "video" ? <ProjectResourceMedia storageKey={resourceStorageKey(artifact.resourceId)} muted preload="metadata" /> : <CachedResourceImage storageKey={resourceStorageKey(artifact.resourceId)} alt="" loading="lazy" fallback={<ImageIcon />} /> : <span className="workflow-history-placeholder"><Layers3 /></span>}<span className="min-w-0 flex-1"><strong>v{artifact.version}{artifact.selected ? " · 当前" : ""}</strong><small>{new Date(artifact.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span><ArtifactStatus artifact={artifact} compact /></button>)}</section>;
}

function ShotTimeline({ activeStage, detail, shots, selectedShotId, submittingShotIds, onSelectShot, onAddShot, addingShot }: { activeStage: ShortDramaWorkflowStage; detail: ProjectDetail; shots: ProjectShot[]; selectedShotId: string; submittingShotIds: Set<string>; onSelectShot: (id: string) => void; onAddShot: () => void; addingShot: boolean }) {
    const artifactType = artifactTypeForStage(activeStage);
    const latestTaskByShotId = useMemo(() => latestWorkflowShotTasks(detail.tasks || [], artifactType), [artifactType, detail.tasks]);
    return <section className="workflow-shot-timeline"><header><div><strong>{detail.units.find((item) => item.id === shots[0]?.unitId)?.title || "本集"}</strong><span>{shots.length} 镜 · 总时长 {formatDuration(shots.reduce((total, item) => total + item.durationMs, 0))}</span></div><div className="flex items-center gap-1 text-[var(--fs-micro)] text-foreground/40"><List className="size-3.5" /> 共 {shots.length} 镜</div></header><div className="workflow-shot-track thin-scrollbar">{shots.map((shot, index) => <TimelineShot key={shot.id} artifactType={artifactType} detail={detail} shot={shot} task={latestTaskByShotId.get(shot.id)} submitting={submittingShotIds.has(shot.id)} index={index} selected={shot.id === selectedShotId} onSelect={() => onSelectShot(shot.id)} />)}<button type="button" className="workflow-add-shot-card" disabled={addingShot} onClick={onAddShot}><Plus className="size-5" /><span>新增分镜</span></button></div></section>;
}

function TimelineShot({ artifactType, detail, shot, task, submitting, index, selected, onSelect }: { artifactType: string; detail: ProjectDetail; shot: ProjectShot; task?: GenerationTask; submitting: boolean; index: number; selected: boolean; onSelect: () => void }) {
    const video = currentArtifact(detail, shot.id, "video");
    const previz = currentArtifact(detail, shot.id, "action_board");
    const storyboard = currentArtifact(detail, shot.id, "storyboard");
    const preview = video?.resourceId ? video : previz?.resourceId ? previz : storyboard?.resourceId ? storyboard : undefined;
    const stateArtifact = artifactType === "video" ? video : artifactType === "action_board" ? previz : storyboard;
    const revision = currentRevision(detail, shot);
    const stageLabel = artifactType === "video" ? "镜头视频" : artifactType === "action_board" ? "动作预演" : "分镜画面";
    const cameraMeta = [revision?.shotSize, revision?.cameraMovement].filter(Boolean).join(" · ") || "等待补充镜头参数";
    return <button type="button" className={`workflow-timeline-shot ${selected ? "is-active" : ""}`} onClick={onSelect}><span className="workflow-timeline-media">{preview?.resourceId && preview.type !== "video" ? <CachedResourceImage storageKey={resourceStorageKey(preview.resourceId)} alt="" loading="lazy" fallback={<ImageIcon />} /> : <Film />}</span><span className="workflow-timeline-copy"><span className="workflow-timeline-heading"><strong>{formatShotOrdinal(index)}</strong><b>{formatDuration(shot.durationMs)}</b></span>{customShotTitle(shot.title, index) ? <em className="workflow-timeline-title">{customShotTitle(shot.title, index)}</em> : null}<small className="workflow-timeline-meta">{cameraMeta}</small><span className="workflow-timeline-status"><span>{stageLabel}{stateArtifact ? ` · v${stateArtifact.version}` : ""}</span><ArtifactStatus artifact={stateArtifact} taskStatus={submitting ? "queued" : task?.status} compact /></span></span></button>;
}

function revisionInput(values: ShotEditorValues, actionBeats: ShotRevisionInput["actionBeats"] = []): ShotRevisionInput {
    return {
        plotDescription: values.plotDescription,
        action: values.action,
        dialogue: values.dialogue,
        shotSize: values.shotSize,
        cameraAngle: values.cameraAngle,
        cameraMovement: values.cameraMovement,
        durationMs: Math.round(values.durationSeconds * 1000),
        imagePrompt: values.imagePrompt,
        videoPrompt: values.videoPrompt,
        negativePrompt: values.negativePrompt,
        continuityNotes: values.continuityNotes,
        actionBeats,
    };
}

async function downloadArtifact(artifact: ShotArtifact, shotTitle: string, onError: (content: string) => void) {
    if (!artifact.resourceId) return;
    try {
        await downloadOwnedOrBrowserMedia({
            resourceId: artifact.resourceId,
            browserUrl: isWailsNativeShell() ? undefined : await cacheResourceObjectUrl(resourceStorageKey(artifact.resourceId)),
            fileName: `${shotTitle || "shot"}-v${artifact.version}.${artifact.type === "video" ? "mp4" : "png"}`,
        });
    } catch (error) {
        onError(error instanceof Error ? `下载失败：${error.message}` : "下载失败");
    }
}

function assetPreviewUrl(asset: ProjectAsset) {
    const storageKey = assetPreviewStorageKey(asset);
    const resourceId = resourceIdFromStorageKey(storageKey);
    return resourceId ? resourceFileUrl(resourceId) : "";
}

function assetPreviewStorageKey(asset: ProjectAsset) {
    const representation = asset.character?.representations?.find((item) => item.role === "primary") || asset.character?.representations?.[0];
    if (representation?.resourceId) return resourceStorageKey(representation.resourceId);
    return asset.mediaType === "image" ? asset.storageKey || "" : "";
}
