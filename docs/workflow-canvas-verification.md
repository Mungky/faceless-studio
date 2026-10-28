# Workflow Studio verification — 29 October 2026

The owner approved a Dify-style canvas with production chat. Studio now opens a template library with Arthur, Not Yet and Create workflow. It shows only explicitly started workflow conversations. The 11 existing imported YouTube videos remain in Projects → Video analytics and retain their original record IDs.

## Shipped behavior

- Templates contain connected, draggable nodes, editable names/instructions, manual/provider media settings and human review gates. Add/delete/connect, keyboard selection, zoom, pan and fit operate on the actual graph. Saving uses version checks. Runs keep their own template snapshot.
- Run workflow asks for a title and brief, creates a real vault workspace, and opens a durable conversation next to the graph. Sending direction saves it for the selected and downstream stages; it does not pretend to be an immediate model response. Run next step prepares requirements or an estimate. Provider execution requires separate explicit approval.
- Research, script, visual plan, voiceover, media, render, final review and upload pack use the existing production services. Outputs, job states and files reflect saved records. Missing connections explain how to recover. Research has no built-in live web search tool: supplied evidence and unverified leads must be distinguished.
- Reviews bind exact document hashes. Sync saved output can present a manually edited waiting-review document for fresh review without regeneration. A visual plan must still cover the complete approved narration. Source edits during generation preserve the manual file and save the generated result under `.studio-drafts`.
- Estimates are one-use, run-bound, source-bound and budget checked. Stale/cross-run/generic approvals cannot bypass the conversation. Expired or denied estimates have an explicit reset action. Active or unresolved provider work cannot be silently retried.
- Each canonical document/production operation has one writer per graph. Media supports one image and one video stage; human-review nodes may repeat. Graphs are bounded connected DAGs with a single Brief root. This is a focused production workflow editor; arbitrary Dify tools, branching conditions and agent loops are not implemented.
- Workflow renders resolve each beat to its explicit selected asset or unique selected `meta.beat` match. Ambiguous takes or stale explicit IDs block instead of rendering a repeated fallback. Multiple selected voiceover takes also block, preserving all takes for manual selection.
- Production tools retains existing document/scene/asset editors and worker controls. Uploading/publishing remains manual. Google Flow automatic submission remains disabled under the existing connector policy; manual imports and alternative connectors remain available.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 96 passed, 2 integration-only tests skipped |
| `npm run test:integration` | 29 passed, 0 skipped, disposable native PocketBase |
| `npm run build` | Passed; final standalone app restarted on port 3100 |
| Live HTTP checks | Anonymous GET rejected; cross-origin mutation rejected; stale template/run versions rejected; invalid graph rejected; library GET read-only |
| Browser | Create template/run; edit node settings; add/delete node; drag and persist coordinates; delete/reconnect edge; reject disconnected graph; save/reload; persistent chat; blocked-provider state; reset; real files tab; mobile panels |
| Data preservation | 3 connected channels, 11 original video records, 0 synthetic runs after cleanup; 0 quotes, 0 spend log entries, 0 jobs |

Live tests used only an explicitly labeled `[SYNTHETIC TEST]` template and run. Their records and vault folder were moved to `.runtime/workflow-fixture-archive` before removing those fixture records from the active database. The archive includes the original path and full records for recovery. No live provider call, YouTube request, paid generation or publication was performed by these tests.

Before the additive workflow migration, PocketBase created `before-workflow-canvas-20261028.zip`. The new private `workflow_templates` and `workflow_runs` collections were applied without changing OAuth or previous productions.

## Visual evidence

All captures in `.impeccable/review/workflow-canvas/` were opened and inspected: `desktop.png` (1440×900), `mobile.png` (390×844), `user-1395.png` (1395×884), `mobile-configuration.png`, `run-blocked.png`, `mobile-chat.png`, and `library.png`. Viewport overrides were reset. Run captures show the clearly labeled synthetic fixture before its recoverable cleanup.

The source detector ran once on changed UI targets: 0 primary findings, 106 advisory token differences (85 color, 7 radius, 14 font size). These describe local workflow tints and compact controls outside the incumbent token list. They are retained for review, not silently waived or added to the global system.

## Operational limits

On this machine 9Router and model routes are not configured; live Research correctly blocks before provider use. A complete real production still requires the owner's configured text, voice/media, Drive and worker connections. Provider execution and final rendering through the new canvas were tested with fixtures/mocks and native job records, not a paid end-to-end production. ThinkCentre deployment remains deferred.

Independent code review found script-context loss, media assignment, quote reset, edited-document review and overlapping voiceover paths. All were fixed and rescored resolved, including complete narration coverage after manual visual-plan edits. Visual finish review and final design-system comparison are recorded in the accompanying review folder.
