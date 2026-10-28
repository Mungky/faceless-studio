// Disposable local HTTP fixtures and an in-memory rclone command double only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { eligible, retentionSettings, retentionArguments, planRetention, runRetention } from './retention.mjs';

const now = Date.parse('2026-10-28T00:00:00.000Z');
const episodeId = 'episode00000001', channelId = 'channel00000001', assetId = 'asset0000000001';
const sourcePath = 'Faceless/Arthur/fixture-episode/clips/beat-01_v1.mp4';
const root = 'fixture:studio/';
const oldDate = '2026-09-01 00:00:00.000Z';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-retention-'));
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('studio-retention-')) throw new Error('Unexpected fixture directory.');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const episode = { id: episodeId, channel: channelId, slug: 'fixture-episode', status: 'published', published_at: oldDate };
  const channel = { id: channelId, name: 'Arthur' };
  const assets = [{ id: assetId, episode: episodeId, kind: 'video', drive_path: sourcePath, drive_file_id: 'drive-fixture-id', selected: true, meta: { beat: 1, filename: 'beat-01_v1.mp4' } }];
  const calls = [], patches = [], jobs = [], files = new Map([[root + sourcePath, { Path: 'beat-01_v1.mp4', Name: 'beat-01_v1.mp4', IsDir: false, Size: 1234, ID: 'drive-fixture-id' }]]);
  let failPatch = false;
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const url = new URL(request.url, 'http://localhost'), body = [];
    for await (const chunk of request) body.push(chunk);
    if (url.pathname.endsWith('/auth-with-password')) {
      assert.deepEqual(JSON.parse(Buffer.concat(body).toString()), { identity: 'fixture@example.invalid', password: 'fixture-only' });
      return response.end(JSON.stringify({ token: 'fixture-token' }));
    }
    assert.equal(request.headers.authorization, 'fixture-token');
    if (url.pathname.endsWith(`/episodes/records/${episodeId}`)) return response.end(JSON.stringify(episode));
    if (url.pathname.endsWith(`/channels/records/${channelId}`)) return response.end(JSON.stringify(channel));
    if (url.pathname.endsWith('/episodes/records')) return response.end(JSON.stringify({ items: [episode], totalPages: 1 }));
    if (url.pathname.endsWith('/assets/records')) return response.end(JSON.stringify({ items: assets, totalPages: 1 }));
    if (url.pathname.endsWith('/jobs/records')) {
      assert.equal(url.searchParams.get('filter'), 'status="queued" || status="running"');
      return response.end(JSON.stringify({ items: jobs, totalPages: 1 }));
    }
    if (url.pathname.endsWith(`/assets/records/${assetId}`) && request.method === 'PATCH') {
      if (failPatch) { response.statusCode = 503; return response.end('{}'); }
      const patch = JSON.parse(Buffer.concat(body).toString()); patches.push(patch); Object.assign(assets[0], patch);
      return response.end(JSON.stringify(assets[0]));
    }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { url: `http://127.0.0.1:${server.address().port}`, email: 'fixture@example.invalid', password: 'fixture-only', source: 'fixture:studio', archive: 'fixture:studio/Faceless/.archive', directory, rclone: 'fixture-rclone', rcloneConfig: '/fixture/rclone.conf', timeout: 30 };
  const runCommand = async (binary, args) => {
    assert.equal(binary, 'fixture-rclone');
    assert.ok(args.includes('--drive-skip-shortcuts'), 'all retention commands must ignore Drive shortcuts');
    assert.ok(args.includes('--config')); assert.ok(args.includes('--retries'));
    calls.push(args);
    if (args[0] === 'lsjson') {
      if (args.includes('--stat')) {
        if (!files.has(args[1])) throw Object.assign(new Error('fixture missing'), { code: 4 });
        return { stdout: JSON.stringify(files.get(args[1])) };
      }
      assert.equal(args[1], root + 'Faceless/Arthur/fixture-episode/clips');
      assert.ok(args.includes('--recursive')); assert.ok(args.includes('--files-only'));
      return { stdout: JSON.stringify([...files.entries()].filter(([key]) => key.startsWith(args[1] + '/')).map(([, value]) => value)) };
    }
    assert.equal(args[0], 'moveto'); assert.ok(args.includes('--immutable'));
    assert.ok(args[1].startsWith(root + 'Faceless/Arthur/fixture-episode/clips/'));
    assert.ok(args[2].startsWith(root + `Faceless/.archive/${episodeId}/`));
    assert.equal(files.has(args[2]), false);
    files.set(args[2], files.get(args[1])); files.delete(args[1]);
    return { stdout: '' };
  };
  return { config, episode, channel, assets, calls, patches, jobs, files, runCommand, failPatch: () => { failPatch = true; } };
}

test('default plans, run requires a manifest, and archive configuration is restricted', () => {
  assert.equal(retentionArguments([]).mode, 'plan');
  assert.throws(() => retentionArguments(['--run']), /requires --manifest/);
  assert.throws(() => retentionArguments(['--manifest', 'x']), /only with --run/);
  assert.throws(() => retentionArguments(['--dry-run', '--run']), /conflicting/);
  const env = { POCKETBASE_URL: 'http://127.0.0.1:9999', PB_ADMIN_EMAIL: 'fixture@example.invalid', PB_ADMIN_PASSWORD: 'fixture-only', RCLONE_REMOTE: 'fixture:studio/', RETENTION_ARCHIVE_REMOTE: 'fixture:studio/Faceless/.archive/', RCLONE_CONFIG: '/fixture/rclone.conf' };
  assert.equal(retentionSettings(env).archive, 'fixture:studio/Faceless/.archive');
  for (const archive of ['fixture:', 'other:Faceless/.archive', 'fixture:studio/Faceless/Arthur', 'fixture:studio/Faceless/.archive/../clips']) assert.throws(() => retentionSettings({ ...env, RETENTION_ARCHIVE_REMOTE: archive }));
  assert.throws(() => retentionSettings({ ...env, RCLONE_REMOTE: 'fixture:../user-files' }));
});

test('eligibility uses only explicit valid UTC publication time at the 30-day boundary', () => {
  const published = value => ({ status: 'published', published_at: value, updated: oldDate, created: oldDate });
  assert.equal(eligible(published('2026-09-28T00:00:00.000Z'), now), true);
  assert.equal(eligible(published('2026-09-28T00:00:00.001Z'), now), false);
  for (const value of [undefined, '', 'invalid', '2026-10-29T00:00:00.000Z', '2026-02-30T00:00:00.000Z', '2026-09-01T00:00:00+07:00']) assert.equal(eligible(published(value), now), false);
  assert.equal(eligible({ status: 'review', published_at: oldDate }, now), false);
});

test('dry run writes a fresh immutable manifest and never changes Drive or assets', async t => {
  const f = await fixture(t), result = await planRetention(f.config, f.runCommand, now);
  assert.equal(result.manifest.files.length, 1);
  assert.equal(f.calls.every(args => args[0] === 'lsjson'), true);
  assert.equal(f.files.has(root + sourcePath), true); assert.equal(f.patches.length, 0);
  const manifest = JSON.parse(await readFile(result.file, 'utf8'));
  assert.equal(manifest.files[0].file_id, 'drive-fixture-id');
  assert.equal(manifest.files[0].source_path, sourcePath);
  const again = await planRetention(f.config, f.runCommand, now);
  assert.notEqual(again.file, result.file);
  assert.equal((await readdir(f.config.directory)).length, 2);
});

test('missing or future publication date skips remote inventory even with an old updated date', async t => {
  const f = await fixture(t);
  f.episode.updated = oldDate;
  for (const date of ['', '2026-10-29T00:00:00.000Z']) {
    f.episode.published_at = date;
    assert.equal((await planRetention(f.config, f.runCommand, now)).manifest.files.length, 0);
  }
  assert.equal(f.calls.length, 0);
});

test('path spoofing in channel, episode or rclone output blocks a manifest', async t => {
  const f = await fixture(t);
  f.channel.name = '../user-files';
  await assert.rejects(planRetention(f.config, f.runCommand, now), /Unsafe channel/);
  assert.equal(f.calls.length, 0);
  f.channel.name = 'Arthur'; f.episode.slug = '..';
  await assert.rejects(planRetention(f.config, f.runCommand, now), /Unsafe channel/);
  f.episode.slug = 'fixture-episode';
  f.files.get(root + sourcePath).Path = '../renders/final.mp4';
  await assert.rejects(planRetention(f.config, f.runCommand, now), /Unsafe or incomplete/);
  assert.equal((await readdir(f.config.directory)).length, 0);
});

test('folder shortcuts are excluded from inventory and an old shortcut candidate fails before any move', async t => {
  const f = await fixture(t), calls = [];
  const shortcutPath = 'Faceless/Arthur/fixture-episode/clips/linked/final.mp4';
  const final = { Path: 'final.mp4', Name: 'final.mp4', IsDir: false, Size: 3210, ID: 'protected-final-render' };
  let finalPresent = true, archived = null, moves = 0;
  const missing = () => { throw Object.assign(new Error('fixture shortcut hidden or file absent'), { code: 4 }); };
  // Model rclone's Drive behavior: without skip-shortcuts, linked/final.mp4
  // resolves to a real render outside clips. With the flag it cannot be resolved.
  const shortcutCommands = async (_binary, args) => {
    calls.push(args);
    if (args[0] === 'moveto') { moves++; finalPresent = false; archived = final; return { stdout: '' }; }
    assert.equal(args[0], 'lsjson');
    if (!args.includes('--stat')) return { stdout: JSON.stringify(args.includes('--drive-skip-shortcuts') ? [] : [{ ...final, Path: 'linked/final.mp4' }]) };
    if (args[1] === root + shortcutPath) {
      if (args.includes('--drive-skip-shortcuts') || !finalPresent) return missing();
      return { stdout: JSON.stringify(final) };
    }
    if (archived && args[1].includes('/Faceless/.archive/')) return { stdout: JSON.stringify(archived) };
    return missing();
  };
  const planned = await planRetention(f.config, shortcutCommands, now);
  assert.equal(planned.manifest.files.length, 0);
  // A previously reviewed manifest must also fail if its path now crosses a shortcut.
  const { sha256: _sha256, ...oldManifest } = JSON.parse(await readFile(planned.file, 'utf8'));
  oldManifest.id = randomUUID();
  oldManifest.files = [{ episode: episodeId, channel: channelId, channel_name: 'Arthur', slug: 'fixture-episode', published_at: oldDate, relative_clip: 'linked/final.mp4', source_path: shortcutPath, archive_path: `Faceless/.archive/${episodeId}/${oldManifest.id}/linked/final.mp4`, size: final.Size, file_id: final.ID, assets: [] }];
  const legacyFile = path.join(f.config.directory, `retention_${oldManifest.id}.json`);
  await writeFile(legacyFile, JSON.stringify({ ...oldManifest, sha256: createHash('sha256').update(JSON.stringify(oldManifest)).digest('hex') }));
  await assert.rejects(runRetention(f.config, legacyFile, shortcutCommands, now), /rclone retention command failed/);
  assert.equal(moves, 0); assert.equal(finalPresent, true); assert.equal(archived, null);
  assert.ok(calls.every(args => args.includes('--drive-skip-shortcuts')));
});

test('VO, final renders, unknown files and inconsistent asset IDs are never eligible', async t => {
  const f = await fixture(t);
  f.files.set(root + 'Faceless/Arthur/fixture-episode/clips/narration.wav', { Path: 'narration.wav', Name: 'narration.wav', IsDir: false, Size: 12, ID: 'drive-audio-fixture' });
  const initial = await planRetention(f.config, f.runCommand, now);
  assert.equal(initial.manifest.files.length, 1);
  assert.equal(initial.manifest.files[0].source_path, sourcePath);
  for (const kind of ['vo', 'render']) {
    f.assets[0].kind = kind;
    assert.equal((await planRetention(f.config, f.runCommand, now)).manifest.files.length, 0);
  }
  f.assets[0].kind = 'video'; f.assets[0].drive_file_id = 'different-id';
  assert.equal((await planRetention(f.config, f.runCommand, now)).manifest.files.length, 0);
  assert.equal(f.calls.every(args => args[0] === 'lsjson'), true);
});

test('run archives one verified file and updates preview paths, ID, selection and recovery metadata', async t => {
  const f = await fixture(t), planned = await planRetention(f.config, f.runCommand, now);
  const result = await runRetention(f.config, planned.file, f.runCommand, now);
  assert.equal(result.count, 1); assert.equal(f.calls.filter(args => args[0] === 'moveto').length, 1);
  assert.equal(f.files.has(root + sourcePath), false);
  assert.equal(f.assets[0].drive_path, planned.manifest.files[0].archive_path);
  assert.equal(f.assets[0].drive_file_id, 'drive-fixture-id'); assert.equal(f.assets[0].selected, false);
  assert.equal(f.assets[0].meta.beat, 1); assert.equal(f.assets[0].meta.retention.original_path, sourcePath);
  assert.equal(f.assets[0].meta.retention.published_at, oldDate);
  assert.match(await readFile(result.reportFile, 'utf8'), /"event":"complete"/);
});

test('status, exact publication timestamp and file size/ID are rechecked before any move', async t => {
  const f = await fixture(t), planned = await planRetention(f.config, f.runCommand, now);
  f.episode.status = 'review';
  await assert.rejects(runRetention(f.config, planned.file, f.runCommand, now), /publication state/);
  f.episode.status = 'published'; f.episode.published_at = '2026-09-02 00:00:00.000Z';
  await assert.rejects(runRetention(f.config, planned.file, f.runCommand, now), /publication state/);
  f.episode.published_at = oldDate;
  f.files.get(root + sourcePath).Size++;
  await assert.rejects(runRetention(f.config, planned.file, f.runCommand, now), /Source clip/);
  f.files.get(root + sourcePath).Size--; f.files.get(root + sourcePath).ID = 'replaced-file';
  await assert.rejects(runRetention(f.config, planned.file, f.runCommand, now), /Source clip/);
  assert.equal(f.calls.some(args => args[0] === 'moveto'), false); assert.equal(f.patches.length, 0);
});

test('publication state is checked again after the full preflight and immediately before moving', async t => {
  const f = await fixture(t), planned = await planRetention(f.config, f.runCommand, now);
  const changeAfterPreflight = async (binary, args, options) => {
    if (args[0] === 'lsjson' && args.includes('--stat') && args[1].includes('/Faceless/.archive/')) f.episode.status = 'review';
    return f.runCommand(binary, args, options);
  };
  await assert.rejects(runRetention(f.config, planned.file, changeAfterPreflight, now), /publication state/);
  assert.equal(f.calls.some(args => args[0] === 'moveto'), false);
});

test('planning skips clips referenced by cross-episode queued renders but admits completed jobs', async t => {
  const f = await fixture(t);
  f.jobs.push({ id: 'job000000000001', episode: 'other0000000001', status: 'queued', payload: { assets: [{ drive_path: sourcePath }] } });
  const skipped = await planRetention(f.config, f.runCommand, now);
  assert.equal(skipped.manifest.files.length, 0);
  assert.match(skipped.manifest.skipped[0].reason, /queued or running job/);
  f.jobs[0].status = 'done';
  assert.equal((await planRetention(f.config, f.runCommand, now)).manifest.files.length, 1);
  assert.equal(f.calls.some(args => args[0] === 'moveto'), false);
});

test('run preflight blocks queued render paths and running image/video asset references across episodes', async t => {
  const f = await fixture(t), planned = await planRetention(f.config, f.runCommand, now);
  const payloads = [{ assets: [{ drive_path: sourcePath }] }, { reference: { id: assetId } }, { beats: [{ image: assetId }] }, { beats: [{ video: assetId }] }];
  for (const [index, payload] of payloads.entries()) {
    f.jobs.splice(0, f.jobs.length, { id: 'job000000000001', episode: 'other0000000001', status: index ? 'running' : 'queued', payload });
    await assert.rejects(runRetention(f.config, planned.file, f.runCommand, now), /referenced by a queued or running job/);
  }
  assert.equal(f.calls.some(args => args[0] === 'moveto'), false);
  assert.equal(f.patches.length, 0);
});

test('a job appearing during the immediate source stat blocks the move after a successful full preflight', async t => {
  const f = await fixture(t), planned = await planRetention(f.config, f.runCommand, now);
  let sourceStats = 0;
  const queueDuringStat = async (binary, args, options) => {
    if (args[0] === 'lsjson' && args.includes('--stat') && args[1] === root + sourcePath && ++sourceStats === 2) f.jobs.push({ id: 'job000000000001', episode: 'other0000000001', status: 'queued', payload: { assets: [{ drive_path: sourcePath }] } });
    return f.runCommand(binary, args, options);
  };
  await assert.rejects(runRetention(f.config, planned.file, queueDuringStat, now), /referenced by a queued or running job/);
  assert.equal(sourceStats, 2);
  assert.equal(f.calls.some(args => args[0] === 'moveto'), false);
  assert.equal(f.files.has(root + sourcePath), true);
});

test('even a rehashed manifest cannot redirect a move outside clips', async t => {
  const f = await fixture(t), planned = await planRetention(f.config, f.runCommand, now);
  const value = JSON.parse(await readFile(planned.file, 'utf8'));
  delete value.sha256; value.files[0].relative_clip = '../renders/final.mp4';
  value.files[0].source_path = 'Faceless/Arthur/fixture-episode/renders/final.mp4';
  value.sha256 = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // Separate writable fixture file: the actual generated manifest is not overwritten.
  const other = path.join(f.config.directory, `retention_${value.id}.json` + '.tampered');
  await writeFile(other, JSON.stringify(value));
  await assert.rejects(runRetention(f.config, other, f.runCommand, now), /Unsafe manifest/);
  assert.equal(f.calls.some(args => args[0] === 'moveto'), false);
});

test('destination collisions stop rather than overwrite; metadata failure retains an actionable report', async t => {
  const f = await fixture(t), planned = await planRetention(f.config, f.runCommand, now);
  const destination = root + planned.manifest.files[0].archive_path;
  f.files.set(destination, f.files.get(root + sourcePath));
  await assert.rejects(runRetention(f.config, planned.file, f.runCommand, now), /already exists/);
  assert.equal(f.calls.some(args => args[0] === 'moveto'), false);
  f.files.delete(destination); f.failPatch();
  await assert.rejects(runRetention(f.config, planned.file, f.runCommand, now), /metadata recovery/);
  assert.equal(f.files.has(destination), true);
  const reports = (await readdir(f.config.directory)).filter(file => file.endsWith('.jsonl'));
  const contents = await Promise.all(reports.map(file => readFile(path.join(f.config.directory, file), 'utf8')));
  assert.ok(contents.some(value => value.includes('"event":"moved"') && value.includes('"original_assets"')));
});
