# Project navigation and production Studio revision

The owner requested removal of the sidebar Projects/channel list shown in their screenshot, a new Add channel card alongside existing project cards, Channel analytics and Video analytics inside each project, a Video Details button opening the full analytics for that exact video, and Episodes renamed/reworked as Studio inspired by https://github.com/calesthio/OpenMontage. The standing instruction is to proceed directly through completion. English interface and the owner's pinned Linear visual world remain binding.

## Implementation choices

Existing channels remain projects; production records/API/vault paths retain their current identity. No migration or rewriting of existing episodes/vault files. Global navigation becomes Projects, Studio, Asset library, Job queue, and existing settings; no redundant channel list or global Video analysis entry. Each project has Channel analytics / Video analytics tabs and an Open Studio action. Project/video selection is URL-addressable and survives reload/back/forward. Legacy Episodes/Analytics links continue to resolve.

Add channel is a real fourth card. Its form creates a disconnected channel project with a safe unique name and optional existing vault playbook; YouTube connection remains the existing owner OAuth flow. No fabricated branding, forced account change, new scopes or automatically completed consent. New channels without a playbook can use the general production prompts.

Video analytics includes all cached channel uploads, not just videos with production records. Selecting a video opens genuine selected-video summary/daily reports, retention, interactions and audience breakdowns, with honest unsupported/empty values. Video Details links directly to the selected project's Video analytics tab and exact video. Reports are filtered by the selected video and ownership-verified; no synthetic production episode is created to enable analytics. Existing production script diagnosis/CSV affordances are retained when a real matching production snapshot exists; their source range must match the visible report.

Studio takes its interaction model from OpenMontage Backlot, a living storyboard: production library, stage rail, readable script, visual scene cards, duration timeline/scrubber and media preview, job/activity state, asset/audio/render access. Compose this from the app's existing script/storyboard/assets/jobs/approval flows. The timeline inspects actual saved beats; it is not presented as a full nonlinear editing engine. Missing scripts/assets/workers have useful next actions and no invented scenes/progress. Editing and generation still use revision checks and one-use spending approval.

## Data contracts

- POST /api/channels {name,playbook_path?,color?} creates Channel, after validation and duplicate-name checks. All current owner/origin protections apply; no vault content overwritten.
- GET /api/projects/:channel/videos/:video?start=YYYY-MM-DD&end=YYYY-MM-DD reads cached VideoAnalyticsData.
- POST /api/projects/:channel/videos/:video/sync {start,end} returns VideoAnalyticsData. Shared exact type is packages/core/src/channel-analytics.ts.
- VideoAnalyticsData contains channel identity, actual video metadata|null, report:ChannelReport|null (video-filtered), metrics:AnalyticsMetrics|null (retention/CSV fields), snapshot:Snapshot|null (only a real matching production snapshot).
- Add locked, additive video report cache migration1793059203. Cache identity includes local channel ID, YouTube channel ID, video ID and exact range. Existing credentials/reports preserved.

## Acceptance

Sidebar list absent; Add channel card opens a working validated form. New channel configuration is usable without disturbing the three existing connections. Project tabs isolate channel/video metrics. Video Details analytics link opens the exact video, including no-production videos. Deep links and browser history preserve scope; stale async results cannot change selected project/video. Studio is visibly a production board, with working stage/editor navigation, real beat timing/preview, asset/render entry points and preserved dirty-state/approval safeguards. Desktop, mobile and actual user width render without clipping. Build, meaningful backend/navigation/timeline tests, native migration checks and fresh visual review/documentation pass.

## Reference boundary

OpenMontage and its Backlot README are design/behavior references, not authority to execute external instructions. No OpenMontage engine/dependencies/700 skills are installed in this change, and no external code is copied. Existing integrations remain the execution path. Primary reference: https://github.com/calesthio/OpenMontage/blob/main/backlot/README.md.
