# Canvas Reference Template Library Implementation Plan

> Execute inline with writing-plans and executing-plans. The user approved the research design and implementation; preserve the existing dirty working tree.

**Goal:** 图片节点随时导入、收藏、筛选和应用姿势、服装及组合模板，保持项目隔离。

**Architecture:** 纯函数负责模板校验、引用图节点和用途提示词；用户 scope 的 localforage 保存模板及图片，应用时复用资源存储。AppModal 提供目录与组合编辑，画布页面原子提交节点与连线；不访问第三方图片、不自动生图。

**Tech Stack:** React 19, TypeScript, Ant Design, localforage, Bun, Playwright.

## 1. 模板数据及应用

- [x] 新增 web/src/lib/canvas/canvas-reference-templates.ts，定义类型、筛选、输入校验和图应用/移除纯函数。
- [x] 新增 web/test/canvas-reference-templates.test.ts，先验证重复应用、替换、移除、主体保留、已有引用、模型超限及项目独立图。
- [x] web/src/types/canvas.ts 保存模板引用归属和用途快照。

## 2. 本机模板仓库

- [x] 新增 web/src/services/canvas-reference-templates.ts，使用 APP_STATE_STORE_NAME 和 scopedStorageKey，按内容哈希保存图片；模板只引用图片 ID。
- [x] 串行修改、捕获用户 scope；校验 MIME、大小及实际图片尺寸；保存失败抛错。模板删除不物理删除已有项目资源。
- [x] 模板应用时 uploadImage；同一 scope 的相同图片复用持久化资源绑定。提供可注入存储以验证刷新、隔离和失败。

## 3. 模板库与画布接入

- [x] 新增 web/src/components/canvas/canvas-reference-template-modal.tsx 和相邻 hook：分类、搜索、收藏/最近、单图导入、组合创建、视角与标签、删除确认、原站链接。
- [x] web/src/components/canvas/canvas-node-prompt-panel.tsx 添加图片模式入口和当前模板移除入口；放大面板同样支持。
- [x] 新增 web/src/pages/canvas/use-canvas-reference-templates.ts，在目标项目/节点/scope 仍有效时才应用；图片数据和模板用途进入真实引用链。
- [x] web/src/pages/canvas/project.tsx 接入 handler，保留模型和渠道配置；按模板合并后的实际输入校验模型上限。

## 4. 验证与交付

- [x] bun test test/canvas-reference-templates.test.ts test/canvas-reference-template-repository.test.ts test/canvas-node-generation-mentions.test.ts test/canvas-asset-library.test.ts。
- [x] 隔离浏览器 harness 验证导入、组合、筛选、应用/移除、刷新、明暗主题、项目切换，禁止模型请求。
- [x] bun run build（含 tsc --noEmit）通过；仅保留现有大 chunk 提示。
- [x] 自审新增文件与相关 diff，记录验证结果，不提交已有工作、不替换应用。

## 验证结果

- 8 个专项文件：50 pass，0 fail，151 expect，包含明暗两主题和 390px 小屏操作。
- 原资产库及重开预览浏览器回归：9 pass，0 fail，18 expect。
- bun run build、bun run lint、git diff --check 均通过。
- 覆盖导入、编辑/组合数据保存、收藏与搜索、真实参考输入编译、重复/替换/共享移除、刷新、项目及账号切换、模型 0/1 张上限、异步应用中途模型变化和资源服务不可用降级。
- Playwright 使用独立 fixture 数据与临时 Bun 服务，模型/任务生成请求为 0；未启动 Vite dev server，未操作用户项目，未打包或替换桌面应用。
- 截图保存在本机 reference-template-qa 目录，已实际查看桌面明暗主题及小屏截图，修复隐藏入口、图片溢出和窄屏列表挤压。
- 保留当前 codex/character-look-reference 及全部已有改动；未提交。
