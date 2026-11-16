import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAntThemeConfig } from "@/lib/app-theme";
import { setActiveUserScope } from "@/lib/user-scope";
import { configureApiRuntime } from "@/services/api/request";
import type { Project, ProjectAsset } from "@/services/api/projects";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";
import type { GenerationTask } from "@/services/api/task-center";
import { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { hydrateModelConfig } from "@/services/model-config-repository";
import { ProjectAssetImageModal } from "@/pages/projects/detail/project-asset-image-modal";
import { ProjectAssetImageSettingsModal } from "@/pages/projects/detail/project-asset-image-settings-modal";
import { submitProjectAssetImages, type ProjectAssetImageSubmission } from "@/pages/projects/detail/project-asset-image-generation";
import { characterTurnaroundVariables } from "@/pages/projects/detail/project-character-media";
import { resolveProjectAssetImagePreset } from "@/pages/projects/detail/project-asset-image";

setActiveUserScope("asset-prompt-scope-offline");
useUserStore.setState({ hydrated: true, storageMode: "remote", user: { id: "offline-user" } as never });
configureApiRuntime("/api", "offline-prompt-scope-token");
const params = new URLSearchParams(location.search);
const dark = params.get("theme") !== "light";
document.documentElement.classList.toggle("dark", dark);
const channel = createModelChannel({ id: "scope-images", name: "离线图片模型", baseUrl: "https://example.invalid", apiKey: "fixture-only", interfaceType: "openai-image", models: ["gpt-image-2"] });
const model = encodeChannelModel(channel.id, "gpt-image-2");
const legacyPrompt = "右眼上额头处有一条清晰的疤痕";
const preset = { model, size: "16:9", quality: "high", extraPrompt: params.has("legacy") ? legacyPrompt : "" };
useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], model, imageModel: model, projectAssetImagePresets: { character: { ...preset }, environment: { ...preset }, prop: { ...preset } } } });
const project = { id: "prompt-scope-project", name: "离线补充要求测试", revision: 1, aspectRatio: "16:9" } as Project;
const versions = [
    { assetId: "hero-a", title: "角色甲", versionId: "a-base", version: 1, definition: { appearance: "黑发青年", clothing: "常服" }, referenceProfile: { lookId: "a-daily", name: "常服" } },
    { assetId: "hero-a", title: "角色甲", versionId: "a-winter", version: 2, definition: { appearance: "黑发青年", clothing: "冬装" }, referenceProfile: { lookId: "a-winter", name: "冬装" } },
    { assetId: "hero-b", title: "角色乙", versionId: "b-base", version: 1, definition: { appearance: "短发少女", clothing: "训练服" }, referenceProfile: { lookId: "b-daily", name: "常服" } },
].map((version) => ({ ...version, visualStatus: "ready", voiceStatus: "missing", representations: [{ id: `${version.versionId}-image`, resourceId: `${version.versionId}-image`, mediaType: "image", role: "primary" }] })) as CharacterReferenceVersion[];
const assets = [
    ...[versions[0]!, versions[2]!].map((character) => ({ id: character.assetId, title: character.title, category: "character", mediaType: "entity", primaryVersionId: character.versionId, character })),
    ...["environment", "prop"].flatMap((category) => ["甲", "乙"].map((suffix) => ({ id: `${category}-${suffix}`, title: `${category === "environment" ? "场景" : "道具"}${suffix}`, category, mediaType: "text", primaryVersionId: `${category}-${suffix}-v1`, definitionJson: JSON.stringify({ description: `${category === "environment" ? "木制庭院" : "青铜宝剑"}${suffix}` }) }))),
] as ProjectAsset[];
const submissions: { assetId: string; versionId?: string; prompt: string; layoutId?: string; templateId?: string }[] = [];
Object.assign(window, { promptScopeFixture: { project, versions, submissions, readConfig: () => useConfigStore.getState().config, readPresets: () => Object.fromEntries(["character", "environment", "prop"].map((category) => [category, resolveProjectAssetImagePreset(useConfigStore.getState().config, project, category as "character" | "environment" | "prop")])) } });

function Harness() {
    const [asset, setAsset] = useState<ProjectAsset | null>(null);
    const [settings, setSettings] = useState(false);
    const submit = async (input: ProjectAssetImageSubmission) => {
        await submitProjectAssetImages(project, input, { loadCatalog: async () => ({ revision: 1, versions }), submit: async (_project, current) => {
            const variables = current.asset.character ? characterTurnaroundVariables(current.asset.title, current.asset.character.definition, current.prompt, undefined, current.config.projectAssetImagePresets?.character) : undefined;
            const prompt = variables?.角色设定 ?? current.prompt;
            submissions.push({ assetId: current.asset.id, versionId: current.asset.character?.versionId, prompt, layoutId: variables?.角色参考图格式, templateId: variables?.角色形象模板 });
            return { id: `offline-${submissions.length}`, status: "queued" } as GenerationTask;
        } });
        setAsset(null);
    };
    return <main className="p-6"><nav className="flex flex-wrap gap-3">{assets.map((item) => <Button key={item.id} onClick={() => setAsset(item)}>{item.title}</Button>)}<Button onClick={() => setSettings(true)}>统一生图设置</Button></nav>
        {asset ? <ProjectAssetImageModal key={asset.id} asset={asset} project={project} singleCharacterLook={params.has("single-look")} submitting={false} onClose={() => setAsset(null)} onGenerate={(input) => void submit(input)} /> : null}
        {settings ? <ProjectAssetImageSettingsModal project={project} onClose={() => setSettings(false)} /> : null}
    </main>;
}
await hydrateModelConfig();
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })}><ConfigProvider theme={getAntThemeConfig(dark)}><App><Harness /></App></ConfigProvider></QueryClientProvider>);
