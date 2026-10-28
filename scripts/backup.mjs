import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentsFor, readSettings, required, studioRoot } from './operations-common.mjs';

const execute = promisify(execFile);

export function backupSettings(settings) {
  let url;
  try { url = new URL(required(settings, 'POCKETBASE_URL')); }
  catch { throw new Error('Set a valid POCKETBASE_URL in .env.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('POCKETBASE_URL must be an HTTP(S) origin without credentials.');
  const remote = required(settings, 'BACKUP_RCLONE_REMOTE').replace(/\/+$/, '');
  if (!/^[a-zA-Z0-9_-]+:[^\r\n]+$/.test(remote) || remote.endsWith(':') || remote.split('/').includes('..')) throw new Error('BACKUP_RCLONE_REMOTE must name a configured rclone remote and a dedicated backup folder.');
  const timeout = Number(settings.BACKUP_TIMEOUT_SECONDS || 600);
  if (!Number.isInteger(timeout) || timeout < 30 || timeout > 7200) throw new Error('BACKUP_TIMEOUT_SECONDS must be 30–7200.');
  return { url: url.origin, email: required(settings, 'PB_ADMIN_EMAIL'), password: required(settings, 'PB_ADMIN_PASSWORD'), remote, directory: path.resolve(studioRoot, settings.BACKUP_LOCAL_DIR || '.backups'), rclone: settings.RCLONE_BIN || 'rclone', rcloneConfig: required(settings, 'RCLONE_CONFIG'), timeout };
}

export async function backup(config, runCopy = execute) {
  // Each step runs once. An ambiguous timeout must be inspected before rerunning.
  const request = async (route, options = {}) => {
    let response;
    try { response = await fetch(`${config.url}${route}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(config.timeout * 1000) }); }
    catch { throw new Error('PocketBase request failed or timed out. Inspect PocketBase backups before retrying; no request was retried.'); }
    if (!response.ok) throw new Error(`PocketBase backup API returned HTTP ${response.status}. No request was retried.`);
    return response;
  };
  const json = async response => {
    try { return await response.json(); }
    catch { throw new Error('PocketBase returned invalid JSON. Response content is withheld.'); }
  };
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(config.directory, '.backup.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('Backup lock exists or is not writable. Confirm no backup is running before removing .backup.lock.'); }
  let destination;
  try {
    await lock.writeFile(String(process.pid));
    const auth = await json(await request('/api/collections/_superusers/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: config.email, password: config.password }) }));
    if (!auth.token) throw new Error('PocketBase did not return a superuser token.');
    const headers = { Authorization: auth.token, 'Content-Type': 'application/json' };
    const name = `studio_${new Date().toISOString().replace(/[^0-9]/g, '')}_${randomUUID().replaceAll('-', '')}.zip`;
    await request('/api/backups', { method: 'POST', headers, body: JSON.stringify({ name }) });
    const deadline = Date.now() + config.timeout * 1000;
    let entry;
    do {
      const list = await json(await request('/api/backups', { headers }));
      if (!Array.isArray(list)) throw new Error('PocketBase returned an invalid backup list.');
      entry = list.find(item => item.key === name && item.size > 0);
      if (entry) break;
      if (Date.now() >= deadline) throw new Error('Backup generation timed out. Inspect PocketBase backups before retrying.');
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (!entry);
    const fileAuth = await json(await request('/api/files/token', { method: 'POST', headers }));
    if (!fileAuth.token) throw new Error('PocketBase did not return a file token.');
    const response = await request(`/api/backups/${encodeURIComponent(name)}?token=${encodeURIComponent(fileAuth.token)}`);
    if (!response.body) throw new Error('PocketBase returned an empty download.');
    destination = path.join(config.directory, name);
    const partial = `${destination}.partial`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    if ((await stat(partial)).size !== entry.size) throw new Error('Backup download size differs from PocketBase. Partial file retained; no upload attempted.');
    await rename(partial, destination);
    try {
      await runCopy(config.rclone, ['copyto', destination, `${config.remote}/${name}`, '--config', config.rcloneConfig, '--immutable', '--retries', '1', '--low-level-retries', '1'], { windowsHide: true, timeout: config.timeout * 1000, maxBuffer: 1024 * 1024 });
    } catch { throw new Error('rclone upload failed. Local ZIP retained in BACKUP_LOCAL_DIR; inspect connectivity/configuration and copy it manually. No backup was deleted.'); }
    console.log('PocketBase ZIP created, downloaded, size checked, and copied to the configured backup folder. Local and PocketBase copies retained.');
    return destination;
  } finally { await lock.close(); await unlink(lockPath); }
}

export async function main(argv = process.argv.slice(2)) {
  const args = argumentsFor(argv, '--run');
  if (args.mode === 'help') return console.log('node scripts/backup.mjs [--dry-run | --run] [--env-file /path/.env]\nDefault: validate configuration only. --run creates/downloads a PocketBase backup and uploads it with rclone.');
  const config = backupSettings(await readSettings(args.envFile));
  if (args.mode !== 'run') return console.log('Backup configuration valid. Dry run: no network requests, files created, or uploads. Use --run to perform the backup.');
  return backup(config);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
