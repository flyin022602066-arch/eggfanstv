# Character Look Reference Implementation Plan

**Goal:** 为角色多造型提供目录、自动判定、锁定及可复现的视频参考。
**Architecture:** project domain 提供版本目录与原子镜头引用更新；前端纯解析/匹配模块约束文本模型结果；页面组件负责管理造型及选择交互；参考图组装严格使用绑定版本。
**Tech Stack:** Go / GORM / SQLite，React / TypeScript / TanStack Query，Bun tests / Go tests。
**Spec:** docs/superpowers/specs/2026-11-02-character-look-reference-design.md

## Global Constraints

- 分支 codex/character-look-reference，保留原有工作区改动，修改前备份到 Git 忽略的 .local/cache。
- 不使用子 agent；不调用真实模型/生成媒体；不启动用户项目服务；视频生成仅由用户点击。
- 新 API 使用 http；界面遵循已有主题和 AppModal；新字段同步数据库/API 文档。

## Task 1: 版本目录与造型元数据

- [x] 为 AssetVersion 增加 referenceProfileJson，为 ShotAssetReference 增加选择元数据。
- [x] project/character_reference.go 定义 CharacterReferenceProfile、CharacterReferenceVersion 和目录/标注/空图造型操作；repository/character_reference.go 提供事务。
- [x] project domain 与 handler 测试验证归属、历史版本目录、分组定稿和项目修订冲突；只使用临时 SQLite。

## Task 2: 镜头选择持久化与判定

- [x] PUT 章节角色引用批量更新，要求 expectedRevision、每镜 expectedShotRevisionId，检查锁定、任务与角色版本归属，在同一事务修改 reference。
- [x] web/src/lib/character-look-selection.ts 提供目录分组、结果解析及校验；web/src/services/project-character-references.ts 编排文本任务、上下文和写入。
- [x] 用模拟文本响应验证未知 ID、缺图、锁定、待确认、连续性和重复角色实例；覆盖事务回滚和并发冲突。

## Task 3: 管理及使用入口

- [x] 角色卡提供造型管理弹窗，能标注历史版本、选择定稿、新建空图造型与显式补图。
- [x] 镜头右侧增加紧凑角色列表，显示造型/依据/待确认/锁定；提供本镜、本章、待确认识别。
- [x] 拆解输入提供完整造型目录，结果按真实版本匹配；旧镜头引用保持固定。

## Task 4: 生成前约束及交付

- [x] workflow-shot-references 严格选择绑定版本，返回资源和判定快照，pending、重复版本、缺图时阻止提交；新生图不得替换旧镜头引用。
- [x] 同步 API、数据库与用户说明；添加隔离浏览器验证；运行针对性 Bun/Go 测试和前端构建。
- [x] 检查本任务相对备份的差异，记录验证结果和测试入口，保留分支供用户测试。

## 验证与试用

- Bun 五组专项测试 83 项通过；隔离浏览器覆盖明暗主题及桌面/窄屏，验证手动选择、锁定/解锁、待确认转确认、未保存保护和造型设置保存，无生成调用。
- Go project / database / handler 的 Character 专项通过，含真实 HTTP 保存与错误信封、v17 到 v18 原数据保留、锁定/生成冲突及批量回滚。后端 server 构建通过。
- 前端完整类型检查及生产构建通过；OpenAPI YAML、四个路由和本地引用校验通过；任务涉及文件的 git diff --check 通过。
- Windows Wails 测试程序 `backend/cmd/desktop/build/bin/EggfansTV-character-looks.exe` 编译通过，在独立数据目录验证可见窗口、有效 HWND 和 /health/ready 后关闭。启动器为 `.local/character-look-test/启动角色造型测试版.cmd`，用户试用目录为 `.local/project-workbench-debug/character-look-preview`，不会自动载入原项目。
- 保留原有未提交修改，本次没有提交 Git commit 或合并分支。改动前备份及任务差异位于 `.local/cache/character-look-reference-baseline-20261102` 和 `.local/cache/character-look-task-review.diff`。
- 更大范围的后端全套未通过：app 测试有旧接口签名编译错误，部分测试在 Windows 存在 SQLite 连接未关闭导致的临时目录清理失败，另有旧迁移夹具缺 tasks 表；本次没有改动无关测试来掩盖这些问题。真实文本/图片/视频模型质量不在本轮验证范围，未调用远程生成。
