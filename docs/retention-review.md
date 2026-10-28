# Raw clip retention review

Reviewed 28 October 2026. Scope: `scripts/retention.mjs`, its disposable fixtures, `docs/RETENTION.md`, `published_at` validation/additive migration/API transitions, and the immediate asset/job consumers. No real archive run, Drive operation, paid provider call or user-data change was made. Only this report was written by the reviewer.

**Verdict: approve the final reviewed implementation within the documented manual-run boundary.** Two material issues found during review have been corrected. No outstanding data-loss, path-confinement or publication-date defect was confirmed in this scope. This does not certify an actual Drive integration or atomic coordination between Drive and PocketBase.

## Findings resolved during review

| Finding | Original trigger and impact | Final correction |
| --- | --- | --- |
| P1 — Drive folder shortcuts escape the raw clips boundary | A shortcut under `clips/linked` points into `renders` or another episode. Recursive Drive listing presents its child video as a normal lexical `clips/linked/final.mp4`; no matching current-episode asset is required. Moving that child can relocate the protected original outside its intended folder. | The central command wrapper at `scripts/retention.mjs:99` now forces `--drive-skip-shortcuts` on every inventory, stat and move command. This also blocks a previously generated manifest whose source now resolves through a shortcut. |
| P2 — Queued/running jobs retain stale clip paths after archiving | `queueLocalJob()` freezes `drive_path` in job payloads (`apps/web/src/server/service.ts:273`), and the worker downloads those paths (`apps/worker/src/index.ts:61`). Archiving updated asset records but originally ignored existing jobs, so a queued render could later fail to download its clips. | `jobReferencesClip()` at `retention.mjs:126` inspects global queued/running job payloads for relative/full paths, Drive IDs and asset IDs. Planning skips referenced clips; full preflight and the immediate per-file check read active jobs again, after remote stats, before moving (`:152`, `:218`). Cross-episode references are included. |

The shortcut issue follows rclone's documented behavior: folder shortcuts expose the linked folder's contents recursively by default, while `--drive-skip-shortcuts` excludes them. The final implementation sets that behavior explicitly rather than relying on the user's remote configuration. [rclone Drive shortcuts documentation](https://rclone.org/drive/#shortcuts).

The added shortcut fixture models the documented traversal behavior and checks that both inventory and an older candidate fail safely. The job fixtures cover cross-episode renders, image/video references, storyboard asset references, completed-job eligibility, and a new job appearing during the immediate source stat. These are focused command/API doubles, not evidence of a real remote move.

## Publication-date checks

- `packages/core/src/index.ts:21` accepts an explicit UTC ISO publication timestamp or blank and rejects future values. The optional episode field keeps existing records compatible.
- `infra/pocketbase/pb_migrations/1793059201_publication_date.js` adds a nullable/blank date field without inventing dates for existing episodes or rewriting the original migration.
- `apps/web/src/app/api/[...path]/route.ts:60` allows a nonblank date only for the effective `published` state, clears the date when leaving that state, and clears it when entering without an explicitly supplied date. Re-saving the same published state retains its existing explicit date.
- The Upload pack form labels its input UTC, sends UTC explicitly, permits blank to disable eligibility and is disabled before publication.
- `eligible()` at `scripts/retention.mjs:33` uses only `status=published` and a strictly valid UTC timestamp at least 30 complete days old. It does not infer publication age from creation/update dates or a video ID.

The API transition regression and the eligibility boundary cases match these rules. No separate schema, migration or reset-semantics defect was found.

## Path, identity and recovery checks

The default command only inventories and writes a new local manifest; execution requires `--run --manifest`. Configuration binds the archive to exactly the same configured remote plus `Faceless/.archive`. Each manifest entry is constrained to a validated channel/episode `clips` path and a reserved per-episode/per-manifest archive path. Unknown extensions, conflicting IDs and non-video asset references are skipped. Traversal segments, duplicate candidate paths/IDs and existing destinations fail closed.

Execution validates every candidate before moving any file and repeats validation per file. It checks publication state and exact date, channel/slug, current asset references, source Drive ID/size and destination absence. It never broadens the approved inventory. Each move targets one file with `moveto --immutable`; it does not use a directory move, sync, purge or permanent deletion command.

The destination and source absence are checked before matching asset records receive the archived path/ID, `selected=false` and retention metadata. Existing metadata is retained. The archived path remains compatible with the normal preview connector.

The report is flushed before each move with the full manifest entry and original asset records, then after the verified move and each successful asset update. A PocketBase failure after moving therefore leaves the immutable manifest and an actionable report for path/metadata repair. Execution stops and does not attempt an automatic rollback or replay. The recovery documentation covers ambiguous timeouts, partially updated records and restoring a single file without overwriting a replacement.

## Verification and limits

The owner reported **15/15 disposable retention fixture tests passing** after both corrections. Their implementation and assertions were inspected; this review did not repeat that suite or the broader project checks. The publication API regression was also inspected.

The final checks are optimistic: a new job, record edit or remote change can arrive after the last check and before the move. There is no transaction spanning PocketBase job creation and Drive. The documentation correctly instructs the owner to avoid creating jobs during an archive run and to inspect the report after interruption. Existing queued/running references are now protected at the checked boundaries; this report makes no stronger atomicity claim.

Actual Drive command behavior, permissions and post-move preview acceptance remain an external setup check. A same-Drive archive changes organization, not storage usage; the documentation states that explicitly.
