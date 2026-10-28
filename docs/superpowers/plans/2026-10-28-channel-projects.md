# Channel Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Open the studio as three branded channel projects, each with real channel analytics and an upload calendar.

**Architecture:** Existing channels retain project identity. Shared typed reports and additive PocketBase caches support a read-only YouTube connector, a cached project service, and two focused React surfaces inside the existing Studio shell.

**Tech Stack:** Existing TypeScript/Next/React/PocketBase; native SVG and CSS; no new dependencies.

**Spec:** docs/superpowers/specs/2026-10-28-channel-projects.md

## Global Constraints

- English UI; preserve the existing Linear-inspired graphite/violet system.
- No credential exposure, extra OAuth scopes, paid calls, publishing or deployment.
- No fabricated data or implicit zero for unavailable data.
- Preserve all production and owner authentication paths.
- No Git repository exists here; use the current workspace, no commits or worktree setup.

## Review Focus

- Cross-channel OAuth mismatch must reject before storing any channel data.
- API failures and empty optional reports must not erase valid reports or imply zeros.
- Stale async responses must never render another channel's report.
- Calendar must correctly convert UTC publication times to Jakarta and expose incomplete history.
- Deep links, back/forward and range changes must preserve coherent project identity.

### Task 1: Typed channel reports and cached service

**Files:** packages/core/src/channel-analytics.ts and index.ts; packages/connectors/src/youtube.ts; infra/pocketbase/pb_migrations/1793059202_channel_projects.js; apps/web/src/server/projects.ts; apps/web/src/server/service.ts; apps/web/src/app/api/[...path]/route.ts; tests/channel-projects.test.ts.

**Interfaces:** Shared ChannelProfile, ChannelVideo, ChannelReport, ProjectData types. GET projects/:channel?start=YYYY-MM-DD&end=YYYY-MM-DD reads cache; POST projects/:channel/sync {start,end} returns ProjectData; POST projects/sync refreshes channel profiles only. Channel.profile carries ChannelProfile. project data contains channel, report|null, videos, catalog {synced_at,complete,error?}.

- [x] Add failing tests for ownership, correct report-column mapping, optional failure, date validation, playlist pagination and Jakarta rollover.
- [x] Implement whole-channel summary/daily reports, top videos, countries, traffic, devices, demographics and subscribed-status breakdowns. Use supported query combinations verified against primary docs.
- [x] Add locked additive cache collections and channel profile field, authenticated API endpoints and manual/first-load caching. Existing daily sync also refreshes channel data.
- [x] Run focused tests and typecheck. Verify existing credentials remain untouched.

### Task 2: Project surfaces and navigation

**Files:** apps/web/src/components/projects.tsx; project-analytics.tsx; projects.css; studio.tsx; ui.tsx; apps/web/src/app/globals.css.

**Interfaces:** Projects({data,busy,run,refresh,openProject}); ProjectAnalytics({data,channel,busy,run,refresh,openEpisode,navigate}). Shared types from task 1. Root owns shell/URL navigation; surface implementer owns only new components/CSS.

- [x] Implement branded cards and channel dashboard with real charts, optional report states and period controls.
- [x] Implement month grid, selected-day upload list, video detail and lifetime labels. Reuse existing Button/Modal/format helpers.
- [x] Make Projects the default. Store project in URL; restore channel on reload/back/forward; retain Video analysis and all existing production tools.
- [x] Run typecheck and test meaningful new date/report logic; verify real connected data.

### Task 3: Integrate and finish

- [x] Apply migration without resetting PocketBase, build and restart the local app.
- [x] Sync all three channel profiles and inspect real reports, correcting unsupported API combinations with primary references.
- [x] Test authenticated endpoints, channel isolation, date bounds, navigation, calendar and production regression suite.
- [x] Batch desktop/mobile/user viewport browser captures; inspect and fix material issues.
- [x] Run design detector once, fresh finish reviewer and documenter; update PRODUCT.md, surface contract and verification notes.
