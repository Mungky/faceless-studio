# Raw clip retention

`scripts/retention.mjs` archives eligible raw video clips after an episode has been published for at least 30 complete days. The default command creates a local review manifest and moves nothing. Execution requires that manifest explicitly.

The owner must enter the actual publication time in **Upload pack → Publication time (UTC)**. Existing episodes have no assumed publication date. `created`, `updated` and a YouTube video ID never establish publication age. Missing, invalid, future or less-than-30-day publication times are ineligible. Changing an episode away from `published` clears its publication time; enter its actual publication time again if republishing.

## Configuration

Use the server's `.env`, or select a separate file with `--env-file`. Do not put credentials in a manifest or commit them.

```dotenv
POCKETBASE_URL=http://127.0.0.1:8090
PB_ADMIN_EMAIL=owner@example.invalid
PB_ADMIN_PASSWORD=replace-with-your-existing-admin-password
RCLONE_REMOTE=gdrive:
RCLONE_CONFIG=/absolute/path/rclone.conf
RETENTION_ARCHIVE_REMOTE=gdrive:Faceless/.archive
RETENTION_MANIFEST_DIR=.retention
RETENTION_TIMEOUT_SECONDS=120
# Optional: RCLONE_BIN=/absolute/path/rclone
```

`RETENTION_ARCHIVE_REMOTE` must equal `RCLONE_REMOTE` plus `Faceless/.archive`. For example, `RCLONE_REMOTE=gdrive:Studio` requires `RETENTION_ARCHIVE_REMOTE=gdrive:Studio/Faceless/.archive`. Other remotes, roots and archive folders are rejected. Relative manifest directory settings resolve from the `studio` directory.

The reserved `.archive` folder is outside every active channel/episode folder while remaining compatible with the app's `Faceless/` preview paths. **Moving to this folder does not reduce Drive storage usage.** It provides a reversible archive; permanent deletion and migration to cheaper storage are separate owner decisions.

## Review and run

From `studio`:

```powershell
node scripts/retention.mjs --dry-run
# Read the printed retention_<ID>.json before continuing.
node scripts/retention.mjs --run --manifest "D:\Faceless Creation\studio\.retention\retention_<ID>.json"
```

On Linux, pass the absolute path printed by the first command. `--env-file /absolute/path/.env` works in either mode. Omitting `--dry-run` still plans only. `--run` without `--manifest` fails.

Planning authenticates to PocketBase, reads published episodes and their channels/assets, and calls `rclone lsjson` only inside each eligible episode's `Faceless/<channel>/<episode-slug>/clips` folder. Missing clip folders produce no candidates. A new JSON file records the publication time, source path, Drive file ID, byte size, asset references and exact archive destination for each candidate. Existing manifests are never overwritten; files are created read-only and include a SHA-256 integrity check. The check detects corruption, rather than proving who authored a manifest.

Only `.mp4`, `.mov`, `.webm`, `.mkv`, `.avi`, `.m4v`, `.mpeg` and `.mpg` clips are eligible, including safe subfolders beneath `clips`. A file with a matching non-video asset or conflicting Drive ID is skipped. Channel names, episode slugs and all file path segments are validated. Every inventory, stat and move command sets `--drive-skip-shortcuts`, excluding file and folder shortcuts so a link inside `clips` cannot lead into renders, VO or unrelated folders. See [rclone's Drive shortcut behavior](https://rclone.org/drive/#shortcuts). The tool does not inventory `renders`, `vo`, the vault or unrelated Drive folders.

Planning skips clips referenced by any queued or running job, including jobs for other episodes. It checks frozen Drive paths, Drive file IDs and asset IDs throughout job payloads, covering render assets, image/video references and storyboard beats. Completed, failed and cancelled jobs do not block retention.

Execution validates every candidate before its first move and again immediately before each move. It requires the episode still to be `published`, its exact stored publication time/channel/slug to match, asset references to match, and source path, Drive ID and size to match. After remote file checks it reads the global queued/running job list again; a referencing job stops the run. A changed record or existing destination also stops the run. It never expands a reviewed manifest to include newly discovered files. Avoid creating jobs while an archive run is in progress: PocketBase and Drive cannot lock job creation and file moves in one transaction.

Each clip moves individually with `rclone moveto --immutable` to:

```text
Faceless/.archive/<episode-ID>/<manifest-ID>/<relative-clip-path>
```

After verifying the destination ID/size and the source's absence, the tool updates matching assets with the archived `drive_path` and file ID, sets `selected=false`, and adds `meta.retention` containing the original path/ID, publication time, manifest ID and archive time. Existing metadata is preserved. Archived clips can still be previewed through the normal asset preview route. Do not reselect them for an active render until deliberately restoring them.

No `delete`, `purge`, directory move, `sync` or permanent deletion command is used. Final renders and VO remain in their existing folders. The [rclone moveto documentation](https://rclone.org/commands/rclone_moveto/) describes successful moves removing the source, and [the immutable option](https://rclone.org/docs/#immutable) prevents modifying existing destination files. The tool additionally refuses any existing destination before moving.

## Interrupted or failed execution

Keep the manifest and its `retention_<ID>.run-<ID>.jsonl` report. The report is flushed before each move, after verification and after each asset update. It contains the original asset records and recovery paths. Commands are not automatically retried. The local `.retention.lock` prevents concurrent executions using the same manifest directory; remove a leftover lock only after verifying no retention process is running and reviewing its report.

Drive moves and PocketBase updates cannot form one transaction. A network failure after a move can leave an asset's database path awaiting repair. Stop and inspect the report before creating another plan:

1. Find the last `moving`, `moved` and `asset_updated` events. Check both recorded paths using `rclone lsjson <remote:path> --stat --drive-skip-shortcuts --config <config>` and compare file ID/size with the manifest.
2. If the verified file is archived, repair each outstanding asset through PocketBase admin: use the report's archived path/ID, set `selected=false`, preserve its existing metadata and add the recorded retention details. A destination ID may differ from the original if rclone had to copy the file.
3. If restoring instead, ensure the original path is absent, move the one archived file back with `moveto --immutable --drive-skip-shortcuts`, verify it, then restore the affected asset records from `original_assets`. Never overwrite a replacement clip or replay the entire manifest to recover one file.
4. If both paths exist, neither exists, IDs/sizes differ or a move timed out, resolve that ambiguity first. No automatic rollback or retry is attempted.

Do not schedule `--run` unattended. A scheduler may run the planning command to produce manifests for owner review. Protect `.retention` with the same private filesystem access as application backups; its reports contain local asset metadata.

## Local verification

```text
node --check scripts/retention.mjs
node --check scripts/test-retention.mjs
node --test scripts/test-retention.mjs
```

The test suite uses a disposable localhost PocketBase fixture and an in-memory rclone command double. It covers age/date boundaries, path spoofing, state changes, source identity, archive collisions, asset updates and recovery reports. It makes no real Drive requests or moves. Actual Drive acceptance remains an external setup check.
