# Channel projects design documentation

Date: 2026-10-28. Outcome: ordinary SAME-WORLD extension; incumbent system preserved.

The finished `apps/web` surfaces retain the owner's explicit Linear reference and the incumbent north star, “The quiet working dashboard.” This note records the composed extension, not a replacement design system. `DESIGN.md` and `.impeccable/design.json` remain unchanged; no new token family, identity, prohibition or sidecar component is introduced. The finish reviewer records `disposition: ship` with no material fixes in [channel-projects-design-review.md](channel-projects-design-review.md).

## Evidence checked

- Read the full Impeccable `reference/document.md` operating specification; incumbent [DESIGN.md](../DESIGN.md), `.impeccable/design.json`, [PRODUCT.md](../PRODUCT.md), and the updated [surface direction contract](../apps/web/.impeccable/surfaces/apps-web.md).
- Read and sampled finished source: [projects.tsx](../apps/web/src/components/projects.tsx), [project-analytics.tsx](../apps/web/src/components/project-analytics.tsx), [projects.css](../apps/web/src/components/projects.css), [studio.tsx](../apps/web/src/components/studio.tsx), and shared [globals.css](../apps/web/src/app/globals.css). Source establishes the values and behavior below; this is not an exhaustive application audit.
- Checked the [review packet](../.impeccable/review/channel-projects/review-packet.md) and completed finish review, which inspected all 13 required captures at desktop, mobile and the owner's viewport. Directly sampled `home-desktop.png` and `calendar-mobile.png`: actual branded cards, graphite shell, selected violet day and stacked upload detail agree with source. Other capture observations are attributed to the finish review rather than a new independent visual review.
- Accepted the supplied detector disposition: zero primary findings and 139 advisories already assessed by the finish reviewer. No detector rerun. Runtime and integration checks in the packet are builder evidence, not tests rerun in this documentation pass.

## Reused system patterns

The shared root palette remains graphite ground (`#111216`), sidebar (`#15161b`), surface (`#191a20`), raised charcoal (`#202128`), thin lines (`#2b2d36`), pale text (`#eceef3`), muted text (`#a0a3b2`), pale violet (`#a49cf4`), violet selection (`#29263e`) and primary violet (`#665dcd`). Local close shades express hover, disclosure, selected calendar cells, privacy labels and notices; they are observations, not new global primitives.

The extension retains the Violet State Rule through selected periods, focus, the daily chart and selected calendar date. The Measured Numbers Rule appears in metrics, chart scales, ranks, calendar dates and video totals. The Preserve Readability Rule appears in stacked regions and internally scrolling tables. The Flat Workspace Rule remains visible: cards, chart, audience and calendar use tonal layering and fine borders; video details reuse the existing modal. The calendar's inset one-pixel selected outline is state delineation, not a new ambient elevation treatment.

Shared buttons, status markers, fields, section toolbars, metrics, table wrappers, native dialogs, global focus outlines and Lucide outline icons keep their existing roles. New bounded work areas use the established eight-pixel corners; controls keep the familiar six-pixel shape. Circular channel avatars and cropped thumbnails express content identity rather than a new interface geometry.

## Composed surfaces and behavior

Projects opens with Arthur, Not Yet and Exhibit Pop as complete clickable cards. Each composes a banner, circular avatar, title, handle, clamped description, public counts, connection state and sync time. Refresh errors retain saved details with explicit retry guidance. The sidebar gains channel avatars and project navigation; the existing analytics destination is labelled Video analysis. Breadcrumbs and project/episode URLs support the composed navigation flow.

The channel view composes a broad identity header, preset/custom reporting periods, channel summary, daily trend, ranked content, interactions, audience/discovery and upload calendar. The daily trend extends the incumbent violet trace, dashed grid and inspection model with a metric selector, pointer inspection, labelled range input, exact-value table disclosure and explicit unavailable state. Popular content initially shows five rows with a disclosure for more. Audience sections disclose reported-view/viewer shares and privacy limitations.

The upload calendar pairs seven date columns with a selected-day inspector. Date selection carries upload counts and a real thumbnail; the inspector lists all cached uploads for the date and their lifetime values. Arrow keys move by day/week, Home/End move to month boundaries and month rollover restores focus. Selected state uses `aria-pressed`; today uses `aria-current="date"`; selected-day updates use a polite live region. Video details reuse the wide modal, presenting metadata, lifetime totals, separate selected-period values, a real YouTube link and an existing production-episode link when matched.

Reporting periods use Pacific reporting days; publication/upload dates use Asia/Jakarta. Private and unlisted videos retain explicit visibility labels and upload-time semantics. Public counts remain distinct from cached owner uploads. Catalog incompleteness is explained; missing daily/audience data is not rendered as invented zeros or a synthetic chart. Actual returned zero totals remain zero. These distinctions are product truth expressed by the surface, not new visual tokens.

## Typography and density

The platform sans stack remains the app's compact workhorse; no decorative display face is introduced. Home inherits the existing 25px page heading. Project identity uses 23px on desktop and 20px on mobile; card titles use 15px, becoming 14px at compact desktop widths. Descriptions and video titles commonly use 11–12px; report and chart metadata commonly use 10–11px. Shared metrics retain their existing hierarchy, while interaction totals use 20px and video-detail totals use 23px, becoming 20px on mobile.

Card descriptions use three-line clamps; channel-header descriptions use two lines on desktop and three on mobile. Titles truncate or wrap according to their record context. Dense tables keep aligned tabular measurements. Section spacing commonly uses 20px gaps and 25–34px separation, with 17–23px content insets. These are observed compositions within the existing contextual spacing model, not a newly minted universal scale.

Compact incidental labels reach 9px, while mobile upload counts and privacy badges reach 8px. Those values are documented as source observations, not a minimum-text-size recommendation or an exemption from future legibility review. The finish reviewer found no material legibility defect in the supplied captures.

## Responsive behavior

The existing shell retains its sidebar/topbar and mobile drawer behavior. Project cards use three columns by default, two at 1050px and below, and one at 720px and below. At 1200px the card gaps and insets tighten, identity banners reduce, and the calendar inspector narrows from 300px to 260px. At 1050px the calendar inspector moves below the month; audience panels become two columns. At 720px audience panels become one column, interactions become two columns, period controls wrap and the video-detail header stacks. The calendar preserves seven day columns with reduced cell insets and thumbnails. These extension-specific breakpoints remain local composition details, not changes to the incumbent sidecar's global breakpoint list.

The popular-content table preserves its 660px desktop minimum, reduced to 610px on mobile, inside the shared horizontal scroll wrapper. The daily chart height changes from 220px to 190px. The finish review and builder packet report no page-level clipping or missing media at desktop 1440px, mobile 390px and owner viewport 1011px; scrollbar-adjusted full-page capture widths are recorded in the review.

## Media provenance and documentation drift

Shipping channel media uses remote YouTube metadata: `profile.banner_url` for banners, `profile.avatar_url` for cards/header/sidebar, and `video.thumbnail_url` for popular content, calendar and video details. Images crop with `object-fit: cover`; thumbnails preserve a 16:9 frame. Missing media uses explicit text, an initial or a Lucide video outline. Decorative duplicate images have empty alternatives alongside named controls and text identity. No new local or generated raster is shipped. Review PNGs are evidence captures, not application assets.

The incumbent overview and sidecar narrative say the build has “no shipping raster artwork.” That historical statement is stale for the completed extension's real remote channel media. The incumbent rejection of raster decoration still describes the interface intent; it must not be expanded into a ban on native channel identity or video thumbnails. This note records the divergence without silently editing the incumbent narrative.

Not canonized or repaired: the pre-existing platform heading face remains shipped UI evidence rather than a display-font prescription; existing tiny incidental metadata and the extension's 8px badges/counts do not establish a reusable text-size floor; the stale no-raster statement remains identified above. The finish review found no material defect. Ordinary extension scope preserves the incumbent system and does not authorize repairing historical drift or turning detector advisories into new design rules.
