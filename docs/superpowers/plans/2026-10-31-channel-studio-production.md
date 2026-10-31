# Faceless Studio production implementation

Approved source: conversation design and plan, 31 October 2026; visual reference:
C:/Users/Fikri Mustaqim/.codex/visualizations/2026/10/30/01a18dd8-7279-7150-ab4b-5782fe6e34df/faceless-channel-studio.html.

## Binding requirements

- Channel, Studio and FYP are the only primary destinations; no global Home or Settings.
- Channel cards use actual profile/banner/subscribers/lifetime views. Unknown values remain unknown.
- A channel contains analytics, actual-publication calendar, production/reviews, agent reports and settings.
- Every upload has its own report, including uploads without a Studio episode.
- Studio is a template library and episode entry. Every template has Edit and Use.
- A channel default is used on creation; an episode override does not change that default.
- Each episode freezes template version, instructions and playbook content. Future template edits do not modify it.
- Manual ideas/scripts are first-class entry points. Review never silently rewrites user text.
- Chat directions, editable outputs, revision history and exact-source approvals work together.
- Server performs research/topics/script/analytics; Windows worker pulls storyboard/production/render jobs.
- Channel schedules allow several target times daily and a bounded backlog; restart must not duplicate jobs.
- Research uses configured 9Router, SearXNG and Obscura interfaces. Missing services block honestly.
- FYP supports manual, similar-channel and niche discovery. Competitor comparisons only use available public evidence.
- Automatic evaluation distinguishes evidence, hypotheses and proposals. Template changes require owner approval.
- Dark monochrome responsive Operate UI; preserve channel artwork rather than inventing avatars, banners or metrics.
- Preserve existing vault/playbooks/finals and credentials. No automatic publishing or paid provider calls during development.

## Implementation sequence and checks

- [ ] T01: private additive workspace schema, channel preferences/default resolution and versioned template context.
  Test default/override isolation, timezone/schedule validation, missing references, stale revisions.
- [ ] T02: authenticated workspace API; retire unsafe duplicate pipeline mutations and invented metrics.
  Test anonymous/cross-origin calls, safe vault access, read-only catalog and data provenance.
- [ ] T03: Channel/Studio/FYP shell, real channel cards, embedded analytics/calendar/video drill-down/settings.
  Check no synthetic production data, original record IDs and upload linkage, desktop/mobile navigation.
- [ ] T04: template editor/default picker and manual/idea/research episode creation with immutable snapshots.
  Test editing does not alter running episodes, manual text stays exact, cross-channel override uses selected account.
- [ ] T05: episode chat/editor/versioning and exact-source reviews; reuse tested workflow operations.
  Test directions affect requested revisions, restore/version conflicts, no hidden provider calls.
- [ ] T06: SearXNG and verified browser bridge, competitor sources/snapshots and FYP.
  Test real source attribution, duplicate discovery, unknown historical metrics, isolated owner channels.
- [ ] T07: durable scheduled research/analytics and backlog limits.
  Test multiple daily slots, WIB boundaries, duplicate triggers, server restart, unavailable worker.
- [ ] T08: source-bound agent reports, historical comparisons and reviewable template proposals.
  Test missing evidence, comparable periods, stale proposals, explicit approval and preserved versions.
- [ ] T09: actual channel composition manifests/adapters and worker storyboard/production.
  Test code composition instead of montage fallback, path containment, source hashes and offline/recovery.
- [ ] T10: full verification, visual inspection, independent review, operational documentation.
  Run typecheck, unit, integration, build and focused render checks. Report external limits separately.

## Reused code boundaries

apps/web/src/server/projects.ts: owned YouTube catalog/reports.
apps/web/src/server/workflows.ts: template/run persistence and guarded execution.
apps/web/src/server/vault.ts: safe paths and document history.
apps/web/src/server/workspace.ts: new preferences/defaults, discovery, reports and proposals.
packages/core/src/workspace.ts: validated shared workspace contracts.
apps/web/src/components/studio.tsx: new primary shell.
apps/web/src/components/channel-workspace.tsx: channel-contained destinations.
apps/web/src/components/template-studio.tsx: editable template cards and episode entry.
apps/worker/src/index.ts: local job execution; extend without changing existing lease protection.
infra/pocketbase/pb_migrations: private additive collections only.

## Verification focus

Old pipeline metrics (fixed 75%, 82%, median 2500) are not trusted historical data.
Keep-watching availability must be verified; never substitute engagedViews/views.
Reporting API impressions/CTR are different from Analytics API reports.
Retention may exceed 100%; missing samples are not zero.
Existing uploads and productions are distinct entities.
Provider errors and ambiguous requests must not be retried as a new paid generation.
Approved visual prototype is layout evidence, never a source of real performance values.
