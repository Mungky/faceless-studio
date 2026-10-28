import { mkdir, open, readFile, lstat, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings, required, studioRoot } from './operations-common.mjs';

const execute = promisify(execFile);
const age = 30 * 24 * 60 * 60 * 1000;
const idPattern = /^[a-zA-Z0-9]{15}$/;
const manifestPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const videoExtension = /\.(mp4|mov|webm|mkv|avi|m4v|mpeg|mpg)$/i;

function segment(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 120 && value !== '.' && value !== '..' && !/[\\/:\x00-\x1f\x7f]/.test(value) && !/[. ]$/.test(value);
}
function relative(value) { return typeof value === 'string' && value.split('/').every(segment); }
function remote(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+:/.test(value)) throw new Error('Use a configured rclone remote, optionally with a folder.');
  const normalized = value.replace(/\/+$/, '');
  const folder = normalized.slice(normalized.indexOf(':') + 1);
  if (folder && !relative(folder)) throw new Error('Invalid rclone remote folder.');
  return normalized;
}
function target(root, value) { return root + (root.endsWith(':') ? '' : '/') + value; }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const normalized = value.replace(' ', 'T').replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
  const time = Date.parse(normalized);
  return Number.isFinite(time) && new Date(time).toISOString() === normalized ? time : NaN;
}
export function eligible(episode, now = Date.now()) {
  const published = timestamp(episode.published_at);
  return episode.status === 'published' && Number.isFinite(published) && published <= now - age;
}

export function retentionSettings(settings) {
  let url;
  try { url = new URL(required(settings, 'POCKETBASE_URL')); }
  catch { throw new Error('Set a valid POCKETBASE_URL in .env.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('POCKETBASE_URL must be an HTTP(S) origin without credentials.');
  const source = remote(required(settings, 'RCLONE_REMOTE'));
  const archive = remote(required(settings, 'RETENTION_ARCHIVE_REMOTE'));
  if (archive !== target(source, 'Faceless/.archive')) throw new Error('RETENTION_ARCHIVE_REMOTE must be exactly RCLONE_REMOTE plus Faceless/.archive.');
  const timeout = Number(settings.RETENTION_TIMEOUT_SECONDS || 120);
  if (!Number.isInteger(timeout) || timeout < 30 || timeout > 7200) throw new Error('RETENTION_TIMEOUT_SECONDS must be 30–7200.');
  return { url: url.origin, email: required(settings, 'PB_ADMIN_EMAIL'), password: required(settings, 'PB_ADMIN_PASSWORD'), source, archive, directory: path.resolve(studioRoot, settings.RETENTION_MANIFEST_DIR || '.retention'), rclone: settings.RCLONE_BIN || 'rclone', rcloneConfig: required(settings, 'RCLONE_CONFIG'), timeout };
}

export function retentionArguments(argv) {
  const args = { mode: 'plan', envFile: path.join(studioRoot, '.env'), manifest: '' };
  if (argv.includes('--help')) return { ...args, mode: 'help' };
  let modeSeen = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env-file' && argv[i + 1] && !argv[i + 1].startsWith('--')) args.envFile = path.resolve(argv[++i]);
    else if (argv[i] === '--manifest' && !args.manifest && argv[i + 1] && !argv[i + 1].startsWith('--')) args.manifest = path.resolve(argv[++i]);
    else if (['--dry-run', '--run'].includes(argv[i]) && !modeSeen) { modeSeen = true; args.mode = argv[i] === '--run' ? 'run' : 'plan'; }
    else throw new Error('Unknown or conflicting arguments. Use --help.');
  }
  if ((args.mode === 'run') !== Boolean(args.manifest)) throw new Error('--run requires --manifest; a manifest is accepted only with --run.');
  return args;
}

async function client(config) {
  let token = '';
  const request = async (route, options = {}) => {
    let response;
    try {
      response = await fetch(`${config.url}/api/collections/${route}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, redirect: 'error', signal: AbortSignal.timeout(config.timeout * 1000) });
    } catch { throw new Error('PocketBase request failed or timed out. No request was retried.'); }
    if (!response.ok) throw new Error(`PocketBase retention API returned HTTP ${response.status}. No request was retried.`);
    try { return await response.json(); } catch { throw new Error('PocketBase returned invalid JSON. Response content is withheld.'); }
  };
  const auth = await request('_superusers/auth-with-password', { method: 'POST', body: JSON.stringify({ identity: config.email, password: config.password }) });
  if (!auth.token || typeof auth.token !== 'string') throw new Error('PocketBase did not return a superuser token.');
  token = auth.token;
  return {
    get: (collection, id) => { if (!idPattern.test(id)) throw new Error('Invalid record ID.'); return request(`${collection}/records/${id}`); },
    patch: (id, data) => request(`assets/records/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    async list(collection, filter) {
      const records = [];
      for (let page = 1; page <= 1000; page++) {
        const query = new URLSearchParams({ page: String(page), perPage: '500', filter });
        const result = await request(`${collection}/records?${query}`);
        if (!Array.isArray(result.items) || !Number.isInteger(result.totalPages) || result.totalPages < 0) throw new Error('PocketBase returned an invalid record list.');
        records.push(...result.items);
        if (page >= result.totalPages) return records;
      }
      throw new Error('PocketBase record list exceeds the retention limit.');
    }
  };
}

function commands(config, runCommand) {
  const run = async args => {
    // A clips folder shortcut may point at protected renders or unrelated files.
    // Apply this to inventory, stat and move so reviewed paths cannot dereference it.
    try { return await runCommand(config.rclone, [...args, '--drive-skip-shortcuts', '--config', config.rcloneConfig, '--retries', '1', '--low-level-retries', '1'], { windowsHide: true, timeout: config.timeout * 1000, maxBuffer: 16 * 1024 * 1024 }); }
    catch (error) { const safe = new Error('rclone retention command failed or timed out. Inspect the retained manifest/report before retrying.'); safe.code = error.code; throw safe; }
  };
  const json = result => {
    try { return JSON.parse(typeof result === 'string' ? result : result.stdout); }
    catch { throw new Error('rclone returned invalid JSON. Response content is withheld.'); }
  };
  return {
    async list(value) {
      try { return json(await run(['lsjson', value, '--recursive', '--files-only'])); }
      catch (error) { if ([3, 4].includes(error.code)) return []; throw error; }
    },
    async stat(value, absentAllowed = false) {
      try { return json(await run(['lsjson', value, '--stat'])); }
      catch (error) { if (absentAllowed && [3, 4].includes(error.code)) return null; throw error; }
    },
    move: (source, destination) => run(['moveto', source, destination, '--immutable'])
  };
}
function fileIdentity(file, name) {
  return file && file.IsDir === false && file.Name === name && file.Path === name && typeof file.ID === 'string' && file.ID.length > 0 && Number.isSafeInteger(file.Size) && file.Size >= 0;
}
function assetRefs(assets, source) {
  return assets.filter(asset => asset.drive_path === source).map(asset => ({ id: asset.id, drive_file_id: asset.drive_file_id || '', kind: asset.kind })).sort((a, b) => a.id.localeCompare(b.id));
}
function validRefs(refs, fileId) { return refs.every(asset => idPattern.test(asset.id) && asset.kind === 'video' && (!asset.drive_file_id || asset.drive_file_id === fileId)); }
const activeJobFilter = 'status="queued" || status="running"';
function jobReferencesClip(job, file, sourceRemote) {
  if (!['queued', 'running'].includes(job.status)) return false;
  // Frozen worker payloads can refer to paths or asset IDs in assets, reference,
  // and storyboard image/video fields, including jobs belonging to other episodes.
  const identities = new Set([file.source_path, target(sourceRemote, file.source_path), file.file_id, ...file.assets.map(asset => asset.id)]);
  const pending = [job.payload, job.result_asset];
  let visited = 0;
  while (pending.length) {
    if (++visited > 100000) throw new Error('Active job payload exceeds the retention inspection limit.');
    const value = pending.pop();
    if (typeof value === 'string' && identities.has(value)) return true;
    if (value && typeof value === 'object') pending.push(...Object.values(value));
  }
  return false;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function exclusiveJson(file, value) {
  const handle = await open(file, 'wx', 0o400);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
}

/** Read-only remote inventory; the only write is a new local, never-overwritten manifest. */
export async function planRetention(config, runCommand = execute, now = Date.now()) {
  const db = await client(config), rclone = commands(config, runCommand);
  const manifest = { version: 1, id: randomUUID(), created_at: new Date(now).toISOString(), minimum_age_days: 30, pocketbase_url: config.url, source_remote: config.source, archive_remote: config.archive, files: [], skipped: [] };
  const episodes = await db.list('episodes', 'status="published"');
  const activeJobs = await db.list('jobs', activeJobFilter);
  for (const episode of episodes) {
    if (!idPattern.test(episode.id) || !idPattern.test(episode.channel)) throw new Error('PocketBase returned an invalid episode ID.');
    if (!eligible(episode, now)) { manifest.skipped.push({ episode: episode.id, reason: 'Not published for 30 days with a valid explicit UTC publication time.' }); continue; }
    const channel = await db.get('channels', episode.channel);
    if (!segment(channel.name) || channel.name.toLowerCase() === '.archive' || !segment(episode.slug)) throw new Error('Unsafe channel name or episode slug; no manifest was written.');
    const root = `Faceless/${channel.name}/${episode.slug}/clips`;
    const assets = await db.list('assets', `episode="${episode.id}"`);
    const files = await rclone.list(target(config.source, root));
    if (!Array.isArray(files)) throw new Error('rclone returned an invalid file list.');
    const seen = new Set(), seenIds = new Set();
    for (const file of files) {
      if (!relative(file.Path) || file.Name !== file.Path.split('/').at(-1) || file.IsDir !== false || !fileIdentity({ ...file, Path: file.Name }, file.Name)) throw new Error('Unsafe or incomplete rclone file identity; no manifest was written.');
      if (seen.has(file.Path) || seenIds.has(file.ID)) throw new Error('Duplicate Drive paths or IDs require manual review.');
      seen.add(file.Path); seenIds.add(file.ID);
      const source = `${root}/${file.Path}`, refs = assetRefs(assets, source);
      if (!videoExtension.test(file.Name) || !validRefs(refs, file.ID)) { manifest.skipped.push({ episode: episode.id, path: source, reason: 'Only raw video clips with consistent video asset references are eligible.' }); continue; }
      const candidate = { episode: episode.id, channel: episode.channel, channel_name: channel.name, slug: episode.slug, published_at: episode.published_at, relative_clip: file.Path, source_path: source, archive_path: `Faceless/.archive/${episode.id}/${manifest.id}/${file.Path}`, size: file.Size, file_id: file.ID, assets: refs };
      if (activeJobs.some(job => jobReferencesClip(job, candidate, config.source))) { manifest.skipped.push({ episode: episode.id, path: source, reason: 'Referenced by a queued or running job.' }); continue; }
      manifest.files.push(candidate);
    }
  }
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const file = path.join(config.directory, `retention_${manifest.id}.json`);
  await exclusiveJson(file, { ...manifest, sha256: digest(manifest) });
  return { file, manifest };
}

function validateManifest(config, value, now) {
  const { sha256, ...manifest } = value;
  if (sha256 !== digest(manifest) || manifest.version !== 1 || !manifestPattern.test(manifest.id) || manifest.minimum_age_days !== 30 || manifest.pocketbase_url !== config.url || manifest.source_remote !== config.source || manifest.archive_remote !== config.archive || !Number.isFinite(timestamp(manifest.created_at)) || timestamp(manifest.created_at) > now || !Array.isArray(manifest.files) || manifest.files.length > 10000) throw new Error('Manifest integrity, configuration or format differs. Create a fresh dry run.');
  const sources = new Set();
  for (const file of manifest.files) {
    const root = `Faceless/${file.channel_name}/${file.slug}/clips`;
    if (!idPattern.test(file.episode) || !idPattern.test(file.channel) || !segment(file.channel_name) || file.channel_name.toLowerCase() === '.archive' || !segment(file.slug) || !eligible({ status: 'published', published_at: file.published_at }, now) || !relative(file.relative_clip) || !videoExtension.test(file.relative_clip) || file.source_path !== `${root}/${file.relative_clip}` || file.archive_path !== `Faceless/.archive/${file.episode}/${manifest.id}/${file.relative_clip}` || typeof file.file_id !== 'string' || !file.file_id || !Number.isSafeInteger(file.size) || file.size < 0 || !Array.isArray(file.assets) || !validRefs(file.assets, file.file_id) || sources.has(file.source_path)) throw new Error('Unsafe manifest entry. Create a fresh dry run.');
    sources.add(file.source_path);
  }
  return manifest;
}

/** Explicit per-file archive; no permanent deletion, directory moves, purge or sync. */
export async function runRetention(config, manifestFile, runCommand = execute, now = Date.now()) {
  const resolved = path.resolve(manifestFile);
  if (path.dirname(resolved) !== path.resolve(config.directory) || !(await lstat(resolved)).isFile() || (await lstat(resolved)).size > 16 * 1024 * 1024) throw new Error('Choose a regular manifest file directly inside RETENTION_MANIFEST_DIR.');
  const manifest = validateManifest(config, JSON.parse(await readFile(resolved, 'utf8')), now);
  if (path.basename(resolved) !== `retention_${manifest.id}.json`) throw new Error('Manifest filename does not match its ID.');
  const lockPath = path.join(config.directory, '.retention.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('Retention lock exists. Confirm no run is active and inspect its report before removing .retention.lock.'); }
  const reportFile = path.join(config.directory, `retention_${manifest.id}.run-${randomUUID()}.jsonl`);
  let report;
  try {
    await lock.writeFile(String(process.pid));
    report = await open(reportFile, 'wx', 0o600);
    const record = async entry => { await report.writeFile(JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); await report.sync(); };
    const db = await client(config), rclone = commands(config, runCommand);
    const revalidate = async file => {
      const episode = await db.get('episodes', file.episode), channel = await db.get('channels', file.channel);
      if (!eligible(episode, now) || episode.published_at !== file.published_at || episode.channel !== file.channel || episode.slug !== file.slug || channel.name !== file.channel_name) throw new Error('Episode publication state or path changed; create a fresh dry run.');
      const assets = await db.list('assets', `episode="${file.episode}"`);
      if (JSON.stringify(assetRefs(assets, file.source_path)) !== JSON.stringify(file.assets)) throw new Error('Asset references changed; create a fresh dry run.');
      const source = await rclone.stat(target(config.source, file.source_path));
      if (!fileIdentity(source, file.relative_clip.split('/').at(-1)) || source.ID !== file.file_id || source.Size !== file.size) throw new Error('Source clip path, size or Drive ID changed; create a fresh dry run.');
      if (await rclone.stat(target(config.source, file.archive_path), true)) throw new Error('Archive destination already exists. Inspect the prior run report; do not overwrite it.');
      // Check last, after remote stats, so a job queued during preflight is caught.
      const activeJobs = await db.list('jobs', activeJobFilter);
      if (activeJobs.some(job => jobReferencesClip(job, file, config.source))) throw new Error('Clip is referenced by a queued or running job; wait for completion and create a fresh dry run.');
      return assets.filter(asset => file.assets.some(ref => ref.id === asset.id));
    };
    // Validate every entry before the first move, then recheck immediately before each move.
    for (const file of manifest.files) await revalidate(file);
    await record({ event: 'started', manifest: path.basename(resolved), count: manifest.files.length });
    for (const file of manifest.files) {
      const assets = await revalidate(file);
      await record({ event: 'moving', file, original_assets: assets });
      await rclone.move(target(config.source, file.source_path), target(config.source, file.archive_path));
      const archived = await rclone.stat(target(config.source, file.archive_path));
      if (!fileIdentity(archived, file.relative_clip.split('/').at(-1)) || archived.Size !== file.size) throw new Error('Moved clip identity could not be verified. Inspect the run report before any retry.');
      if (await rclone.stat(target(config.source, file.source_path), true)) throw new Error('Source still exists after the archive move. Inspect both locations before retrying.');
      await record({ event: 'moved', source_path: file.source_path, archive_path: file.archive_path, file_id: archived.ID, size: archived.Size });
      for (const asset of assets) {
        await db.patch(asset.id, { drive_path: file.archive_path, drive_file_id: archived.ID, selected: false, meta: { ...asset.meta, retention: { original_path: file.source_path, original_file_id: file.file_id, published_at: file.published_at, manifest_id: manifest.id, archived_at: new Date().toISOString() } } });
        await record({ event: 'asset_updated', asset: asset.id, archive_path: file.archive_path });
      }
    }
    await record({ event: 'complete', count: manifest.files.length });
    return { reportFile, count: manifest.files.length };
  } catch (error) {
    if (report) { await report.writeFile(JSON.stringify({ event: 'failed', message: error.message }) + '\n'); await report.sync(); }
    throw new Error(`${error.message} Retention stopped; inspect ${reportFile}. A moved file may require metadata recovery before another run.`);
  } finally { if (report) await report.close(); await lock.close(); await unlink(lockPath); }
}

export async function main(argv = process.argv.slice(2)) {
  const args = retentionArguments(argv);
  if (args.mode === 'help') return console.log('node scripts/retention.mjs [--dry-run | --run --manifest /path/retention_ID.json] [--env-file /path/.env]\nDefault: read PocketBase and clips inventory, write a local manifest, move nothing. --run revalidates and archives only that manifest.');
  const config = retentionSettings(await readSettings(args.envFile));
  if (args.mode === 'run') { const result = await runRetention(config, args.manifest); console.log(`Archived ${result.count} raw clips. Report: ${result.reportFile}`); return result; }
  const result = await planRetention(config);
  console.log(`Dry run: ${result.manifest.files.length} raw clips eligible; no files moved. Review manifest: ${result.file}`);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
