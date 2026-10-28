# Channel projects verification — 2026-10-28

## Delivered scope

Projects is the opening screen. Arthur, Not Yet and Exhibit Pop use their existing connected channel identity, real banner/avatar/description/handle and public subscriber/video statistics. Each opens a scoped whole-channel dashboard with period controls, daily chart, popular content, reactions, geography, traffic, device, subscribed status, demographics, an upload calendar, and video detail. Existing production tools and Video analysis remain available.

## Data and integration checks

- Native PocketBase migration 1793059202 applied additively; local pre-migration backup before-channel-projects-20261028.zip retained. Existing OAuth credentials preserved.
- Real profiles and 28-day reports fetched for all three channels. Complete owner upload catalogs: Arthur 24, Not Yet 24, Exhibit Pop 1. These include private/unlisted uploads; public counts are labeled separately.
- Whole-channel summary views match same-metric daily report sums. YouTube truncates queries according to metric availability, so daily requests use the same metric set as summary requests.
- API cache GETs are authenticated and channel/date scoped. Anonymous reads, cross-origin mutations and impossible dates are rejected. Episode count remains 11; remote uploads do not create production/vault records.
- Required report failure retains cached reports. Optional sections display unavailable. A failed catalog refresh marks coverage incomplete while retaining known history. Transient read-only HTTP 500/502/503/504 retries once; permission/quota errors are not retried.
- Existing read-only OAuth scopes suffice; no new permissions, paid generation or publishing occurred.

## Automated verification

- Production build and TypeScript compilation passed after final source changes.
- Whole application suite: 56 passed, 1 opt-in integration test skipped in that command.
- Standalone native PocketBase integration: 1 passed; run separately on a disposable local database.
- Latest focused channel/report/navigation/error suite: 30 passed, 0 failed, including nested error scenarios, after code-review fixes.
- Broad code review: stale episode-response navigation and catalog coverage findings both corrected and re-reviewed as resolved.
- Design detector ran once on changed targets: 0 primary findings; 139 system advisories handed to visual reviewer. Detector was not rerun.

## Browser verification

Final build inspected at 1440×900, 390×844, and actual user viewport 1011×668; no page-level horizontal overflow. Images loaded successfully. Popular-content tables intentionally scroll inside their panel on mobile.

Verified project cards; all three channel switches; project/episode deep links and browser Back; 7-day report fetching and custom date application; chart metric/keyboard controls and data-table access; top 5/all content disclosure; date selection with three uploads; calendar previous month and keyboard month rollover; lifetime/period video modal; linked production episode; mobile menu and Escape.

Captures and review packet: .impeccable/review/channel-projects/. Full-page captures were taken from scrollY=0; calendar and modal captures show their actual viewport states. The visual review disposition is recorded separately in docs/channel-projects-design-review.md.

## Interpretation

Channel reports use Pacific reporting days and can lag. Publish/upload timestamps use Asia/Jakarta. Private/unlisted dates represent upload time; public dates represent publication time. Calendar views/likes/comments are lifetime totals as of catalog sync, distinct from selected-period reports. Omitted or privacy-limited audience data is unavailable rather than inferred zero. Exhibit Pop currently has a genuine zero summary and empty daily/audience reports for the tested range.

ThinkCentre deployment remains deferred by the owner. Verification here concerns the local running app.
