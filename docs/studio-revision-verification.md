# Studio revision verification — 2026-10-28

## Delivered behavior

- Sidebar channel/project list removed; Projects holds the real identity cards plus a functional Add channel card and form.
- Each project contains Channel analytics and Video analytics. The video library searches actual cached uploads; full reports work for uploads without a production record.
- Video Details opens full analytics for the exact selected video, with daily trend, retention, interactions and audience reports. Existing script/CSV/diagnosis features remain tied to genuine matching production data. Historical or stale report caches cannot expose actions against a different current production snapshot.
- Episodes is now Studio in navigation and visible production entry points. A library/pipeline opens the production board: saved script, real stages, selected media/render preview, scene filmstrip, duration-based inspector, activity and delivery. Existing editors, revision-bound script approval, spend review and worker queue are retained.

The board adapts the living storyboard described by [OpenMontage Backlot](https://github.com/calesthio/OpenMontage/blob/main/backlot/README.md) to the existing app engine. It does not install or claim feature parity with the complete OpenMontage system.

## Backend and data

Additive native migration1793059203 creates the private channel/video/date-scoped video_reports cache and unique channel identity indexes. Disposable native integration passed, then the migration applied to the live local database after backup before-studio-revision-20261028.zip. Existing read-only OAuth credentials/scopes remain intact.

Actual Arthur reports for the completed 28-day range were fetched and read back from cache:

| Video | Production linked | Views | Daily rows | Retention points |
| --- | --- | --- | --- | --- |
| Cuma Kurang Rp.3000 pt1 | No | 1,988 | 6 | 100 |
| Busnya Sudah di Depan Mata… Lalu Dia Berbalik #shorts | Yes | 1,132 | 2 | 100 |

Both reports' summary views equaled their daily sums. Video metrics were normalized to the same report summary. Viewing/syncing unlinked uploads created no episode or vault record. API data can lag; lifetime catalog totals are intentionally separate. Proof: private .runtime/video-revision-verification.json.

Final production-build HTTP verification: anonymous selected-video GET401; owner cached GET200 with the exact video and 100 retention points; cross-origin create400; duplicate/unsafe channel400; malformed video and impossible range400. Three connected user channels and 11 productions remained. Proof: private .runtime/studio-revision-http-verification.json.

## Automated checks

- npm run typecheck: passed.
- npm test: 66 passed, 1 opt-in native integration skipped in that command; no failures.
- npm run test:integration: separately passed on a disposable native database with the additive migration.
- npm run build: passed after the final backend fixes; latest production server restarted on3100.
- Focused tests include every selected-video query filter, bad/empty video identifiers, OAuth ownership rejection before writes, disconnected channel validation, no-production sync side effects, cache/range/snapshot truth, URL legacy aliases and real scene boundaries.
- Manual code review checked request ownership/filtering, cache keys, no-production effects, asynchronous navigation guards, channel/vault confinement and retained editing/approval guards. The empty-ID and stale-snapshot findings were fixed with failing then passing regression tests.

## Browser checks

Built-in browser inspected at1440×900,390×844 and the recorded owner viewport704×884. No page-level horizontal overflow was observed. Actual images were allowed to finish loading. A browser full-page screenshot defect affected Projects/library captures; those evidence files were replaced with valid viewport captures. Other full-page captures were inspected and valid.

Observed: Add channel duplicate error and successful disconnected project creation; channel/video navigation; exact modal CTA; exact-video reload; video search; matching Open in Studio; browser Back to the same video; daily metric selector and retention keyboard scrubber; Studio project filtering/library; actual three-scene timing and end boundary; mobile drawer and responsive layouts. Unsaved script testing showed the native discard confirmation; Cancel kept the text and disabled generation/approval/refresh. The test text was restored without saving.

Production timeline testing used one clearly labeled synthetic fixture with2/3/1-second scenes. Successful channel creation used one clearly labeled disconnected synthetic channel. Both were verified to contain no assets, jobs, quotes or user work before their records were archived and cleaned up. The production folder was moved to a confined private runtime archive, with content hashes verified first. Recoverable copies remain under .runtime. Final user records:3 connected channels,11 productions.

Screenshots, detector result and review packet: .impeccable/review/studio-revision. Detector ran once:0 primary findings,10 contextual type/radius advisories. Manual finish disposition:ship. Reviewer/documenter substitution is disclosed in their reports because separate subagents hit the account usage limit; this is not an independent review.

## Integration limits

The current environment has no configured Drive/media assets and its render worker is offline. The production board truthfully shows missing media and queued-worker semantics. Real Drive playback and a new assembled render were not exercised in this revision. Flow automatic submission remains disabled for the pre-existing retry-policy reason. No paid provider call, new OAuth scope, upload/publication or deployment was performed. ThinkCentre deployment remains deferred.
