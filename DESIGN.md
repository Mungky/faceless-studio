---
name: Faceless Studio
description: A monochrome workspace for channels, templates and video production.
colors:
  bg: "#0b0b0c"
  surface: "#131315"
  raised: "#1b1b1e"
  line: "#2a2a2e"
  line-soft: "#222225"
  text: "#ededee"
  muted: "#a2a2aa"
  quiet: "#85858e"
  accent: "#eeeef0"
  accent-bg: "#252528"
  primary: "#e9e9ec"
  positive: "#bec8c0"
  pending: "#d4c9b2"
  error: "#edb1b1"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "36px"
    fontWeight: 500
    letterSpacing: "-0.05em"
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "29px"
    fontWeight: 500
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    lineHeight: 1.5
  control:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 500
  metadata:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "10px"
rounded:
  control: "6px"
  card: "9px"
  dialog: "10px"
spacing:
  compact: "8px"
  control: "12px"
  card: "18px"
  section: "24px"
  page: "38px"
---

## Overview

The approved 31 October 2026 redesign supersedes the violet sidebar and Dify canvas.
The owner selected dark monochrome, minimalism, and Linear/Notion/Vercel references.
This is an Operate interface: clear tasks, legible state, and restrained visual structure.

## Colors

Use neutral charcoal layers and light primary buttons. Reserve subdued positive,
pending and error tints for actual state. Channel banners and video thumbnails keep
their original colors. Missing data is a dash or explicit empty state.

## Typography

Use the native system stack for app text, medium weight headings, and compact controls.
Use a monospace face only for code. Phone template cards use larger text and controls.

## Layout

The persistent top navigation has Channel, Studio and FYP. Channel details contain
analytics, production, agent reports and settings. Studio has an episode composer and
a three-column template grid, two columns on smaller desktops, one column on phones.
An episode uses five stages above an editor and a conversation sidebar; on phones the
conversation follows the editor. The normal page width is 1320px, editor width 1600px.

## Elevation & Depth

Separate panels by tonal steps and thin borders. The composer has a restrained shadow;
other cards remain flat. Dialogs use the native modal backdrop and focus behavior.

## Shapes

Controls have 6px corners; cards and dialogs use 9–10px corners. Avatars and step
numbers may be circular. Avoid ornamental gradients, glow, decorative charts or blobs.

## Components

Channel cards contain actual artwork, identity and metrics. Template cards always
offer Edit template and Use. A channel default is visible in the composer; an episode
override is explicitly described. Reviews name the exact current version. Frame previews
are rendered from the saved animation; placeholder illustrations never stand in for them.

## Do's and Don'ts

Preserve unknown values, source ranges, freshness and visible connection failures.
Keep planned publication targets separate from actual uploads. Keep settings within
the channel. Preserve original manual scripts and recoverable versions. Do not restore
the retired pipeline API, global Home/Settings, or node-canvas entry as the primary UI.
