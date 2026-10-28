# Deploy through Coolify's GitHub App

This path deploys `Mungky/faceless-studio`, branch `main`, as a Git-based Docker Compose application. Use `compose.coolify.yml` at the repository root. The stack includes the web app and private PocketBase, with persistent database/cache volumes and explicit vault/rclone bind mounts. Text/media providers and the Windows worker are configured separately.

The initial instructions retain private Tailscale access. No server deployment has been performed by the development assistant. The Compose definition has been validated locally; the container build and runtime still need verification on your Coolify server.

## 1. Prepare server storage

In the server's terminal, get its Tailscale IPv4 address:

```sh
tailscale ip -4
```

For a new installation using the example paths:

```sh
sudo install -d -o 1000 -g 1000 -m 0750 /srv/faceless-studio/vault
sudo install -d -o 1000 -g 1000 -m 0700 /srv/faceless-studio/rclone
```

Sync or copy your existing vault to the first directory, retaining `Arthur/Arthur.md`, `Not Yet/Not Yet.md` and `Exhibit Pop/Exhibit Pop.md`. These playbooks and production documents are separate from the app repository. You may use an existing server vault instead: set `SERVER_VAULT_ROOT` to its absolute path and grant container UID/GID 1000 the required read/write access. Do not replace an existing vault with an empty directory.

The rclone folder can remain empty until Drive is configured; later place its private `rclone.conf` inside it. Both bind sources must exist before deployment. `create_host_path: false` prevents a typo silently creating an empty vault.

## 2. Register and install the GitHub App

In Coolify, open **Sources → New source → GitHub App**. Name it, for example, `Faceless Studio`. Use automated registration for GitHub.com; leave Organization empty for the personal `Mungky` account. Preview deployments are unnecessary for this initial setup.

Select **Register with GitHub** (older interfaces may say **Register Now**), create a unique App name on GitHub, and return to Coolify. Select **Install repositories** (or **Install Repositories on GitHub**). On GitHub choose **Only select repositories → Mungky/faceless-studio → Install**. Return and confirm the installation is connected.

If the source is already installed, use its repository-management action and add `faceless-studio` to the selected repository list instead of creating a duplicate App.

For webhook settings enter the Coolify base address, not a `/webhooks` path. GitHub needs a reachable webhook endpoint for automatic deployment. If Coolify is reachable only through Tailscale, repository cloning can still work while automatic push/preview webhooks fail; use the manual **Deploy** button. This guide does not require making the dashboard public.

## 3. Create the application

Open **Projects → your project → Production → + New → Private Repository (with GitHub App)**. Select the server, GitHub App and repository, then **Load Repository**.

| Field | Value |
| --- | --- |
| Repository | `Mungky/faceless-studio` |
| Branch | `main` |
| Build Pack / Build Strategy | `Docker Compose` / `Compose` |
| Base Directory | `/` |
| Docker Compose Location | `/compose.coolify.yml` |
| Install / Build / Start command overrides | Leave empty; Dockerfiles/Compose define them |
| Preview deployments | Off for the initial private installation |

Save and reload/load the Compose definition. Confirm the parsed services are `web` and `pocketbase`. Keep service domains empty for the initial direct Tailscale-port setup. PocketBase needs no public domain or host port.

If using Coolify's HTTPS proxy later, assign a domain only to **web**, with internal target port **3000** (for example, `https://studio.example.com:3000` in the domain input; browser URL `https://studio.example.com`). Set `APP_URL` to the browser URL. Keep the routing reachable only to the intended audience; assigning a public domain is a separate access decision.

## 4. Set environment variables

Open the application's **Environment Variables**. Compose `${VARIABLE}` references expose the corresponding fields there. Set runtime values in Coolify, not in GitHub or Docker build arguments. Substitute your actual server address for `100.x.y.z`:

```dotenv
APP_URL=http://100.x.y.z:3100
STUDIO_BIND_IP=100.x.y.z
STUDIO_HTTP_PORT=3100
SERVER_VAULT_ROOT=/srv/faceless-studio/vault
SERVER_RCLONE_ROOT=/srv/faceless-studio/rclone
PB_ADMIN_EMAIL=admin@studio.local
STUDIO_OWNER_EMAIL=owner@studio.local
```

`STUDIO_BIND_IP` is the Tailscale address returned by `tailscale ip -4`, never a public wildcard address. The safe default is loopback, which cannot be opened directly from the laptop.

Set these required secrets privately:

| Variable | Purpose |
| --- | --- |
| `PB_ADMIN_PASSWORD` | Database superuser password, shared internally by PocketBase and web |
| `STUDIO_OWNER_PASSWORD` | Studio login password created on first database initialization |
| `WORKER_TOKEN` | Shared token for the Windows worker |
| `AUTOMATION_TOKEN` | Token for authorized automation endpoints |
| `OAUTH_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters for stored OAuth credentials |

For a fresh installation you can generate all five in the server terminal:

```sh
for studio_secret in PB_ADMIN_PASSWORD STUDIO_OWNER_PASSWORD WORKER_TOKEN AUTOMATION_TOKEN OAUTH_ENCRYPTION_KEY; do
  printf '%s=' "$studio_secret"
  openssl rand -hex 32
done
```

Store the generated values privately and enter them into Coolify. Do not paste them into chat or commit them. Keep the values stable across redeployments. After database initialization, editing an environment password does not change the saved user's password; use the normal credential-change process instead. When restoring the existing installation, use its original encryption key and follow the recovery procedure rather than initializing or replacing records blindly.

Optional provider variables can remain empty while testing the UI. Add `NINEROUTER_URL` / `NINEROUTER_API_KEY`, Google, ElevenLabs and Drive configuration as needed. `127.0.0.1` inside `web` refers to that container; an existing provider in another Coolify app needs an address reachable from this container, not the server's localhost-only address.

## 5. Deploy and verify

Select **Deploy**, inspect **Deployment Logs**, and verify that both services become healthy. Then open `APP_URL` from a laptop connected to the same tailnet. Log in with `STUDIO_OWNER_EMAIL` and `STUDIO_OWNER_PASSWORD` when prompted.

Verify Projects, Studio → Arthur/Not Yet, node configuration, and creation of an explicitly intended production. A fresh database has channel definitions but no previous channel authorizations or analytics history. Those remain on the original laptop until separately migrated or reconnected. Research correctly blocks until a text provider and model route are configured.

Routine redeployments preserve the named `pb_data` and `web_cache` volumes and the two server directories. Do not remove these volumes when updating. Maintain and verify backups separately; persistent storage itself is not a backup. The private PocketBase service is not published for the host-side manual-stack backup command in DEPLOYMENT.md; arrange a backup path appropriate to this Coolify stack before relying on it for production.

## 6. Add HTTPS before server Google OAuth

Google web OAuth requires an HTTPS callback for a non-localhost server. A private Tailscale HTTPS name can be used without making Studio public.

One option, after confirming the server's Tailscale HTTPS/MagicDNS settings, is to bind the app to loopback and let Tailscale Serve terminate HTTPS:

First run `tailscale serve status`. If the default HTTPS endpoint already serves Coolify or another app, preserve that route and choose a free Serve HTTPS port instead. For example, use `sudo tailscale serve --bg --https=8443 http://127.0.0.1:3100` and include `:8443` in `APP_URL` and the Google redirect URI. The steps below assume the default endpoint is available.

1. Set `STUDIO_BIND_IP=127.0.0.1` and keep `STUDIO_HTTP_PORT=3100`.
2. Set `APP_URL` to the actual HTTPS hostname allocated to this node, such as `https://thinkcentre.<your-tailnet>.ts.net`; redeploy.
3. Configure Tailscale Serve on the server with `sudo tailscale serve --bg http://127.0.0.1:3100`. Inspect `tailscale serve status` for its actual URL and existing Serve routes before changing a configuration already in use.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI=<APP_URL>/api/oauth/callback` in Coolify, then redeploy.
5. Add that exact callback to **Authorized redirect URIs** of the Google OAuth web client; it includes the path. Start channel connection from the new HTTPS app URL.

Keep any existing localhost redirect if still using the laptop instance. If the OAuth client configuration rejects the chosen hostname, resolve that registered-domain configuration before connecting; do not bypass provider validation.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Repository absent | GitHub App installation includes `faceless-studio`; refresh repository list |
| Missing required variable | Fill the highlighted Coolify runtime variable and save |
| Bind source does not exist | Create the exact server vault/rclone directories; use absolute Linux paths |
| Permission denied under `/vault` or `/rclone` | Verify UID/GID 1000 access to the mounted server directory |
| `Cannot assign requested address` | `STUDIO_BIND_IP` must be an address currently assigned to this server |
| App cannot open from laptop | Both devices on Tailscale, correct host port, tailnet access policy and healthy web service |
| Request origin is not allowed | `APP_URL` must equal the actual browser scheme/host/port; redeploy after changing it |
| Login fails after password environment change | Initial credentials live in the persisted database; redeploy does not reset them |
| Missing playbook | Restore the matching vault files at the mounted paths |
| Google rejects redirect | Use the final HTTPS callback, registered exactly under redirect URIs |
| Push does not auto-deploy | GitHub cannot reach a Tailscale-only webhook; use Deploy manually |

References: [GitHub App](https://coolify.io/docs/applications/sources/github/app), [Docker Compose](https://coolify.io/docs/applications/builds/docker-compose), [persistent storage](https://coolify.io/docs/applications/configuration/persistent-storage), [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), [Google redirect URI validation](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).
