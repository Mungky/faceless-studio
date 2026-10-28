# Fresh code review

Review the new implementation at D:/Faceless Creation/studio. This directory was created from PLAN.md and has no Git base; inspect the current source directly. Do not modify files or spawn agents. Report actionable defects with file/line evidence, severity, triggering scenario and a concrete fix. Separate verified findings from uncertainty. Write the full report to docs/code-review.md and return a compact list.

Scope: packages/core, packages/connectors, packages/render-hyperframes, apps/worker, apps/web/src/server, apps/web/src/app/api, infra/pocketbase. Check caller/consumer contracts. The parent is finishing browser/UI verification; UI source is available for checking API contracts but focus this review on backend and correctness.

Binding requirements from the user-approved PLAN.md:

- Worker pulls queued jobs, claims atomically, heartbeat 15 seconds, one GPU job at a time. Offline worker leaves jobs queued. No automatic retry more than once.
- Vault is Markdown source of truth; binary masters go to Drive via rclone, never only cache. Existing playbooks must not be rewritten.
- All paid calls pass an estimate, explicit UI approval and spend_log. No automatic spending, no approval replay, no budget overrun under concurrency.
- Credentials stay off the browser, vault and Git. Private Tailscale deployment.
- Analytics uses real supported YouTube APIs; diagnoses cite actual script quotes and timestamps. No fabricated unsupported metrics.
- RenderEngine boundary with a pinned HyperFrames adapter. Flow runs on visible signed-in browser on Windows, ACE-Step local; server never connects into the laptop.
- No auto-publish.

Owner amendments: English app; dashboard like Linear; Obsidian Git; ThinkCentre i7 gen7/16GB Zorin->Ubuntu headless; flexible providers/limits, mainly Flow Connector.

Observed verification on current sources before latest UI work: core six tests pass; isolated PocketBase migration/auth/claim/completion/reservation integration test passes; TypeScript passes; Next production build passes. Operational worker reports eight separate operations tests including native disposable PocketBase backup. Read tests to assess coverage; do not call real paid providers or upload real files to Drive. No real Google/Drive credentials or home-server access is configured.
