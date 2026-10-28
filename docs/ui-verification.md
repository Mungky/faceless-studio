# Browser verification — 28 October 2026

The owner requested the complete PLAN.md application, an English UI, and a dashboard like Linear. Server deployment was explicitly deferred; this review covers the locally built application.

Observed in the in-app browser against the production bundle:

- Owner sign-in and session persistence. Projects is now the opening screen; see [channel-projects-verification.md](channel-projects-verification.md) for the subsequent approved channel dashboard and calendar change.
- Created one labelled disposable episode in Arthur; saved and reloaded a full script.
- Approved the displayed script revision; editing and saving revoked that approval; approving the current version succeeded.
- Added and saved a storyboard beat. Missing 9Router produced an actionable error before any generation.
- An externally corrupted disposable storyboard reopened with a plain-language repair message and its raw Markdown. Saving the repaired text restored the structured editor.
- Marked the disposable episode published and saved its explicit past UTC publication time; no YouTube publish occurred.
- Seeded one snapshot labelled `[SYNTHETIC TEST]` solely for interaction verification. At retention 0:06, both scrubber and inspector showed 0:06 and the exact second timed script line. No real analytics are claimed.
- Mobile navigation opens and closes with Escape. Closed navigation is absent from accessibility state. Mobile chart axis labels remain readable.
- Captured and visually inspected desktop 1440, mobile 390, and the two observed user widths 1087 and 1280 from the document top. An initial full-page capture at a nonzero scroll offset was discarded and replaced before review.
- Removed only the agent-created episode and synthetic snapshot from live data, keeping recoverable records/vault files under `.runtime`. The final workspace shows unavailable metrics and zero episodes honestly.

## Evidence

Required current screenshots in `.impeccable/review/`: `desktop.png`, `mobile.png`, `user-1087.png`, `user-1280.png`.

Interaction/state evidence: `analytics-synthetic-desktop.png`, `analytics-synthetic-mobile.png`, `mobile-navigation.png`, `workbench-desktop.png`, `workbench-mobile.png`, `storyboard-repair.png`. Synthetic values appear only in screenshots labelled as tests and were removed from live data.

The one mechanical detector run on `apps/web/src` returned `[]` in `detector.json`. Subsequent changes improved mobile chart labels, hid closed mobile navigation, added Escape dismissal, and simplified the storyboard repair copy; no second detector was run.

Automatic Flow generation is deliberately unavailable because the installed bridge cannot prove the required retry/reconnect limit. The UI explains manual Flow result import and the configurable alternative provider. Other live provider/account acceptance is deferred with deployment; no paid calls or Drive transfers were made.
