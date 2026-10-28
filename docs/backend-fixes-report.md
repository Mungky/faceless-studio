# Backend corrections report

Completed on 28 October 2026. Work covered the four defects assigned in `backend-fixes-task.md`, the parent's explicit expansion for review finding #4 (script approval revisions), and the requested service-side Flow quote update. No frontend, worker, connector, renderer, package configuration or operational scripts were changed in this phase. No subagents, workspace commits, paid calls, real Drive operations or user-vault edits were made.

## Changes

### Job-specific leases

`expireLeases()` now checks the running job's `updated` timestamp rather than the worker record's heartbeat. The existing progress endpoint saves the job every worker progress heartbeat, renewing that timestamp. A new process with the same `WORKER_ID` can refresh its worker record without renewing an abandoned job.

The two-minute lease is checked by the existing once-per-minute cron. Expiry re-reads the current record inside a transaction, ignores jobs already completed/cancelled, and atomically fails the abandoned job and associated paid reservation. It never requeues or resubmits the work. Existing atomic claim behavior still permits only one running job per worker.

### Storyboard persistence and recovery

The shared storyboard parser validates every table row and applies a shared array validator. Beats must have positive finite durations (0.1–600 seconds), consecutive unique indices starting at 1, at most 500 beats, and no more than 7,200 seconds in total. Malformed numeric/index/column values and unstructured prose are rejected. Empty storyboards and blank narration in manually edited beats remain allowed; generated narration has a stricter coverage rule.

The vault write boundary validates `storyboard.md` before making directories, creating a history copy or replacing the saved file. Consequently the existing document PUT handler rejects invalid content with a 400 response while preserving the original and its revision/history.

Externally edited invalid Markdown is recoverable: episode details retain raw documents and revisions, return an empty parsed beat list, and include `storyboard_error`. A corrupt storyboard no longer makes the episode inaccessible. The parent owns the UI repair display/editor.

### Complete generated narration

Generated storyboard output must cover the complete approved spoken script exactly once and in order. Normalization removes structural Markdown heading lines and leading timestamp cues and collapses whitespace. It does not remove ordinary prose, punctuation or bracketed performance directions. Missing, reordered, repeated and empty generated narration is rejected before replacing the storyboard. A plain approved script `First line. Second line.` cannot be replaced with a storyboard containing only `Second line.`.

### Diagnosis quote/time correspondence

Diagnosis timing is established from ordered explicit script cues (including ranges), or from a complete supplied storyboard whose consecutive durations fit within the actual video duration. Untimed text preceding the first cue, overlapping/out-of-order cues, unsupported/no timing, and storyboard coverage/timing mismatches fail clearly. No word-rate or proportional alignment is invented.

Quotes must be exact normalized narration excerpts in the segment containing the finding's timestamp. Intervals include their start and exclude their end; an opening quote cannot be attached to the next beat at 29 seconds. The existing `0:04 He opened the door.` test remains valid.

The service checks timing while creating the diagnosis quote, before any spending reservation/provider call. It supplies the validated timed segments in the prompt, freezes source script/timing in the quote, rejects stale source revisions before approval, and validates returned findings against that source. Missing CTR/swipe metrics remain unavailable.

### Script approval revisions and concurrent output

The existing `script_meta` JSON stores `approved_revision`, the SHA-256 hash of the exact approved vault script. No database schema migration was needed. Script approval PATCH requires `script_revision` matching the revision the UI displayed; stale or absent revisions return 409. Revoking approval clears the saved revision. Existing legacy Boolean approvals without a hash require renewed review.

Episode details report effective `episode.script_approved=false` and `script_approval_stale=true` if external changes invalidate the saved hash. Storyboard quotes require current approval, freeze the approved source hash/text and existing target storyboard revision, and revalidate before reservation, before provider invocation and before writing output. Revoked approval, external source edits and a changed target storyboard invalidate stale quotes. Already-consumed quote replay still follows the existing no-provider replay path.

If a valid storyboard returns after the source/approval/target changed during generation, existing documents remain intact. The generated storyboard is saved as a new Markdown recovery file under the episode's `.studio-drafts/` directory with its source revision, and the response tells the user where to recover it. The uncertain paid reservation remains failed/conservative; no provider retry occurs.

### Flow service quote integration

Per the parent's request, service-side Flow credit reservation uses the connector's `FLOW_MAX_ATTEMPTS=2` export, and quote copy discloses one request plus at most one automatic upstream retry. The parent owns the pinned/capped bridge, its readiness enforcement, frontend and documentation changes; this phase changed only the service consumer.

## RED/GREEN evidence

`node --import tsx --test tests/backend-regressions.test.ts` initially reported five failures against the previous implementation: duplicate indices accepted, the full-coverage validator missing, opening quotes accepted at unrelated times, abandoned jobs preserved by fresh worker heartbeats, and invalid storyboard writes accepted. Temporary-vault filesystem operations needed reviewed execution permissions after sandbox rename restrictions were observed. After the changes, the same tests passed. A later added malformed-document assertion failed until strict table-format rejection was added, then passed.

`node --import tsx --test tests/service-regressions.test.ts` initially reported six failures: external approval remained true, stale/revoked quotes reached reservation/provider execution, omitted narration overwrote the storyboard, concurrent generation produced no recovery draft, and untimed diagnosis quote creation succeeded. The first prototype-level provider mock exposed duplicated TS module loading; it was replaced with a strict fetch-boundary fixture that intercepts all provider/authentication requests. The only attempted URL before that fixture correction was the reserved `.invalid` fixture hostname, never a paid provider endpoint. The corrected fixture reproduced the actual behavior failures before service changes; all then passed.

The actual approval PATCH test separately reproduced HTTP 200 for an unseen revision before the revision requirement; it now returns 409 and leaves approval unchanged. The actual document PUT test returns 400 for zero duration and preserves the prior file. These API tests mock only authentication/database/provider boundaries and operate on a real temporary vault.

## Final verification

All commands ran from `D:/Faceless Creation/studio` after the final implementation changes:

| Command | Observed outcome |
| --- | --- |
| `npm run typecheck` | Exit 0; TypeScript passed. |
| `npm test` | Exit 0; 25 tests total, 24 passed, 0 failed, 1 intentionally skipped integration test. |
| `npm run test:integration` | Exit 0; the normally skipped PocketBase integration test passed in its isolated database, 1/1, no skips. |

The full test command includes the parent's two Flow bridge tests, six original core tests, five backend regressions, ten service/API regressions and a native PocketBase lease regression. No test contacted the user's providers, Drive, database or vault. The existing isolated PocketBase integration still verifies private records, concurrent claims, one-job-per-worker behavior, completion ownership, quote replay and separate USD/credit budgets.

The new native lease test starts PocketBase v0.40.6 with production migrations/hooks copied into a disposable directory and a fixture-only authenticated aging route. It ages only that fixture's job via SQL, refreshes the same worker identity, invokes the registered [PocketBase cron API](https://pocketbase.io/docs/api-crons/), and observes both job and spend reservation becoming failed without requeue. For a separate running job, it ages the record, sends actual progress, confirms the native `updated` autodate refreshes, and verifies the lease and single-job claim restriction remain intact. The test-only route exists only in the temporary hook copy and is never installed in production. All temporary deletion paths are checked before cleanup.

## Boundaries and remaining concerns

- No live-provider, real-media timing, render or external-server acceptance is claimed. Supplied script cues/storyboard timing still need to reflect the actual published recording; the backend verifies consistency, not whether a human supplied accurate timing.
- The parent must ship the coordinated UI fields (`script_revision` on approval, stale-approval and `storyboard_error` repair display) and the Flow bridge changes. The backend typecheck and tests include their current shared-workspace interfaces.
- Existing approved episodes without `script_meta.approved_revision` will appear unapproved until reviewed again. Existing quotes without the new source revision/timing fields fail closed and should be re-created; quotes already consumed retain conservative replay behavior.
- Concurrent file edits are checked at request boundaries and before saving generated output; this is optimistic coordination with Obsidian/external editors, not an operating-system transaction spanning multiple applications. Avoid editing the same document simultaneously.
- The 120-second progress lease can fail a stalled/disconnected executor; the user must inspect provider state and recovery cache before explicitly generating again. The cron can take up to its next one-minute tick to apply expiry.
- The 7,200-second storyboard total is a deliberately bounded maximum, not a format-specific promise. Short/long editorial duration rules are left to production review.
- The parent owns final production build/browser verification. This phase did not run another Next build concurrently with the parent's UI/launch work.
