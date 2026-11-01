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

> **Superseded 31 Oct 2026 (evening):** the owner chose Higgsfield as the visual reference
> and Google Flow for Assets. `apps/web/src/components/higgsfield.css` is the live skin and
> overrides the tokens above. The sections below describe the current direction.

## Colors

Near-black canvas (#0a0a0a) with surfaces #141414/#1c1c1c and lime accent #d1fe17 with
black text on it. Lime marks the primary action, the active nav item, selection and
scores; never body text. Channel banners and thumbnails keep their colors.

## Typography

Native system stack. Page titles are heavy (800), tight and uppercase, Higgsfield-style.
Controls are semibold. Monospace only for code.

## Layout

A fixed left sidebar (Channel, Studio, For You, Asset; Pengaturan, PC status, refresh,
logout and collapse at the bottom) becomes a drawer on phones. Workspace-wide settings live
only in Pengaturan; a channel's own tab keeps its template, schedule and YouTube account.
Studio is three panes: conversations, templates and Running tasks; the agent chat; and the
workflow canvas (editable template or live run). Asset follows Google Flow: media types,
projects with groups and trash on the left, a size-adjustable media grid, and a prompt bar.

## Elevation & Depth

Tonal steps and thin borders. Prompt boxes (composer, chat, Flow prompt) float with a
deep shadow; the primary action may carry a soft lime glow.

## Shapes

Pills for buttons, chips and segmented controls; 16–20px cards; 24px dialogs and prompt
boxes. Native dropdowns, dates, ranges and checkboxes are restyled to match.

## Components

Channel cards contain actual artwork, identity and metrics. Template cards always
offer Edit template and Use. A channel default is visible in the composer; an episode
override is explicitly described. Reviews name the exact current version. Frame previews
are rendered from the saved animation; placeholder illustrations never stand in for them.

## Do's and Don'ts

Preserve unknown values, source ranges, freshness and visible connection failures.
Keep planned publication targets separate from actual uploads. Keep workspace-wide
settings only in Pengaturan and per-channel settings only in the channel. Preserve original
manual scripts and recoverable versions. Agent actions are proposals the owner applies.
