# Fresh source review

Reviewed 2026-10-28 against `docs/code-review-brief.md` and `PLAN.md`. No Git base exists. Scope: core, connectors, rendering adapter, worker, server/API, and PocketBase hooks/migration; UI inspected only for consumer contracts. No implementation files changed, paid services called, files uploaded, or prior build/test suites repeated.

Verdict: **changes required**. Six material findings follow. P1 means blocking reliability or an explicit paid-operation constraint; P2 means a reproducible correctness defect.

## Confirmed findings

### 1. P1 — Restarted worker permanently preserves its abandoned running job

- **Location:** `apps/worker/src/index.ts:15`, `:22`, `:102`; `infra/pocketbase/pb_hooks/lib/studio.js:20-21`, `:120-125`; worker heartbeat upsert in `apps/web/src/app/api/[...path]/route.ts:149-150`.
- **Trigger:** Kill/restart the worker during a job, with the same normal `WORKER_ID`/hostname, before the lease-expiry cron fails that job. A lost completion report followed by continued heartbeats causes the same state.
- **Evidence:** The restarted process has no `active` job but immediately updates the same worker record. `claim()` refuses any new job because that worker still owns a running job. `expireLeases()` checks only the worker heartbeat, so the new process keeps the abandoned job alive indefinitely. Cancelling merely sets `cancel_requested`, which no active executor processes.
- **Local confirmation:** Executed the actual hook module in a read-only VM fixture with a fresh worker heartbeat and an abandoned running job: claim returned `{ "job": null }`; lease expiry performed no transition. No database was touched.
- **Fix:** Introduce a process/session lease and job-specific heartbeat, or perform atomic startup reconciliation of jobs owned by the previous session. Mark uncertain abandoned paid jobs failed without resubmission. Add restart and lost-completion coverage.

### 2. P1 — Flow knowingly exceeds the approved automatic retry limit

- **Location:** `packages/connectors/src/flow.ts:20-24`; `apps/web/src/server/service.ts:78-79`; `PLAN.md:88`.
- **Trigger:** A Flow bridge generation encounters a retriable failure.
- **Evidence:** The adapter explicitly documents upstream `maxRetries=3` and invokes it without a retry-policy override. Quotes reserve four attempts. The approved requirement allows no more than one automatic retry. A larger reservation does not enforce that limit.
- **Confidence boundary:** The mismatch is confirmed in the implementation's declared integration contract and setup documentation. The installed bridge's runtime behavior was not independently exercised, and no generation was submitted.
- **Fix:** Use a reviewed bridge version/configuration that enforces at most one retry, and verify its retry policy before exposing generation capability. If the current bridge cannot enforce the cap, disable paid Flow submission until that contract is corrected; do not silently treat four-attempt approval as an amendment to the requirement.

### 3. P2 — Saving an invalid storyboard makes the episode editor inaccessible

- **Location:** `apps/web/src/app/api/[...path]/route.ts:63-69`; `apps/web/src/server/service.ts:45`; `apps/web/src/server/vault.ts:44`; `packages/core/src/index.ts:49-52`.
- **Trigger:** Set a storyboard beat's seconds to zero/empty in the UI and click Save, or edit the Markdown to contain an invalid numeric field through Obsidian.
- **Evidence:** The document endpoint validates only the content string and revision, then persists it. The storyboard editor has no form submission validation to enforce its input's `min`. Every episode-details request calls the throwing `readBeats()` parser, so the successful save is followed by a failed refresh and the episode cannot reopen for correction.
- **Local confirmation:** `serializeStoryboard` produced a row with `seconds=0`; `parseStoryboard` rejected that same row with `Too small: expected number to be >=0.1`.
- **Fix:** Validate storyboard structure before API writes, including numeric limits and unique beat indexes. Since external Markdown editing is supported, return raw documents plus a recoverable parse error from episode details instead of making the entire episode unreadable. Permit repair through the editor.

### 4. P2 — Script approval is not bound to the approved vault revision

- **Location:** `apps/web/src/app/api/[...path]/route.ts:58-61`; `apps/web/src/server/service.ts:97-100`, `:129-134`, `:159-163`.
- **Trigger:** Approve a script, edit `script.md` in Obsidian/Git, then request a storyboard. Alternatively, create a storyboard quote, revoke script approval in another session, then approve the still-valid quote.
- **Evidence:** Approval stores only a Boolean. External vault edits never clear it. `makeQuote` checks the Boolean before reading whatever script is currently on disk; `approveQuote` does not recheck script approval or its revision before reserving/calling the provider. The storyboard can therefore be generated from text the user never approved, or after approval was revoked.
- **Fix:** Store the approved script content hash and compare it to the current vault content. Freeze that revision in the quote and revalidate it, plus approval state, before reservation/provider invocation and before committing output. Return a review-required conflict for stale quotes.

### 5. P2 — Storyboard validation permits omitted, reordered, or repeated approved narration

- **Location:** `apps/web/src/server/service.ts:160-163`; `packages/core/src/index.ts:12-18`.
- **Trigger:** A model returns only one sentence of the approved script, reverses the sentences, repeats a sentence, or supplies empty voiceover strings.
- **Evidence:** Validation checks each beat independently with `script.includes(beat.text)`. It does not check coverage, ordering, duplication, or unique indexes. Empty strings are accepted by `beatSchema` and always pass the substring check. The result is saved as the storyboard and determines the rendered sequence/duration despite the generation contract promising to preserve the approved script verbatim.
- **Local confirmation:** Approved text `First line. Second line.` and a single valid beat containing `Second line.` pass the exact existing preservation check.
- **Fix:** Define narration separately from time cues/directions, then require ordered full narration coverage (or an explicit reviewed subset). Validate unique sequential indexes and nonempty narration where required. Reject deficient generated output before overwriting the storyboard.

### 6. P2 — Diagnosis timestamps are not tied to the quoted script beat

- **Location:** `packages/core/src/index.ts:63-69`; `apps/web/src/server/service.ts:166-167`; `PLAN.md:74`.
- **Trigger:** The model pairs a real quote from the opening with a later retention drop timestamp elsewhere in the video.
- **Evidence:** Validation checks that the quote appears anywhere in the script and that the timestamp falls inside total duration. It never checks their relationship. The output is then rendered under an authoritative timestamp heading. This satisfies neither the corresponding-beat requirement nor the test's description of a real script timestamp.
- **Local confirmation:** `validateDiagnosis` accepted `Opening line.` at 29 seconds for `0:00 Opening line.\n0:29 Ending line.` in a 30-second video.
- **Fix:** Supply verified timed script/transcript segments or approved beat timing; require each finding to reference a segment ID and validate the quote and timestamp against that segment. When timing is unavailable, explicitly return an untimed/estimated finding rather than claiming a verified beat timestamp.

## Coverage and remaining uncertainty

- Read the existing core and PocketBase integration tests. Their passing results are consistent with these findings: they cover happy-path claims/completion, same-quote replay, concurrent budget reservations, serialization round trips, and out-of-video diagnosis times, but not restarted sessions, corrupt stored storyboards, script revision approval, narration coverage, or quote-to-time alignment.
- The direct reproduction harness used only in-memory fixtures and pure source functions; it created no test files and contacted no services.
- Live YouTube/OAuth permissions, rclone authorization/upload integrity, ACE-Step protocol compatibility, actual Flow bridge output/retries, and HyperFrames rendered media/audio remain integration acceptance items. This review does not claim those integrations work or fail without live evidence.
- No additional confirmed credential-exposure, automatic-publishing, or same-quote paid replay defect was found in the inspected paths. Reservation locking is implemented transactionally and includes failed reservations in budget totals, which is appropriately conservative for uncertain provider outcomes.
