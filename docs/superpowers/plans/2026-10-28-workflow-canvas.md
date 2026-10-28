# Workflow Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace Studio's production-card entry with a Dify-style template canvas and persistent chat-driven workflow runs.

**Architecture:** Add typed graphs and private template/run persistence; compose the existing quote, vault, approval and worker services into explicit node actions. React Flow handles graph interactions. Root integrates the new surfaces with existing analytics and legacy production tools.

**Tech Stack:** Existing Next/React/TypeScript/PocketBase; @xyflow/react; no external workflow service or new credential scopes.

**Spec:** docs/superpowers/specs/2026-10-28-workflow-canvas.md (exact shared interfaces and routes).

## Global Constraints

- English UI; Dify canvas topology is user pinned; incumbent graphite shell and analytics remain.
- No imported YouTube uploads masquerading as new Studio conversations; preserve all existing records.
- Existing playbooks, revision approvals, one-use spending quotes, worker safety and deferred deployment remain authoritative.
- No paid provider invocation, external publication or deployment during development.
- Shared workspace, no Git repository; workers must not revert others' edits.

## Review Focus

- Invalid/cyclic/disconnected graphs or duplicate edges never execute; state follows dependencies, not coordinates.
- A saved template changes neither a running graph nor another channel's context.
- Duplicate or cross-run approvals cannot charge or overwrite user documents; stale review hashes reject.
- Missing providers and offline workers display truthful blocked/queued states; chat acknowledgements never fake AI results.
- Canvas editing, panel navigation and browser history preserve unsaved edits and exact run identity across all widths.

### Task 1 — Workflow contracts and execution (backend worker)

Own: core/workflow.ts + core/index.ts export; server/workflows.ts; additive migration1793059204; tests/workflows.test.ts. Narrow service.ts optional internal playbook context only.

- [x] Write failing graph/dependency and server safety tests; observe RED.
- [x] Implement the spec's exact types/default graphs/validators and server exports. Tests prove no provider/episode side effects on GET, source-bound reviews and run snapshots.
- [x] Add private persistence migration and test with disposable native DB; parent applies live backup/migration.
- [x] Run focused tests/typecheck; report boundaries and any necessary contract changes before making them.

### Task 2 — Canvas interactions (UI worker)

Own: components/workflow-canvas.tsx and workflow-canvas.css only. Root installs React Flow and imports styles.

- [x] Read craft floor before UI edits and implement the specified pure component against shared types.
- [x] Add/select/drag/connect/delete nodes and edges; zoom/pan/fit; protect brief root, keyboard controls, read-only run mode, actual status labels.
- [x] Verify compile and report integration usage and accessible control names. Parent drives the browser after integration.

### Task 3 — Studio/chat integration (root)

Own: workflow-studio.tsx, workflow-studio.css, navigation.ts, studio.tsx, ui.tsx if needed, API route, globals import, tests/navigation/API, docs/context.

- [x] Replace Studio entry with template and real run library; add template/run URL identity and legacy preservation.
- [x] Compose canvas with right node configuration, save/version/dirty guards, creation form, run creation and editable chat/real artifacts.
- [x] Wire all server routes to owner/origin protection; retain existing editor as explicit Production tools from a run and legacy deep links.
- [x] Run focused/full checks, additive backed-up migration, build/restart.

### Task 4 — Finish

- [x] Exercise live template persistence, canvas interactions, new run/chat and unavailable-provider recovery without spending.
- [x] Batch desktop/mobile/user screenshots, apply material fixes, detector once.
- [x] Fresh code and finish review; resolve findings, document final system scope and verification. Leave local app running.
