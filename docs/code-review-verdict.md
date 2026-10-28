# Scoped fix re-review

Reviewed 28 October 2026 against the six findings in `code-review.md`, their original scope in `code-review-brief.md`, and the current source. This is an independent source review; the earlier interrupted reviewer supplied no verdict used here. The backend change report was treated as a claim to check against the implementation and regression tests.

**Verdict: all six original findings are resolved in the final reviewed source. Finding 2 is resolved by disabling automatic Flow generation, not by claiming that the installed bridge enforces the retry limit.** No additional material regression was confirmed within these fixes and their immediate callers.

| Finding | Verdict | Effective correction |
| --- | --- | --- |
| 1. Abandoned jobs survive a same-identity worker restart | Resolved | A running job's progress timestamp owns its lease; unrelated worker heartbeats cannot renew it. |
| 2. Flow exceeds the permitted automatic retry limit | Resolved by disabling automatic Flow | New Flow quotes, old Flow approvals, worker capabilities and direct generation all fail closed. |
| 3. Invalid storyboard locks the episode editor | Resolved | Invalid writes are rejected; externally corrupt Markdown remains available for repair. |
| 4. Script approval is not bound to a revision | Resolved | Approval stores the displayed content hash; storyboard quotes freeze and revalidate that source. |
| 5. Generated storyboard can omit/reorder/repeat narration | Resolved | Complete normalized narration must match exactly, in order, with consecutive beat indices. |
| 6. Diagnosis quote and timestamp can refer to different beats | Resolved | Exact quotes must belong to the timed segment containing the finding's timestamp. |

## 1. Job lease — resolved

`infra/pocketbase/pb_hooks/lib/studio.js:109` saves progress on the claimed job. `expireLeases()` at line 120 re-reads each candidate transactionally and tests that job's `updated` value against 120 seconds before failing the job and its paid reservation. It never requeues it. The once-per-minute cron is registered in `infra/pocketbase/pb_hooks/studio.pb.js:24`.

`apps/worker/src/index.ts:23` only sends progress while this process has an active executor. After restart, its normal worker heartbeat cannot refresh the abandoned job. Losing both completion reports also clears the local active state, allowing that abandoned job to expire. Existing one-running-job-per-worker claim locking remains intact.

Coverage inspected: `tests/backend-regressions.test.ts:42` and the actual disposable PocketBase regression in `tests/pocketbase-leases.test.ts:10`, including native progress renewal and conservative failed spending. Expiry takes the two-minute timeout plus up to the next cron tick.

## 2. Flow retry policy — resolved through a closed generation path

The initially proposed compatibility copy was insufficient. The installed CLI's `job.submit` protocol parses `job` using `JobSpecSchema`, which excludes `maxRetries`; executing that exact schema in a read-only VM confirmed that the field is removed. The bridge itself does not test/increment attempts, and its orphan-reclaim path can dispatch a previously running job again after extension reconnection. A stored `maxRetries=1` and a self-reported status marker therefore did not establish an enforced retry limit. The public upstream repository also describes itself as the support/docs repository, with the extension shipped separately through the store: [upstream installation documentation](https://github.com/srijan-kaiwart/flow-connector#install).

The final code no longer relies on that claim:

- `packages/connectors/src/flow-runtime.ts:4` always rejects, including an old bridge's apparent cap marker.
- `apps/web/src/server/service.ts:65` rejects automatic Flow before creating a quote, and line 159 rejects existing Flow quotes before reservation.
- `packages/connectors/src/flow.ts:13` rejects direct generation before status or any submission. Status only reads an already-running bridge and does not start a daemon that could reclaim old jobs.
- `apps/worker/src/index.ts:14` initially excludes image/video capabilities, and the unconditional guard in `refreshFlow()` keeps them excluded. The UI disables Flow generation and explains manual import or the configured alternative provider.

The two focused tests in `tests/flow-bridge.test.ts` were run during this review: **2 passed, 0 failed**. The added service regression at `tests/service-regressions.test.ts:149` checks both new quotes and old approvals with zero reservations/provider calls. Its source was inspected; the full service suite was not repeated here.

Automatic Flow generation remains unavailable. Re-enabling it requires a verifiable consumer retry limit and protection against reconnect replay. This verdict does not certify the closed-source extension's behavior or cancel work independently submitted outside Studio.

## 3. Storyboard validation and repair — resolved

`packages/core/src/index.ts:48` parses strict table rows and validates numeric values; `validateStoryboard()` at line 60 checks bounded durations/count and unique consecutive indices. `apps/web/src/server/vault.ts:32` validates before history or replacement writes, so invalid API submissions preserve the current document.

`readStoryboardState()` at `vault.ts:46` catches parse failures. `episodeDetails()` at `service.ts:41` retains raw documents and revisions alongside the repair error, and `apps/web/src/components/episodes.tsx:35` presents the raw Markdown editor for a broken storyboard. The original zero/empty-duration trigger can no longer persist through the API, and an external corrupt file no longer prevents reopening the episode.

Coverage inspected: backend write preservation, API 400/preserved content, and recoverable episode details in the backend/service regressions.

## 4. Revision-bound script approval — resolved

The UI sends the displayed script revision in `episodes.tsx:31`. The approval PATCH at `apps/web/src/app/api/[...path]/route.ts:59` rejects an unseen/missing revision with 409 and stores `script_meta.approved_revision`; revocation removes it. `scriptIsApproved()` at `service.ts:38` requires both approval and a matching SHA-256 hash, making legacy Boolean-only approvals and external edits ineffective.

Storyboard quotes freeze source text/hash and the target storyboard revision. `assertQuoteSource()` at `service.ts:145` rechecks them before reservation, before provider execution and after generated output returns. Source/approval/target changes during generation preserve existing documents and save the output as a recovery draft (`service.ts:195`). Already-consumed quotes retain the no-provider replay path.

Coverage inspected: stale displayed revision, external edit, stale quote, revoked approval and concurrent-generation recovery tests. File coordination remains optimistic at these boundaries; it is not a transaction spanning Obsidian and the server.

## 5. Complete narration preservation — resolved

`validateStoryboardCoverage()` at `packages/core/src/index.ts:85` validates the beat array and requires its nonempty joined narration to equal the complete spoken source after whitespace normalization. Only structural Markdown headings and leading time cues are excluded; prose and bracketed performance directions remain significant. Missing, reordered, repeated or empty generated narration is rejected.

`service.ts:192` applies this validator to the frozen approved source before any replacement write. Coverage inspected includes all four originally accepted deficient-output shapes, preservation of performance directions, and an omitted-output service test that keeps the existing storyboard unchanged.

## 6. Diagnosis quote/time correspondence — resolved

`diagnosisTiming()` at `packages/core/src/index.ts:93` establishes intervals from ordered script cues or a complete supplied storyboard. It rejects untimed leading narration, overlapping/out-of-order cues, missing timing and incompatible storyboard coverage/duration. It does not invent proportional or word-rate alignment.

`validateDiagnosis()` at line 131 requires each exact normalized quote to occur in the segment containing its timestamp, with start-inclusive/end-exclusive boundaries. The reported opening-quote-at-29-seconds case is rejected. The service establishes timing while making the quote, freezes the relevant source, checks source revisions before spending, supplies intervals to the model and validates returned findings before persistence (`service.ts:121`, `:145`, `:202`).

Coverage inspected includes the reported mismatch, the correct boundary quote, untimed rejection before reservation, and complete-storyboard timing through the service. Supplied cues/beats still need to represent the actual published recording accurately; consistency validation cannot establish that from text alone.

## Verification boundary

The existing core, backend, service/API and native PocketBase regression sources were read and align with their reported passing results. Prior broad typecheck/test/integration suites were not repeated. The final focused Flow tests passed as recorded above. A separate isolated fake-extension dispatch harness did not obtain a usable status response and supplied no runtime evidence; the reconnect concern was established by source tracing only.

This review changed only this report. No paid provider, real Drive operation, user vault or user database was used. Live OAuth/YouTube, media timing, external server operation and renderer acceptance remain outside this six-fix verdict.
