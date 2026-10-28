# Execution ledger — plan: D:/Faceless Creation/studio/PLAN.md

## Confirmed decisions

- ThinkCentre home server: Intel i7 generation 7, 16 GB RAM. Zorin now; eventual headless Ubuntu Server. Docker and Tailscale are installed there. Laptop Docker/Tailscale daemons are not running.
- Obsidian Git replaces Syncthing. The existing vault is preserved.
- Flow Connector on the Windows worker is the main image/video integration. Providers and budget limits remain configurable.
- All application UI is English; visual reference is Linear. This supersedes the initial direction rounds.
- On 28 October 2026 the owner explicitly deferred server deployment: finish the local application first.

## Progress

- Foundation implemented: npm TypeScript workspaces, Next.js backend, PocketBase migrations, auth, server-only connectors and Docker Compose.
- Pipeline backend implemented: vault documents, research/script/hook/storyboard/upload-pack model requests, asset upload, local render/music/ffmpeg queues.
- Spend guard implemented: expiring quotes, atomic reservation, daily USD/credit limits and replay protection. No external paid generation has been made.
- Worker implemented: pull queue, 15-second heartbeat, one job at a time, output upload, lease expiry and explicit cancellation.
- Analytics backend implemented: channel OAuth, actual supported API metrics, retention, traffic source, Studio CSV supplements, exact-script-quote diagnosis validation.
- English Linear-inspired production UI implemented: Analytics, episode list/board, full document editors, storyboard repair, audio/assets/render/upload tools, connections, models and spending.
- Operational tooling implemented: consistent PocketBase backup, safe Obsidian Git sync and manifest-driven published-plus-30-day recoverable raw clip archive. Live services/timers remain inactive until setup.
- Fresh verification: production build and TypeScript pass; 26 app regressions pass (the separately run integration test skips in this command); isolated PocketBase integration passes 1/1; operational suite passes 23/23, including 15 retention cases. Synthetic HyperFrames still-plus-moving-clip render passes at 1080×1920, 24 fps, two seconds with mixed audio and frame-change assertion; render lint has no findings.
- Browser verification passed editing, revision-bound approval, saving, corruption repair, explicit publication time, retention/script synchronization and responsive navigation. Synthetic fixtures were removed from live data with recovery copies retained locally.
- Code re-review resolved six backend/Flow findings. Archive review resolved shortcut traversal and active-job reference protection. Visual finish verdict is `ship` for the reviewed Operate surfaces; token-bearing DESIGN.md and .impeccable/design.json document the shipped UI.

## Rulings and limits

- Ruling: build locally without changing the home server — deployment is deferred at the owner's request. PocketBase v0.40.6 runs natively for development; the prepared deployment remains Compose.
- Ruling: public YouTube Analytics does not expose thumbnail CTR/viewed-vs-swiped — show unavailable, allow explicit Studio CSV import; never substitute card CTR.
- Ruling: Flow automatic submission is disabled after review proved the bridge retry metadata does not enforce the extension or reconnect policy. New/old quotes and worker generation fail before submission. Manual Flow output import and the configured alternative webhook remain available. A verified extension/dispatch cap is required to enable Flow automation.
- Ruling: this is a new directory, not an existing Git checkout. Preserve the current workspace; do not invent a base branch or discard files to satisfy a worktree workflow.
- External acceptance remains pending: home server access, Google OAuth, rclone/Drive authorization, configured 9Router routes, provider prices and browser-visible Flow.
