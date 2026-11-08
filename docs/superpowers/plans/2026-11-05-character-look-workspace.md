# Character look workspace implementation plan

**Goal:** Implement the approved character list and look-card workflow with explicit image confirmation.

**Architecture:** Retain character identity, reference-profile look groups and exact image-version bindings. Reuse a single look panel in the asset workspace and shot modal. Scope task activity to the affected look and keep image history separate from new looks.

**Tech Stack:** React, TypeScript, TanStack Query, Ant Design, Bun, Playwright, Go/SQLite domain tests.

**Approved design:** One character → multiple looks → independent image histories. New looks inherit identity and voice; generated/uploaded images require explicit confirmation. Existing shot pins stay unchanged.

## Constraints

- Preserve unrelated working-tree changes and all live projects/tasks. Do not submit paid model requests.
- Keep the base face independent from the default look. Do not alter providers or generation payload contracts.
- Keep reference/ownership/revision checks on writes and deletion.
- Reuse original image resources and preserve image aspect ratios.

## Steps

- [x] Add pure look grouping and task-target helpers; test old-image retention, per-look activity and legacy history.
- [x] Replace the dense version editor with responsive look cards, a compact base identity summary, per-look history, one-click confirmation and advanced editing.
- [x] Embed the panel next to a character list in project assets; retain chapter filtering and all existing edit/voice/download/remove actions.
- [x] Simplify new-look creation to name and differences with inherited identity/voice; expose optional structured overrides.
- [x] Exercise confirmation/reload, redraw review, failed writes, independent task progress, deletion guards, material selection and shot pins in Chromium across themes and widths.
- [x] Run scoped unit/domain tests, type checking and production build; inspect browser screenshots and update user documentation.

## Verification commands

From `web`: `bun test test/character-look-management.test.ts test/character-look-selection.test.ts test/character-identity-reference.test.ts`; `bun test test/character-look.browser.test.ts test/project-asset-actions.browser.test.ts`; `bun run build`.

From `backend`: focused project CharacterLook/CharacterReference/CharacterTurnaround domain tests, using isolated temporary databases.

Browser tests must abort external requests and fail on unexpected model calls. Screenshots and evidence go under ignored `output/playwright/`. API behavior is exercised locally; model image quality is not evaluated without explicit paid-generation authorization.

## Release follow-up

The user additionally requested the local skill-library branch be included before packaging and a version increment. `git merge --ff-only codex/skill-library-refinement` reports `Already up to date`; the branch is an ancestor of the current HEAD and its worktree is clean. Release version: v1.7.75. Preserve all existing dirty work in the compiled source snapshot; do not create a commit as part of packaging.

Browser evidence: `output/playwright/eggfans-character-look-wUKCod` (both themes at 1500/800/390 pixels); `output/playwright/project-asset-actions-wsfdfD` (remove, download, download-error, missing-image, candidate-look, library-bind). Screenshots reviewed at desktop and narrow widths.

Backend CharacterReference/CharacterLook/CharacterIdentity/CharacterRedraw/CharacterTurnaround tests passed against isolated databases. The app package has unrelated preexisting channel test compile errors; the actual task summary source and its adjacent output tests passed by selecting platform source files with `go list` and excluding those unrelated tests. No configured gateway requests or paid generation were submitted.

Release verification completed: 440 frontend regression tests passed, type checking and desktop frontend/native/CLI builds passed, and all 9 packaging tests passed. The complete v1.7.75 installer contains the runtime, protocol plugins and 8 standard skills; two isolated native launches verified the visible window and skill installation without duplicates.

Local installation completed through the desktop shortcut. The installed PE and UI report v1.7.75, the visible window and health endpoint were verified, and all 15,453 installed manifest files match the release payload. Project/task/resource counts, settings and all 1,021 media files were preserved. Existing MCP processes continued running while their locked CLI executable was moved to the installation backup and replaced. Evidence: `release/EggfansTV-v1.7.75-verification.json`, `release/EggfansTV-v1.7.75-native-smoke.json` and `release/EggfansTV-v1.7.75-installed.json`.
