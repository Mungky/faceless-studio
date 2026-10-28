---
name: Faceless Studio
description: A quiet graphite workspace for channel performance and episode production.
colors:
  bg: "#111216"
  sidebar: "#15161b"
  surface: "#191a20"
  raised: "#202128"
  line: "#2b2d36"
  line-soft: "#24262e"
  text: "#eceef3"
  muted: "#a0a3b2"
  quiet: "#777c8d"
  accent: "#a49cf4"
  accent-bg: "#29263e"
  primary: "#665dcd"
  primary-hover: "#7167d4"
  green: "#91c9a8"
  amber: "#dfbd83"
  red: "#f19d9d"
  status-positive: "#9bcfb3"
  status-running: "#b9b1f4"
  status-queued: "#e2c18e"
  status-failed: "#f0aaa9"
  status-unavailable: "#a1a6b5"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  control:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
  metadata:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "10px"
  metric:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "27px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  mono:
    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace'
rounded:
  control: "6px"
  card: "7px"
  container: "8px"
  workspace: "10px"
  dialog: "12px"
spacing:
  compact: "7px"
  control-gap: "8px"
  row-gap: "10px"
  field-gap: "16px"
  section-gap: "20px"
  dialog-inset: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#fff"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "#23242c"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  button-text:
    textColor: "{colors.muted}"
    padding: "4px 0"
  field:
    backgroundColor: "#14151b"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  navigation-active:
    backgroundColor: "{colors.accent-bg}"
    textColor: "#ddd8ff"
    rounded: "{rounded.control}"
    padding: "7px 11px"
    height: "34px"
  status:
    typography: "{typography.metadata}"
    textColor: "#b0b4c1"
  episode-card:
    backgroundColor: "#22232c"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "14px"
  dialog:
    backgroundColor: "#1d1e27"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "{spacing.dialog-inset}"
---

# Design System: Faceless Studio

## Overview

**Creative North Star: "The quiet working dashboard"**

The shipped Operate world follows the owner's explicit Linear reference: graphite grounds, restrained violet selection, compact navigation, and familiar web controls. Information and next actions carry the hierarchy. English copy and honest connection states make this a working private studio.

The build uses flat digital surfaces and consistent outline icons. It has no shipping raster artwork and no approved visual comp; source and rendered captures establish the system.

**Key Characteristics:**

- Compact sidebar and focused detail panels.
- Dense tables with tabular measurements.
- Quiet surface changes and thin separators.
- Violet selection and explicit status text.
- Responsive stacking with deliberate horizontal table scrolling.

Evidence: `apps/web/src/app/globals.css`; sampled `studio.tsx`, `analytics.tsx`, and shared `ui.tsx`; `PRODUCT.md`; `apps/web/.impeccable/surfaces/apps-web.md`; `.impeccable/review/desktop.png`, `mobile.png`, `user-1087.png`, and `user-1280.png`. The finish review in `docs/design-review.md` records disposition `ship`.

## Colors

Graphite and charcoal support pale text, with violet marking selection, actions, and the retention trace. Frontmatter records the exact reusable values.

### Primary

- **Working violet** (`primary`): filled primary actions; its hover variant brightens the fill.
- **Pale violet** (`accent`): focus outlines, retention trace, legend, and selected timestamp.
- **Violet charcoal** (`accent-bg`): active navigation background.

### Secondary

- **State green, amber, and red**: semantic feedback. Status labels use their own softer positive, running, queued, failed, and unavailable variants. Preserve those component assignments rather than replacing every state with the generic root color.

### Neutral

- **Graphite ground** (`bg`): page background.
- **Sidebar charcoal** (`sidebar`): navigation and analytics workspace ground.
- **Surface and raised charcoal** (`surface`, `raised`): supporting tonal layers.
- **Pale neutral** (`text`): primary content; muted text carries descriptions and metadata.
- **Quiet slate** (`quiet`): low emphasis separators and incidental chrome.
- **Fine graphite lines** (`line`, `line-soft`): containers and hierarchy between regions.

**The Violet State Rule.** Use violet for selection, primary actions, focus, and the retention trace; preserve semantic colors for operational status.

## Typography

**Body and UI Font:** the platform sans stack in frontmatter.
**Label/Mono Font:** Cascadia Code, SFMono-Regular, Consolas, monospace for timestamps, code, and keyboard hints.

The interface uses a compact workhorse sans. This is an app hierarchy with no separate decorative display face. The platform heading face is an observed implementation choice, not a reusable display-font prescription.

### Hierarchy

- **Headline:** page titles; reduces to (23px) on mobile, with episode headings at (22px).
- **Title:** section headings; detail headings also use (15–16px).
- **Body:** global base; descriptions and tables commonly use (12px), inspector prose (11px).
- **Control:** shared buttons; navigation uses (12px).
- **Label and metadata:** compact labels and status; incidental chart/footer text reaches (9px).
- **Metric:** tabular metric values; reduces to (25px) on mobile.
- **Document:** script editor text uses (13px), line height (1.9), reducing to (12px) on mobile.

**The Measured Numbers Rule.** Use tabular numerals for metrics and spending totals, and monospace for timestamps and code.

## Layout

The desktop shell uses a (232px) sidebar and (56px) top bar. Content is centered within a maximum width of (1580px), with default insets (31px 32px 60px). Analytics pairs a flexible workspace with a (280px) inspector. Four metric columns sit above it. Borders and shared alignment establish groups.

At widths up to (1200px), the sidebar becomes (210px), content insets become (27px 24px 50px), and the inspector becomes (240px). At (980px), the sidebar becomes (190px), analytics and audio stack, and metrics become two columns. At (720px), navigation becomes a fixed (245px) drawer, the top bar becomes (53px), and content insets become (24px 17px 42px). Tables retain a (600px) minimum width inside a scrolling container. Forms collapse to one column. At (1600px) and above, the inspector widens to (310px).

Spacing is compact and contextual rather than a strict universal grid. Small control gaps, medium field gaps, and wider section separation recur; frontmatter captures representative reused steps.

**The Preserve Readability Rule.** Stack detail regions and scroll wide tables at small widths, retaining the hierarchy and readable controls.

## Elevation & Depth

Resting surfaces are flat, separated by fine borders and small changes in charcoal. The inspector uses a slightly lifted charcoal background. Episode cards shift border color on hover. Modal dialogs alone use a substantial diffuse shadow and a dark backdrop.

### Shadow Vocabulary

- **Dialog:** `0 24px 80px #0008`, with backdrop `#05060bc9`.

**The Flat Workspace Rule.** Use tonal layering and borders for resting work areas; reserve the shipped diffuse shadow for dialogs.

## Shapes

Controls and navigation use small rounded corners. Cards, table wrappers, and work areas step up gently; dialogs have the largest recurring container radius. One-pixel borders remain visible on dark surfaces. Status markers are small circles; channel markers and avatars keep their own compact silhouettes. Lucide outline icons use stroke width (1.6), with some empty-state icons at (1.4).

## Components

### Buttons

Compact and explicit. Primary and secondary buttons share the frontmatter shape and padding, minimum height (32px), and gap (7px). Secondary buttons use a fine border; primary buttons match border to fill. Hover changes background and border over (.14s). Mobile shared buttons increase minimum height to (34px). Disabled controls use opacity (.45) and a disabled cursor. Text buttons remain transparent.

### Status markers

Inline labels pair a (6px) circular marker with explicit state text and a (6px) gap. Connected, done, online, and synced markers fill; unavailable markers remain outlined. These are status labels, not decorative pill chips.

### Cards / Containers

Episode cards have a fine border, compact inset, and hover border change. Table wrappers have rounded clipping and horizontal overflow. Analytics keeps the workspace and inspector within one bounded container. Document editors use a framed toolbar, editable body, and footer.

### Inputs / Fields

Dark inset fields use a (35px) minimum height, thin border, shared control corners, and frontmatter padding. Textareas resize vertically. Placeholder text stays muted. Keyboard focus uses a (2px) accent outline with (3px) offset; fields use (2px) offset. Checkbox and range accents inherit violet.

### Navigation

Rows combine outline icons, labels, and occasional counts. Active rows use violet charcoal and pale violet text; hover uses a quiet charcoal fill. The mobile drawer moves over (.2s) using `cubic-bezier(.16,1,.3,1)`. Escape closes it and restores toggle focus. Reduced motion disables the spinner and reduces transition/animation duration to (.01ms).

### Retention and script inspector

The violet trace, dashed cursor, range scrubber, and monospace timestamp share one selected time. The inspector shows the exact script excerpt for that time when available, using a fine violet left rule. Missing retention or script timing gets explicit explanatory text. Empty chart space keeps subtle dashed grid lines and one connection action.

### Dialogs

Native dialogs use a bounded scrolling body, heading with close action, and a separated action row. Standard maximum width is (490px), wide dialogs (940px), with height capped at (85dvh), increasing to (90dvh) on mobile.

## Do's and Don'ts

### Do:

- **Do** retain the compact sidebar, clear text hierarchy, and thin separators.
- **Do** pair every operational status color with a readable state label.
- **Do** keep measurements tabular and timestamps monospace.
- **Do** preserve accent focus outlines and reduced-motion behavior.
- **Do** show unavailable measurements as em dashes with an actionable explanation.

### Don't:

- **Don't** replace the confirmed quiet dashboard world with decorative display typography or raster decoration.
- **Don't** use shadows to separate ordinary workspace panels.
- **Don't** present fabricated performance values as live metrics.

Not canonized: the platform sans heading face is recorded as shipped UI evidence, not a display-font rule; no material defect or drift was reported by the finish reviewer. The observed 9px incidental metadata is descriptive, not a new minimum-text-size rule.

