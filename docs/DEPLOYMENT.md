# Deployment and recovery

## Machine split

The confirmed home server is a ThinkCentre with a seventh-generation Intel i7 and 16 GB RAM. It runs Zorin now and will move to headless Ubuntu Server later. Docker and Tailscale are already installed there. Run PocketBase, Studio, n8n and 9Router on that server. Keep GPU work and the signed-in visible Flow browser on the Windows laptop. No server deployment or Docker startup was performed during implementation; server access was not provided and the local Docker daemon is stopped.

Use one writer per vault document at a time. Obsidian Git is the chosen vault transport. Google Drive holds large media; the app's database records asset paths and production state. A database backup does not replace the vault, Drive media, n8n state, 9Router state, or encryption-key backup.

## Local development

From `studio/`, run `npm ci`, then `npm run setup:local`. Keep `npm run dev:db` running in one terminal and `npm run dev` in another. The web app listens on `127.0.0.1:3100`; native development PocketBase uses `127.0.0.1:8095`. Login credentials are `STUDIO_OWNER_EMAIL` / `STUDIO_OWNER_PASSWORD` in `.env`. Keep generated credentials private. Check `VAULT_ROOT` points to the intended existing vault before creating or editing content.

`npm run typecheck`, `npm test`, `npm run test:integration`, and `npm run build` cover the app; the integration command uses an isolated database. Operational checks are described in [ACCEPTANCE.md](ACCEPTANCE.md). Do not run paid generation as part of a build or health check.

## Prepare the server

Use a server checkout or copied release at `/opt/faceless-studio` and a dedicated account such as `studio`. Install Node.js 22.16+ and rclone on the host for operational scripts; Compose itself does not provide a host Node runtime. Do not copy a Windows `node_modules` directory to Ubuntu: run `npm ci` on the target. The scripts load settings from the selected `.env` file and do not take secrets on command lines.

Create a server-specific `.env` from `.env.example`, generate fresh server secrets with `npm run setup:local`, and transfer only the necessary worker token to the laptop. Preserve `OAUTH_ENCRYPTION_KEY` and `N8N_ENCRYPTION_KEY` in a password manager: replacing either can make saved credentials unreadable. Restrict `.env` and rclone configuration to the service account (`chmod 600` for files, `700` for their directories). Never commit secrets or database ZIPs.

Set these server values privately:

| Setting | Server value / purpose |
| --- | --- |
| `TAILSCALE_IP` | Actual IPv4 shown by `tailscale ip -4`; never `0.0.0.0` |
| `APP_URL` | Browser-visible Studio URL, including port if needed |
| `SERVER_VAULT_ROOT` | Prefer the absolute path of the existing server vault, e.g. `/srv/obsidian-vault` |
| `VAULT_ROOT` | Same host path for host Git operations; Compose overrides app path to `/vault` |
| `POCKETBASE_URL` | `http://127.0.0.1:8090` if PB is bound to loopback, or `http://<server-tailscale-ip>:8090` if bound there; host backup must use a reachable address |
| `RCLONE_REMOTE` | Authorized media remote, e.g. `studio-drive:` |
| `RCLONE_CONFIG` | Absolute host path, e.g. `/opt/faceless-studio/infra/data/rclone/rclone.conf` |
| `BACKUP_RCLONE_REMOTE` | Dedicated backup folder, e.g. `studio-backups:Faceless-Studio-Backups`; an rclone crypt remote is recommended for encrypted storage |
| `BACKUP_LOCAL_DIR` | Local ZIP directory outside the vault; default `.backups` under Studio |
| `VAULT_GIT_ROOT` | Actual existing Git vault root; falls back to `VAULT_ROOT` |

Compose paths are relative to `infra/docker-compose.yml`. Thus `SERVER_VAULT_ROOT=../../projects` reaches this workspace's `projects/` sibling; `../projects` would instead reach `studio/projects`. The example was corrected, but an existing generated `.env` is intentionally preserved: review its value before deployment. A Windows path is not a valid Ubuntu vault location. Ensure the bind source exists so a typo cannot silently create an empty vault directory, and grant the app's UID 1000 write access to the chosen vault and rclone directory.

Authorize rclone as in [CONNECTORS.md](CONNECTORS.md). Place the server configuration at `infra/data/rclone/rclone.conf`. Compose mounts that directory at `/rclone`; its internal config path and binary are set automatically. The mount is writable so refreshed Google tokens can be saved. The host backup uses the host path in `.env`. Media remote names must exist in both server and laptop configurations.

Validate first without displaying interpolated secrets:

```sh
docker compose --env-file .env -f infra/docker-compose.yml config --quiet
```

When ready on the server, the operator can run:

```sh
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

This command was not run here. Check health and logs privately; do not paste environment dumps. Named volumes preserve PocketBase, n8n, router state and cache. Never use `down -v` during a routine update. Back up before updating image pins or migrations.

## Tailscale access and Google callback

Compose publishes ports 3000, 8090, 5678 and 20128 only on `TAILSCALE_IP`, defaulting to loopback. `HOSTNAME=0.0.0.0` inside a container is necessary for container networking; host publishing remains restricted. Limit access with tailnet ACLs and do not forward these ports from the public router.

Google permits localhost redirects for development; the headless deployment needs a registered HTTPS callback. Use a Tailscale HTTPS name and Serve (configured by the operator), or an HTTPS reverse proxy available only to the tailnet. With Tailscale Serve terminating HTTPS, keep the web host binding on loopback and configure Serve to proxy to `http://127.0.0.1:3000`; choose separate per-service loopback/Compose overrides as needed. Set `APP_URL` and `GOOGLE_REDIRECT_URI` to that exact HTTPS URL and `/api/oauth/callback`. Do not use Funnel/public forwarding for this app. See [Google redirect validation](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation) and [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve).

n8n currently allows HTTP cookies for private development (`N8N_SECURE_COOKIE=false`). If you put n8n behind an HTTPS proxy, set secure cookies to true and configure its own host/protocol/webhook URL according to its deployment docs. It has a separate owner login and encryption key.

## Windows worker

Keep a separate laptop installation and its own private `.env`; do not copy the server's whole `.env`. Required laptop settings include `WORKER_SERVER_URL` (server tailnet URL), matching `WORKER_TOKEN`, unique `WORKER_ID`, `WORKER_CAPABILITIES`, `WORKER_CACHE_ROOT`, and authorized `RCLONE_REMOTE` / local `RCLONE_CONFIG`. Add `FLOW_BRIDGE_PORT`, `FLOW_DOWNLOAD_ROOT`, `ACESTEP_URL`, optional `ACESTEP_API_KEY`, `FFMPEG_BIN` and `PLAYWRIGHT_CHROME` for the configured capabilities. Flow automation is disabled pending a verified retry/reconnect policy; see [CONNECTORS.md](CONNECTORS.md). The laptop does not need PocketBase admin credentials or Google's client secret merely to poll jobs.

Run `npm ci`, ensure ffmpeg and the renderer's Chrome are installed, then `npm run worker`. Leave Windows signed in and Flow visible in its authorized browser. Advertise only capabilities you can actually run. The worker polls the server, sends heartbeats every 15 seconds, and performs one local job at a time. A failed job retains recovery cache and is not automatically resubmitted by Studio.

`infra/install-worker.ps1` optionally registers an interactive at-logon task. Inspect and invoke it manually only after a foreground worker run succeeds. It uses the laptop installation's `.env`. `-Remove` removes that task. No task or system service was installed during implementation. Flow cannot run in a headless Ubuntu service.

## PocketBase backup and daily schedule

The host CLI follows the [authenticated PocketBase backup API](https://pocketbase.io/docs/api-backups/): authenticate the superuser, create a uniquely named backup, wait for it in the backup list, obtain a file token, download the generated ZIP, compare its byte count, then invoke `rclone copyto --immutable`. It never copies a running SQLite file. API response bodies, passwords, bearer tokens and rclone output are not logged. No backup is deleted automatically.

```sh
node scripts/backup.mjs --dry-run
node scripts/backup.mjs --run
```

The first command validates `.env` only, with no network or file creation. The second performs real backup and remote upload. An alternate private settings file is supported with `--env-file /path/.env`. `BACKUP_TIMEOUT_SECONDS` defaults to 600 per request/copy step. Local ZIPs and PocketBase backups remain after success; an upload failure keeps the complete ZIP for manual retry. Partial downloads are retained with `.partial`. A lock prevents overlapping host runs; after a crash, confirm no process is running before removing `.backup.lock` from the backup directory. Inspect PocketBase's backup list after an ambiguous timeout before submitting another backup.

The systemd templates in `infra/systemd/` schedule 02:00 Asia/Jakarta daily with up to five minutes of delay and catch-up after downtime. They require an existing `studio` account, `/opt/faceless-studio`, `/usr/bin/node`, correct ownership, a reachable host PocketBase URL, and a preconfigured rclone remote. Adjust those paths/account in the templates for your server. After a successful manual backup, copy the reviewed service and timer into `/etc/systemd/system/` and run `sudo systemctl daemon-reload`. The single activation command is:

```sh
sudo systemctl enable --now faceless-studio-backup.timer
```

Inspect `systemctl list-timers faceless-studio-backup.timer`, `systemctl status faceless-studio-backup.service`, and `journalctl -u faceless-studio-backup.service` privately. Disable with `sudo systemctl disable --now faceless-studio-backup.timer`. This host schedule works without a desktop or n8n Execute Command node. Templates were supplied; no system service was installed here.

PocketBase ZIPs include application records and locally stored files, excluding the backup directory and external S3 files. They contain sensitive state. Store them with restricted Drive access, preferably through an rclone crypt remote whose keys are backed up separately. Rotate old backups only after a successful restore drill and an agreed policy. Separately export/back up n8n credentials/workflows with its encryption key, 9Router configuration/state, the private vault remote, and Drive media. These extra state backups and remote retention are not automated by this CLI.

For a restore drill, download one ZIP, verify its hash against the retained local copy, and restore it to a disposable isolated PocketBase instance using the same application version and migrations/hooks. Verify login, channel records and sample documents before considering a production restore. Restoring via PocketBase restarts its process. Stop writers and take a fresh recovery copy before a production restore; no restore was performed here. See [PocketBase production backup behavior](https://pocketbase.io/docs/going-to-production/).

## Existing Obsidian vault and private Git sync

The tool never initializes a repository, adds a remote, stages files, creates commits, stashes changes, rebases, force-pushes, or resets. Set `VAULT_GIT_ROOT` to the actual existing vault repository. Confirm the remote is private in the hosting service yourself; a local Git URL does not prove repository visibility. Use an SSH key or OS credential helper, not a token embedded in a remote URL or Markdown.

On the laptop, install Obsidian Git in the existing vault, enable it, and use the already configured private remote. Review its commit/sync interval and pull-on-startup settings. Let it commit intended Markdown and configuration changes before the server syncs; avoid simultaneous edits. Keep `.obsidian/workspace*.json` and machine-specific plugin files ignored if they cause conflicts. Keep only notes/configuration in Git: media, caches, `.env`, token files, rclone configuration and database ZIPs belong elsewhere. Review the existing vault's ignore rules manually; adding an ignore pattern does not remove a file already tracked or purge history.

For a headless server, configure the same existing private remote and tracking branch in the existing server vault through your normal setup. Run as the vault owner:

```sh
node scripts/vault-sync.mjs --dry-run
node scripts/vault-sync.mjs --sync
```

Dry run reads the repository only. `--sync` fetches without interactive credential prompts and permits only a clean fast-forward merge or a normal push of existing local commits. A timer or cron may run that explicit command under the vault owner once manually verified. For server-authored Markdown, first review and commit the intended files manually over SSH; the tool deliberately stops on dirty files. Set up credential access for that service account before scheduling. Do not run two competing automatic Git sync tools on the same checkout.

Recovery messages stop before destructive changes:

- Dirty/conflicting vault: inspect `git status` in the actual vault, save copies of conflicting notes, resolve deliberately, and commit intended files. No automatic stash is made.
- Divergence: inspect `git log --graph --oneline --all`, compare note changes, then merge or rebase manually with backups. Do not reset or force-push to silence the tool.
- Existing merge/rebase/cherry-pick or index lock: finish or abort the operation manually. Remove a stale lock only after confirming its process is gone.
- Tracked media/secrets: preserve originals in Drive/private storage, review untracking and ignore rules, and handle any secret rotation/history cleanup separately.
- Fetch/push failure: check SSH key/credential helper, remote availability and upstream branch manually. Git output is withheld by the CLI to avoid leaking credentials.

The file policy admits Markdown, JSON/YAML/TOML/INI configuration, Obsidian canvas/base files and standard Git/editor config names. It rejects media and obvious secret filenames locally and before fast-forwarding incoming remote content. This filename policy is not a content-based secret scanner; review config contents before committing. A sync lock sits in the repository's Git directory; inspect running processes before removing a stale `studio-vault-sync.lock`.

## Clip retention

Published-plus-30-day raw-clip cleanup is **pending**. There is no deletion job, Drive cleanup, or vault cleanup installed. The current production model does not provide a verified immutable publication timestamp and reviewed per-file deletion manifest. Until that exists, all media is retained. Final renders and voiceover must remain preserved permanently under this policy.

A future cleanup must first produce a read-only candidate manifest with exact asset IDs/Drive paths, actual publication timestamp, age, checksum/size, kind, backup status and a reason. Exclude final renders, voiceover, currently selected/reused assets and unknown provenance. Require a separate reviewed execution step with recovery before deleting anything. Changing an episode's status alone must never trigger deletion.
