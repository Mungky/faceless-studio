# Faceless Studio

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed in PLAN.md: TypeScript, Node >=22, Next.js, PocketBase, Docker Compose, n8n, 9Router. HyperFrames and ACE-Step execute on a Windows worker. Large files live in Google Drive through rclone. Markdown lives in the existing Obsidian vault.

## Users

One owner producing faceless YouTube videos for Arthur, Not Yet, and Exhibit Pop, working from a Windows laptop with a private home server.

## Product Purpose

Open the app as channel projects: Arthur, Not Yet, and Exhibit Pop, with an Add channel card for future projects. Each project contains Channel analytics and Video analytics, including full reports for uploads that have no production record. Channel reports lead with YouTube identity, audience reports and an upload calendar; Video Details opens the selected video's full analytics. Studio organizes production from research through script, storyboard, voice, music, footage, rendering and an upload pack. Its Dify-style workflow canvas connects reusable channel templates, persistent production chat, exact-output reviews and real job states. Existing editors remain in Production tools. Use per-video analytics and script-grounded diagnoses to decide what to improve next.

## Operating Context

The home server is a ThinkCentre, Intel i7 generation 7, 16 GB RAM, currently Zorin with Docker and Tailscale. A later move to headless Ubuntu Server must remain possible. The worker pulls jobs; an offline laptop leaves them queued. The vault root is D:/Faceless Creation/projects, synchronized using Obsidian Git (confirmed by owner, superseding Syncthing in the original diagram).

## Capabilities and Constraints

All UI copy is English. Preserve the existing playbooks and render projects. No automatic publishing. Every paid operation requires an explicit estimate and approval, enforced on the server. Credentials remain in environment files. Google Flow through the Flow Connector is the preferred generation provider, with replaceable connectors and configurable spending limits. Flow's browser must remain signed in and visible on the worker; it cannot run on the headless server. Deployment is private over Tailscale and is deferred by the owner. All three YouTube channels are connected with read-only OAuth; missing provider connections must never be fabricated.

## Evidence on Hand

PLAN.md; projects/Arthur/Arthur.md; projects/Not Yet/Not Yet.md; projects/Exhibit Pop/Exhibit Pop.md; existing HyperFrames compositions; local ACE-Step installation; connected YouTube channels and per-video snapshots. Approved changes are recorded in docs/superpowers/specs/2026-10-28-channel-projects.md and docs/superpowers/specs/2026-10-28-studio-revision.md. The owner subsequently selected Dify’s canvas and production conversation model in docs/superpowers/specs/2026-10-28-workflow-canvas.md, superseding the OpenMontage production-board entry; the app retains its existing production engine. Empty metrics must remain empty, never presented as real channel performance.

## Brand Commitments

The owner explicitly selected Dify's workflow canvas for Studio on 28 October 2026, superseding the former production-card/board entry. Studio centers on a node canvas, right configuration panel and production chat, with Arthur/Not Yet/new templates. The incumbent Linear-like graphite shell, compact sidebar and channel analytics remain outside this surface change. Preserve quiet dark surfaces, legible controls and explicit state markers. The application is English. User-pinned references supersede earlier direction cards and random assignments.

## Product Principles

- Existing playbooks are configuration and remain authoritative.
- Text, status and large files have separate, explicit sources of truth.
- A worker being offline is a normal state, not a lost job.
- Approve spending before the provider is called; never retry an ambiguous paid request automatically.
- Make missing connections and unavailable metrics clear and actionable.
