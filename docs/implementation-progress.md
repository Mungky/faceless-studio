# Implementation ledger — plan: docs/superpowers/plans/2026-10-31-channel-studio-production.md

2026-10-31: Owner explicitly approved implementation after survey and interactive design.
Baseline: npm test — 96 passed, 2 integration-only skipped, 0 failed.
Branch: codex/channel-studio-production.
Existing changes preserved: original working studio.tsx and untracked pipeline route copied to
.runtime/channel-studio-before-20261031. docs/COOLIFY.md is pre-existing user work and remains untouched.
Ruling: implement in the current checkout on a dedicated branch rather than relocate the
user's dirty working tree and workspace-linked dependencies. Git branch creation required
the existing approval mechanism; approved and created. No user changes discarded.
Ruling: latest approved conversation and prototype supersede old violet/Dify surface briefs.
Use monochrome, Channel/Studio/FYP and card-based templates. Do not rerun concept selection.
Pre-flight: template snapshots must include Markdown content, not only a path; manual
entry must satisfy actual input review without fabricating generated research.
Pre-flight: the existing analytics/report services and worker have tested isolation and
lease behavior; reuse them rather than the untracked duplicate pipeline API.
External validation is separate from mock/unit evidence. No paid provider request authorized
by development itself. Existing vault content remains read-only until an explicit app operation.

T01 core and snapshot checks: defaults, alternate destination, exact manual text, immutable
playbook content and template edits were observed RED then GREEN. Preferences use a private
additive collection and transactional revision checks. Edited template content stays in the
database; original playbook files remain unchanged.
T02 authenticated workspace routes added after session authentication and origin checks.
The unsafe duplicate pipeline now returns 410 and has no filesystem/provider mutations.
T06 connector checks: SearXNG JSON contract, missing services and public-source URL validation
were observed RED then GREEN. Obscura requires a configured MCP bridge and discovers its tool.

T03/T04/T05: new Channel/Studio/FYP shell and actual database-backed browser checks passed:
login, manual script exact preservation, exact review, provider failure, template editing,
default selection, multi-slot channel settings, episode recovery, unsaved guard and mobile fit.
Desktop and phone screenshots inspected under .runtime/workspace-browser-*.
T07: schedule tests cover WIB day boundary, multiple slots, backlog and stable keys.
Native PocketBase tests observed the new CAS test fail on raw JSON handling, then pass
after JSON decoding was corrected. Concurrent writers/claims now accept one winner.
T08: evaluation tests preserve missing metrics and >100% APV, compare matching periods,
and state calendar-period versus publication-age limitations. Automatic proposals remain
pending until explicit review and reject stale template versions.
T09: actual code composition renderer and Windows worker path added. Original seekable
code produced distinct frames at 0.1/0.8 seconds and an actual 1080x1920 24fps one-second
video. SHA normalization mismatch was observed in the real render test, fixed canonically,
and the frame/render test passed. No provider was called and no source project modified.
T10: baseline expanded to 115 tests: 112 pass, 3 integration-only skips; native integration
33/33 pass. Typecheck passes. A restricted build failed on generated standalone directories;
native build verification is running. External services are not inferred from fixtures.
Ruling: use an isolated local Chrome test profile with a disposable PocketBase/vault for
runtime UI verification because Chrome DevTools MCP is unavailable and the remote in-app
browser cannot reach this Windows loopback. It exercises the real app without personal
browser sessions, production writes, or paid calls; it does not prove live provider access.
Ruling: keep the implementation as reviewable working-tree changes on the dedicated branch,
with the pre-existing replacement backed up and docs/COOLIFY.md untouched. The final review
must include untracked source files as well as git diff; no shared branch is pushed.
Design detector ran once. Its findings were advisory palette/type/radius differences from
the superseded violet design and an Arial declaration. The final UI uses the native system
stack; the monochrome palette follows the approved direction. No functional detector error.

2026-10-31 (continuation): typecheck, 122 unit, 37 native integration, code-render and
browser workspace checks pass; production build passes. Fixed a mock leak in
tests/workflows.test.ts that broke the native integration test. Live services:
9Router and Obscura are reachable but answer 401 with the configured credentials;
SEARXNG_URL is still unset. No provider generation has been called.
