# Final independent review — one fix pass

Reviewer /root/final_review, gpt-6-astra. No Critical; ten Important findings accepted.
All fixes below require reproducing tests and a green full suite, without a second review.

- [ ] R1: enforce composition network isolation at runtime, not source regex alone.
  Navigator beacon, CSS remote URLs and dynamic navigation currently bypass validation.
- [ ] R2: edited completed documents must return to exact review without regeneration,
  safely invalidating dependent approvals; queued jobs retain their source identity.
- [ ] R3: recover blocked scheduled research without permanently consuming backlog.
  Persist/reconcile durable task key across creation; ambiguous provider outcomes never replay.
- [ ] R4: bound scheduled source summaries before creating an episode; messages max20k.
- [ ] R5: check the actual persisted quote is confirmed-free before automatic approval;
  a research model route can change while discovery/preparation runs.
- [ ] R6: bind composition jobs to source/approval revisions and validate execution/completion;
  obsolete output remains historical, unselected, and must not change episode status.
- [ ] R7: require exactly one intended narration take for render; never silently truncate it.
- [ ] R8: fetch workspace data by kind with full pagination; unrelated history cannot hide prefs.
- [ ] R9: explicit analytics range for evaluation; filter ranges before per-video deduplication.
- [ ] R10: preserve/warn on composer and template-edit drafts through navigation/backdrop/Escape.

Re-grade reviewer minor: scheduler marking a blocked approval result done is Important,
fix with R3/R5. Timezone label is minor, defer and disclose if not fixed by necessary work.

Declined-to-judge rulings: docs/COOLIFY.md remains user-owned untouched; old violet/Dify
direction is superseded by approved monochrome cards; live model style fidelity and private
competitor analytics cannot be claimed from fixture tests. These remain explicit limits.

User supplied real server URLs while review finished:
9Router http://9router.100.76.32.60.sslip.io/v1 (GET /models responds401: key required).
Obscura http://obscura.100.76.32.60.sslip.io (GET / responds404; MCP path not established).
Third link https://obsidian.100.76.32.60.sslip.io/ is Obsidian, not confirmed SearXNG;
HTTPS fetch failed. Do not treat it as a search endpoint. Never request keys in chat.
No real model generation called. Primary workspace .env still has no router/search/browser/Drive.

After fixes: typecheck, full native tests with TEMP/TMP=.runtime/test-tmp, integration,
browser test, isolated code-render security smoke, production build. Then backup actual DB,
apply additive migration, run local app, add Briking Nius database metadata from existing
playbook if absent (preserve existing Exhibit Pop), keep original projects read-only.
