import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ArtifactStatus } from "../src/pages/projects/detail/workflow-shared";
import type { ShotArtifact } from "../src/services/api/projects";

test("a stale artifact is an older script version, not an expired media file", () => {
    const html = renderToStaticMarkup(<ArtifactStatus artifact={{ status: "stale" } as ShotArtifact} />);
    expect(html).toContain("旧版本");
    expect(html).toContain("仍可预览和下载");
    expect(html).not.toContain("已过期");
});

test("ready and running artifacts retain their actual generation status", () => {
    expect(renderToStaticMarkup(<ArtifactStatus artifact={{ status: "ready" } as ShotArtifact} />)).toContain("已生成");
    expect(renderToStaticMarkup(<ArtifactStatus artifact={{ status: "stale" } as ShotArtifact} taskStatus="running" />)).toContain("生成中");
});
