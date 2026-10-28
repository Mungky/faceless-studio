# Studio Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Simplify project navigation and connect full video analytics to a visual production Studio.

**Architecture:** Keep channel/episode identity and current APIs. Add a scoped video-report cache and validated channel creation; compose new analytics and production surfaces inside the existing shell.

**Tech Stack:** Existing TypeScript/Next/React/PocketBase, native SVG/media; no new dependencies.

**Spec:** docs/superpowers/specs/2026-10-28-studio-revision.md

## Global Constraints

- English UI; preserve owner's Linear graphite/violet world and current credentials/vault content.
- No paid calls, publishing, deployment, new OAuth scopes or external engine installation.
- No invented metrics, scenes, progress or preview media.
- No Git repository; work in current shared workspace. Do not revert other workers' edits.

## Review Focus

- Selected-video reports must be video-filtered and channel-owned before storage.
- Legacy/deep links and delayed requests must preserve project/video/production scope.
- Channel names/playbook paths must not escape or overwrite the vault.
- Studio stage switching must preserve unsaved-edit/revision/approval checks.
- Empty media, missing workers, failed reports and unavailable APIs must remain actionable and honest.

### Task 1: Backend contracts

Ownership: packages/connectors/src/youtube.ts; server/projects.ts; server/channels.ts; service.ts narrow playbook fallback; API route; migration1793059203; tests/studio-projects.test.ts.

- [x] Add failing tests for channel validation/duplicate/path confinement and video ownership/filter/cache isolation.
- [x] Implement specified channel/video endpoints and safe scoped caches. Reuse existing real matching snapshots for diagnosis and CSV; preserve range truth.
- [x] Run focused tests and typecheck; parent performs native migration/live sync.

### Task 2: Full video analytics

Ownership: components/video-analytics.tsx, video-analytics.css, analytics.tsx RetentionChart export only.

- [x] Build video library and exact-selected-video report view using the shared VideoAnalyticsData contract.
- [x] Reuse exported DailyChart/Breakdown/Demographics primitives from project-analytics.tsx; retain retention/script/CSV/diagnosis when genuinely linked.
- [x] Cover range changes, loading/error/empty states and stale async responses; no production record creation merely to view analytics.

### Task 3: Production Studio

Ownership: components/episodes.tsx; production-board.tsx; production-studio.tsx; production-studio.css; optional pure core timeline helper + focused tests.

- [x] Replace library heading/organization with Studio and preserve real production creation/opening.
- [x] Add living production board with stages, script, real scene cards, timeline/preview and activity; preserve existing editors/generation/render actions.
- [x] Verify timing/scene selection and dirty-state/approval behavior; run focused tests/typecheck.

### Task 4: Shell and project integration

Ownership parent: studio.tsx, navigation.ts, ui.tsx, projects.tsx, project-analytics.tsx, globals.css, navigation tests/docs.

- [x] Remove sidebar channel list and global video analysis; add project tab/video URL state and legacy aliases; rename navigation to Studio.
- [x] Add real Add channel card/form, project tabs and exact-video analytics CTA in modal.
- [x] Connect Studio and VideoAnalytics components to retained operations and navigation guards.

### Task 5: Finish

- [x] Code review, additive migration on backed-up native DB, focused/full regression and production build/restart.
- [x] Test real channel/video reports, no-production video deep link, Add channel validation, Studio stages/timeline and browser history.
- [x] Batch desktop/mobile/user screenshots; detector once, fresh finish review and design documentation.

