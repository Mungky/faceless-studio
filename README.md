# Faceless Studio

An English production workspace for faceless YouTube channels, with a Linear-inspired interface. Open Arthur, Not Yet or Exhibit Pop as a branded project, or use Add channel. Each project contains channel analytics, video analytics and an upload calendar; Video Details opens the exact upload's full report. Studio opens a Dify-style workflow canvas: choose Arthur, Not Yet or a new template, configure connected agents, and start a persistent production conversation. Review exact outputs and spending estimates before continuing. Existing document, scene and media editors remain available through Production tools. Keep Markdown in the existing Obsidian vault and media masters in Google Drive. The ThinkCentre deployment is prepared and deferred at the owner's request. The Windows laptop handles music and rendering. Publishing stays manual.

## Run locally

Use Node.js 22.16+ (Node 24.13.0 was used during development) and npm. From this directory:

```powershell
npm ci
npm run setup:local
npm run dev:db
```

Keep that terminal open. In another terminal:

```powershell
npm run dev
```

Open [Studio](http://127.0.0.1:3100). Read `STUDIO_OWNER_EMAIL` and `STUDIO_OWNER_PASSWORD` privately from `.env` to log in. `PB_ADMIN_*` is the database account. Setup generates secrets; never paste `.env` into chat or place it in the vault. Existing vault contents are preserved. Check `VAULT_ROOT` before saving an episode.

Start with manual editing and zero spending limits. Connect Drive, 9Router, and each YouTube channel separately before using their features. Generation requires a quote and explicit approval. Configure the actual provider prices and USD/credit limits in Spending; editorial scores are estimates. Automatic Flow submission is disabled pending a verified retry/reconnect policy. Import results from your existing Flow installation, or configure the alternative generator webhook.

For a local production preview, stop any running Studio web process before `npm run build`, then use `npm start`. Windows keeps the standalone server directory locked while it is running. Keep PocketBase running separately.

## Clone on another machine

```powershell
git clone https://github.com/Mungky/faceless-studio.git
cd faceless-studio
npm ci
npm run setup:local
```

The repository is private; clone using a GitHub account with access. Set `VAULT_ROOT` in the generated `.env` to your existing Obsidian vault, including the Arthur and Not Yet playbooks. Then run `npm run dev:db` and `npm run dev` in separate terminals.

Each new installation generates its own local credentials and starts with a fresh database. Existing channel authorizations, production history and provider credentials live outside Git. Restore them through the documented backup/recovery process when moving an installation. Media masters remain in Drive.

Validation commands are `npm run typecheck`, `npm test`, `npm run test:integration` and `npm run build`. Run setup first so the integration tests have the verified native PocketBase binary available.

## Operations

- [Coolify + GitHub App](docs/COOLIFY.md): private deployment, exact build settings, server storage and runtime variables using `compose.coolify.yml`.
- [Deployment](docs/DEPLOYMENT.md): ThinkCentre, Tailscale, Ubuntu, Windows worker, backup and Git sync.
- [Connectors](docs/CONNECTORS.md): Google consent, three read-only channel authorizations, rclone, 9Router, ElevenLabs, Flow and ACE-Step.
- [Acceptance](docs/ACCEPTANCE.md): commands and live checks; external integrations remain pending until tested.
- [Operational verification report](docs/operations-report.md): exact checks and remaining gaps.
- [Clip retention](docs/RETENTION.md): reviewed manifests and recoverable published-plus-30-day clip archiving.
- [Browser verification](docs/ui-verification.md): observed editing, approval, recovery and responsive behavior.
- [Channel projects verification](docs/channel-projects-verification.md): real channel reports, calendar semantics and project navigation.
- [Workflow canvas verification](docs/workflow-canvas-verification.md): templates, production chat, node execution, source-bound approvals and current provider limits.
- [Studio revision verification](docs/studio-revision-verification.md): Add channel, project video analytics, exact-video links and the production board.

Safe default commands:

```powershell
node scripts/backup.mjs --help
node scripts/backup.mjs --dry-run
node scripts/vault-sync.mjs --dry-run
npm run test:operations
node scripts/retention.mjs --help
docker compose --env-file .env -f infra/docker-compose.yml config --quiet
```

Backup dry run needs its new `.env` configuration first. `backup.mjs --run` creates a PocketBase snapshot and copies it to Drive. `vault-sync.mjs --sync` fetches and fast-forwards an already configured clean repository. Neither command initializes the user's vault. Clip retention requires a confirmed publication time and a reviewed manifest; it moves only eligible raw clips into `Faceless/.archive`, preserving final renders and voiceover. Same-Drive archiving is recoverable organization and does not reduce Drive quota.
