# Acceptance and evidence

Implementation checks and integration acceptance are separate. A configured field, a mocked API or a green build does not prove access to the user's Drive, channels, providers, laptop GPU or server. No paid calls, actual Drive uploads, real-vault Git sync, system-service installation or Docker startup were performed by the operational task.

## Local checks

Run from `studio/`:

```sh
npm ci
npm run typecheck
npm test
npm run test:integration
npm run build
node --check scripts/operations-common.mjs
node --check scripts/backup.mjs
node --check scripts/vault-sync.mjs
node --check scripts/test-operations.mjs
node --check scripts/test-backup-native.mjs
npm run test:operations
npm run test:render
docker compose --env-file .env -f infra/docker-compose.yml config --quiet
```

Use `config --quiet` so interpolated secrets are not printed. Docker configuration validation needs the CLI, not a running daemon. Operational tests use loopback HTTP, simulated rclone and disposable local Git repositories; they do not contact Drive or the user's vault. The native backup test starts a disposable PocketBase database using the installed development binary and validates its downloaded ZIP; it skips explicitly if that binary is absent. A restricted execution sandbox can block loopback and Git config writes in temporary directories; the same test command needs an environment allowing those local fixture actions. See the [operational report](operations-report.md) for checks actually run. Fresh application evidence is recorded below and in [ui-verification.md](ui-verification.md).

## Manual app checks

After local setup, verify owner login, channel navigation, episode creation, full-script editing/approval, storyboard editing, asset review, queue cancellation, spending limits, model routes and readable unavailable-state messages. Save a test episode only in an explicitly chosen disposable vault folder. Reload to confirm persistence. Verify narrow/wide layouts, keyboard focus, validation errors, and that publication still requires the external manual YouTube workflow. The final browser pass verified these editing/approval/recovery and responsive flows with labelled disposable fixtures, then removed the synthetic data from the live workspace. See [ui-verification.md](ui-verification.md).

## External acceptance checklist

| Check | Required evidence | Current status |
| --- | --- | --- |
| ThinkCentre deployment | Healthy containers on the actual Zorin/Ubuntu host and a browser response over the tailnet | Deferred by owner; prepared Compose configuration |
| Private binding | Host listening addresses match chosen loopback/Tailscale IP; no public router forwarding | Compose binding configured; live host pending |
| Vault mapping | Existing notes visible at the intended mount; a reviewed test save appears there | Example path corrected; actual server path pending |
| Drive media | Authorized non-sensitive file round trip with same content, under intended remote/folder | Pending rclone authorization |
| Database backup | Real PB-created ZIP, successful Drive copy, retained local copy and isolated restore drill | CLI fixtures pass; live backup/restore pending |
| Daily backup | Active timer, observed scheduled success and logs, then a restored sample | Templates supplied; not installed |
| Vault Git | Confirmed private remote, clean real vault, manual status, successful reviewed fast-forward | Fixture checks pass; real vault untouched |
| Three channels | Three independently authorized matching channel IDs, refresh access and owned-video reports | Pending Google production consent and account authorization |
| Analytics workflow | n8n manual run succeeds, then one observed scheduled run for connected channels | Workflow supplied inactive; pending credentials |
| 9Router | Actual model list, reviewed route/pricing, one explicitly approved completion | Pending routing/accounts; no paid request made |
| Flow | Verified retry/reconnect policy before submission, then reviewed output/credit comparison | Automatic submission disabled; manual result import / alternative webhook available |
| Voiceover | One reviewed quote, playable master in Drive, provider usage checked | Pending approved ElevenLabs request |
| Music/render/ffmpeg | Laptop heartbeat, real music output and Drive master round trip | Local HyperFrames/ffmpeg synthetic render verified on laptop GPU; live music / queue / Drive acceptance pending |
| Provider replacement | Idempotent webhook fixture/live provider output matches documented byte contract | Contract supplied; live provider pending |
| Clip retention | Reviewed manifest, exact identity checks and recoverable move | Implemented; 15 fixture tests and scoped review pass. Live move deferred. Same-Drive archive does not free quota |

Keep spending defaults at USD 0 / credits 0 until setup is reviewed. Explicitly free routes can still generate provider traffic; approve those only as part of the intended acceptance test. Do not raise limits simply to get a test to pass. Never count editorial model scores as real analytics.

For any failed paid request or ambiguous timeout, inspect the provider's job/usage history before approving another quote. Preserve the local recovery cache, exact job ID and relevant sanitized error; do not paste secrets or full environment dumps into an acceptance report.


## Final local verification — 28 October 2026

| Check | Observed result |
| --- | --- |
| TypeScript and production build | Pass; standalone local server starts on loopback port 3100 |
| App regressions | 26 passed; 1 separate integration test intentionally skipped in this command |
| Isolated PocketBase integration | 1 passed; migrations, private rules, concurrent claim, ownership, quote replay and budgets |
| Backup, vault sync and retention fixtures | 23 passed; no real Drive or user vault remote contacted |
| HyperFrames/ffmpeg render smoke | Synthetic still plus moving clip; 1080×1920, 24 fps, two seconds, mixed AAC audio; frame-change assertion passes |
| HyperFrames lint | 0 errors, 0 warnings |
| Browser workflows | Script save/approval/revocation, storyboard save/repair, manual publication timestamp, timed quote synchronization and mobile navigation verified |
| Responsive captures | 1440, 390, 1087 and 1280 px; files inspected under .impeccable/review |
| Data cleanup | Disposable episode and synthetic snapshot removed from live data; recoverable copies retained under .runtime |
| Review | Six backend findings resolved; two archive findings resolved; see code-review-verdict.md and retention-review.md |
| Visual finish | `ship` for the supplied Operate scope; reviewed shell, analytics, workbench, shared controls and ten captures |
| Design documentation | Shipped tokens and rules recorded in root DESIGN.md and .impeccable/design.json |

All real account/provider and home-server checks remain separate from local completion. The owner asked to defer deployment. Automatic Flow is a documented upstream integration blocker; Studio does not bypass the plan's retry limit to make an acceptance test pass.
