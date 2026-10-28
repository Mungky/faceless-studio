# Connector setup

Environment fields indicate configuration, not proof of a working integration. Test each connection with its actual account, then record evidence in [ACCEPTANCE.md](ACCEPTANCE.md). Keep daily USD and credit budgets at their default zero until routes and prices are reviewed. No automatic publishing is implemented.

## Google / three YouTube channels

Create a Google Cloud project, enable YouTube Data API v3 and YouTube Analytics API, configure the OAuth consent screen, and create a Web application OAuth client. Set the consent application's publishing status to **In production**; complete any Google verification required for its audience/scopes. External applications left in Testing can have short-lived refresh-token access, so Testing is not the deployment state. See [OAuth production preparation](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) and [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` in the server `.env`. The local callback is exactly `http://127.0.0.1:3100/api/oauth/callback`; add it as an authorized redirect URI if developing with that host. For the server, register the exact HTTPS tailnet callback described in [DEPLOYMENT.md](DEPLOYMENT.md). Keep `OAUTH_ENCRYPTION_KEY` stable and privately backed up.

In Studio Connections, authorize each of the three channels separately. Select the correct Google/Brand account each time and confirm the returned channel ID/title. The requested scopes are only:

```text
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/yt-analytics.readonly
```

No upload or management scope is requested. Verify all three channels are individually connected; one account's token is not evidence for the others. Fetch an owned video's metadata and report, then check views, average view duration/percentage, retention and traffic sources against the same YouTube Studio date range. Reports can be delayed or unavailable for some videos. The connector reports unavailable values explicitly. The requested permissions follow [YouTube Data scopes](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps) and [YouTube Analytics authorization](https://developers.google.com/youtube/analytics/guides/authorization).

For an API 403 after Google consent, use the specific reason in Studio's error: `SERVICE_DISABLED` / `accessNotConfigured` means enable the named API in the same Google Cloud project that owns this OAuth client; `insufficientPermissions` means reconnect and grant both requested read permissions; `quotaExceeded` means check the project's quota. Channel-access reasons ask you to select the correct authorized channel account. Studio parses recognized Google reason codes without reflecting provider response bodies or tokens. After fixing the Google settings, start a fresh Connect flow rather than reloading the old callback URL. See [YouTube API error reasons](https://developers.google.com/youtube/data/reference/rest/v3/errors).

Thumbnail impression CTR and viewed-versus-swiped are supplied through a YouTube Studio CSV supplement, not invented from unrelated API metrics. Export the English table with `Video ID` or `Content` and the relevant columns, then import it against the exact video. Supported percentage headings include `Impressions click-through rate (%)` and `Stayed to watch (%)`. Blank values remain unavailable. A diagnosis requires saved script text and retention data; findings must quote actual saved script excerpts. Editorial/virality scores are model opinions, not measured performance.

Open **Projects** for the connected channel's full analytics and upload calendar. **Refresh profiles** updates banners, avatars and descriptions; project **Sync** refreshes the chosen reporting period and upload history. Cached reads do not call Google. Channel reports use Pacific reporting days; calendar dates use Jakarta time. Public counts exclude private/unlisted videos, while the owner's calendar retains them with visibility labels. Calendar performance is lifetime data, separate from the selected reporting period. See [channel report support](https://developers.google.com/youtube/analytics/channel_reports), [video timestamps and privacy](https://developers.google.com/youtube/data/reference/rest/v3/videos), and the [local verification record](channel-projects-verification.md).

## Drive through rclone

Run `rclone config` interactively on a trusted machine and create a Drive remote such as `studio-drive`. For a headless server, use rclone's documented remote authorization flow on a machine with a browser, then transfer the resulting configuration securely. Do not paste its token into source code. See [rclone Drive setup](https://rclone.org/drive/) and [headless authorization](https://rclone.org/remote_setup/).

Set server `RCLONE_REMOTE=studio-drive:` and the absolute host `RCLONE_CONFIG` path. The server container reads `/rclone/rclone.conf` from `infra/data/rclone`. Ensure UID 1000 can read/write that directory to persist refreshed tokens. Set the laptop's own `RCLONE_CONFIG` to its local file, using the same remote name and intended Drive destination. `infra/rclone.conf.example` is only a shape example and has no authorization.

The media connector writes under `Faceless/<channel>/<episode>/` with subfolders such as `stills`, `clips`, `vo`, `music` and `renders`. The vault contains Markdown/config and links/metadata; large files stay in Drive. Test a small non-sensitive upload/download only when authorized and verify content before a real generation. No upload/download was performed against the user's Drive during implementation.

Backups use a separately explicit `BACKUP_RCLONE_REMOTE`, which must include a dedicated folder. An rclone crypt remote can encrypt those ZIPs before copying to Drive; preserve its keys separately. Use `node scripts/backup.mjs --dry-run` before scheduling its `--run` mode. See [rclone crypt](https://rclone.org/crypt/).

## 9Router and model routes

The supplied Compose service is 9Router on port 20128 with persistent `router_data`. Connect providers in its own dashboard, obtain its API key, then set `NINEROUTER_API_KEY` in the server `.env`. `NINEROUTER_URL` is the OpenAI-compatible base including `/v1`: e.g. `http://127.0.0.1:20128/v1` locally, and automatically `http://ninerouter:20128/v1` inside Compose. The integration uses `GET /models` and `POST /chat/completions` with `stream:false`.

In Studio Models choose an actual returned model for each task (research, script, storyboard, hooks, upload pack and diagnosis). Set max output tokens and the appropriate free/paid billing policy and cost estimate. Provider subscriptions and quotas differ; configure routes and spending caps for the user's accounts. A model advertised as free by an upstream router is not proof of zero cost in the user's configuration. Review 9Router's provider fallback/retry behavior separately, since Studio sends one approved completion request. See [9Router's source/setup](https://github.com/decolua/9router).

## ElevenLabs voiceover

Set server `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and optional `ELEVENLABS_MODEL_ID` (default `eleven_v3`). Enter the actual USD-per-1,000-character estimate in Spending before requesting VO. Review the exact voiceover text and tags in the quote, then approve once. Studio stores the returned master in Drive. A failed request is not automatically retried by Studio; inspect the provider's history before approving another request. Live voice quality, permissions and billing acceptance are pending.

## Flow on the Windows laptop

Flow is the preferred provider, but automatic submission is currently disabled. Review found that the CLI's `maxRetries` value is queue metadata, is removed from the extension's job protocol, and does not bound reconnect replays. A bridge marker or a larger credit reservation cannot prove the plan's one-retry limit. The public [upstream repository](https://github.com/srijan-kaiwart/flow-connector) publishes the skill/docs; its browser extension is distributed separately. A verified extension/dispatch policy is required before enabling automatic paid submissions.

Studio blocks both new Flow quotes and approval of old Flow quotes before reserving spending. The worker does not advertise Flow image/video capabilities, and its generation method also refuses submission. `npm run flow:bridge` explains this restriction without starting a daemon or reclaiming old jobs. A status check only reads an already-running bridge on `FLOW_BRIDGE_PORT` (default 8791).

For now, generate with your existing Flow installation, then use the episode's Assets tab to import the output. Select the image/clip in the storyboard and render through Studio. You can instead configure the alternative webhook described below. No signed-in Flow generation was performed during implementation.

## ACE-Step, rendering and ffmpeg

ACE-Step is a user-managed local music service, usually on the laptop at `ACESTEP_URL=http://127.0.0.1:8001`; set `ACESTEP_API_KEY` if required. The connector expects `POST /release_task`, polls `POST /query_result`, and downloads audio from the same origin's `/v1/audio` route. A different ACE-Step service/version must match that protocol. Local GPU availability and audio results require a live laptop test.

The render adapter uses HyperFrames and local Chrome; `PLAYWRIGHT_CHROME` must point at the installed executable. `FFMPEG_BIN` must name the installed ffmpeg executable. The worker's cache is recovery storage, not the media master. Review a rendered short/long video, verify duration/audio/framing, and confirm Drive upload before treating a queued/done job as production acceptance.

## Replacement image/video webhook

Set server `GENERATOR_WEBHOOK_URL` and `GENERATOR_WEBHOOK_TOKEN`; select the webhook provider and configure its per-image/video USD estimate in Spending. The endpoint receives one authenticated JSON POST:

```json
{
  "idempotency_key": "spend-record-id",
  "kind": "image",
  "prompt": "approved prompt",
  "model": "optional-model",
  "seconds": 5,
  "format": "short"
}
```

Authorization is `Bearer <configured token>`. Fields that are not defined may be omitted; `kind` is `image` or `video`, and `format` is `short` or `long`. Return the media bytes directly with an `image/*` or `video/*` content type, not JSON containing a download URL. The current storage convention uses PNG for images and MP4 for video, so return compatible media. The server times out after five minutes and does not retry. The provider must enforce idempotency itself, and the operator must inspect provider history after an ambiguous timeout. This contract does not send a frame-reference binary; use your existing Flow UI for frame-to-video work, then import the result.

## n8n analytics

Import `infra/n8n/daily-analytics.json` into the private n8n instance. Create an HTTP Header Auth credential with header `Authorization` and value `Bearer <AUTOMATION_TOKEN from server .env>`, attach it to the HTTP request node, and test it manually before activating the workflow. It POSTs to `http://web:3000/api/automation/sync` on the Compose network daily at 06:00 Asia/Jakarta. Import leaves it inactive and contains no credential values. It syncs already connected channels; it does not authorize Google accounts or publish videos. Host backup scheduling is separate, using the supplied systemd timer.
