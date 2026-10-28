# Channel projects

The owner approved Projects → Arthur / Not Yet / Exhibit Pop → channel analytics with an upload calendar and clickable video details, and explicitly requested execution through completion on 2026-10-28. This replaces the original Analytics landing requirement in PLAN.md. English UI and the established Linear-inspired graphite/violet system remain binding.

## Approach

Existing connected channels are the projects. Reuse their IDs, credentials, production episodes, and navigation scopes. A separate project entity would duplicate the same identity. Add additive profile and analytics caches; never manufacture episodes or vault documents just to list remote uploads.

## Screens

1. Projects is the default home: three clickable channel cards with the actual YouTube banner, avatar, description, handle, public subscriber/video counts, connection and last-sync state. Missing channel imagery has a quiet initial placeholder, not fabricated artwork.
2. Project dashboard: banner/identity header, back to Projects, period controls (7/28/90 days and custom up to 365), Sync. Genuine whole-channel views, watch hours, subscribers gained/lost and average view duration; an accessible daily metric chart; popular content; audience geography, traffic sources, device, age/gender and subscription breakdowns; likes, dislikes, comments and shares.
3. Calendar below analytics: month navigation, publication-day counts and thumbnails; select a day for its uploads and lifetime views/likes/comments. Calendar publish dates use Asia/Jakarta. Selected-period reports use YouTube's Pacific reporting days. Label these explicitly. Never portray lifetime views as views earned on publication day.
4. Clicking any video opens its metadata/performance detail with YouTube link and existing production episode link where available. Keep the existing retention/script analysis accessible as Video analysis. Preserve episode editing, assets, queues, spending and owner authentication.

## Truth and limits

Use YouTube Data API channel snippet/brandingSettings/statistics and uploads playlist pagination plus videos.list; use Analytics API reports for actual channel aggregates, daily trends, popular content and breakdowns. Both existing read-only OAuth scopes suffice. Dates and channel ownership are validated server-side. Reports and metadata are cached locally; polling must never continuously query Google. Manual Sync refreshes the chosen range. First visits may populate missing caches. A failed section has an explicit unavailable state; omitted demographic rows are not zero viewers. Report latency, catalog coverage and last-sync times remain visible. No synthetic metrics or paid provider calls.

Calendar uses lifetime metadata statistics, deliberately separate from selected-period top content. Bounded history pagination must expose incomplete coverage rather than a false zero-upload claim. No future scheduling or deployment changes in this request.

## Acceptance

All three connected projects appear with real available branding; project URLs survive reload and browser back/forward; channel data never crosses scope. Real channel summaries and daily reports agree with their source, optional failures preserve usable sections, unavailable values remain distinct from zero. Calendar handles month boundaries and UTC-to-Jakarta day rollover. Desktop, mobile and the user's actual viewport remain usable with keyboard access. Existing production checks continue to pass. Finish with rendered review and design documentation.

## Primary API references

- https://developers.google.com/youtube/data/reference/rest/v3/channels
- https://developers.google.com/youtube/analytics/channel_reports
- https://developers.google.com/youtube/analytics/sample-requests
- https://developers.google.com/youtube/analytics/dimensions
