// Local fixtures only: HTTP mock, simulated rclone, disposable Git repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { backup, backupSettings } from './backup.mjs';
import { syncVault, unsafeTrackedFiles } from './vault-sync.mjs';
import { argumentsFor } from './operations-common.mjs';

const execute = promisify(execFile);
async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-ops-'));
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('studio-ops-')) throw new Error('Unexpected fixture directory.');
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('explicit execution mode and backup settings fail closed', () => {
  assert.equal(argumentsFor([], '--run').mode, 'check');
  assert.equal(argumentsFor(['--help', '--run'], '--run').mode, 'help');
  assert.throws(() => argumentsFor(['--dry-run', '--run'], '--run'));
  assert.throws(() => backupSettings({}), /POCKETBASE_URL/);
  const settings = { POCKETBASE_URL: 'http://127.0.0.1:9999', PB_ADMIN_EMAIL: 'fixture@example.invalid', PB_ADMIN_PASSWORD: 'fixture-only', BACKUP_RCLONE_REMOTE: 'test:dedicated', RCLONE_CONFIG: '/fixture/rclone.conf' };
  assert.equal(backupSettings(settings).timeout, 600);
  assert.throws(() => backupSettings({ ...settings, BACKUP_RCLONE_REMOTE: 'test:' }), /dedicated backup folder/);
  assert.throws(() => backupSettings({ ...settings, POCKETBASE_URL: 'http://user:password@example.invalid' }), /without credentials/);
});

async function backupFixture(t, failSize = false) {
  const directory = await temporary(t);
  const calls = [];
  let name;
  const bytes = Buffer.from('PK\x03\x04fixture-zip-content');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    calls.push(`${request.method} ${url.pathname}`);
    response.setHeader('Content-Type', 'application/json');
    const body = [];
    for await (const chunk of request) body.push(chunk);
    if (url.pathname.endsWith('/auth-with-password')) {
      assert.deepEqual(JSON.parse(Buffer.concat(body).toString()), { identity: 'fixture@example.invalid', password: 'fixture-only' });
      return response.end(JSON.stringify({ token: 'fixture-superuser-token' }));
    }
    if (request.method === 'GET' && name && url.pathname === `/api/backups/${name}`) {
      assert.equal(url.searchParams.get('token'), 'fixture-file-token');
      return response.end(bytes);
    }
    assert.equal(request.headers.authorization, 'fixture-superuser-token');
    if (url.pathname === '/api/backups' && request.method === 'POST') {
      name = JSON.parse(Buffer.concat(body).toString()).name;
      assert.match(name, /^[a-z0-9_-]+\.zip$/);
      response.statusCode = 204;
      return response.end();
    }
    if (url.pathname === '/api/backups') return response.end(JSON.stringify([{ key: name, size: bytes.length + Number(failSize) }]));
    if (url.pathname === '/api/files/token') return response.end(JSON.stringify({ token: 'fixture-file-token' }));
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { directory, bytes, calls, config: { url: `http://127.0.0.1:${server.address().port}`, email: 'fixture@example.invalid', password: 'fixture-only', directory, remote: 'fixture:backups', rclone: 'fixture-rclone', rcloneConfig: '/fixture/config', timeout: 30 } };
}

test('backup follows authenticated API, then invokes non-destructive copy', async t => {
  const fixture = await backupFixture(t);
  let copied = false;
  const file = await backup(fixture.config, async (bin, args) => {
    copied = true;
    assert.equal(bin, 'fixture-rclone');
    assert.equal(args[0], 'copyto');
    assert.equal(args[2], `fixture:backups/${path.basename(args[1])}`);
    assert.ok(args.includes('--immutable'));
    assert.deepEqual(await readFile(args[1]), fixture.bytes);
  });
  assert.ok(copied);
  assert.deepEqual(await readFile(file), fixture.bytes);
  assert.deepEqual(fixture.calls.map(value => value.split(' ')[0]), ['POST', 'POST', 'GET', 'POST', 'GET']);
  assert.equal((await readdir(fixture.directory)).length, 1);
});

test('incomplete download blocks copy and preserves partial for inspection', async t => {
  const fixture = await backupFixture(t, true);
  await assert.rejects(backup(fixture.config, async () => assert.fail('must not copy')), /size differs/);
  assert.ok((await readdir(fixture.directory)).some(name => name.endsWith('.partial')));
});

test('upload failure retains complete local ZIP and does not leak subprocess output', async t => {
  const fixture = await backupFixture(t);
  await assert.rejects(backup(fixture.config, async () => { throw new Error('fixture-secret-that-must-not-escape'); }), error => !error.message.includes('fixture-secret') && /Local ZIP retained/.test(error.message));
  assert.ok((await readdir(fixture.directory)).some(name => name.endsWith('.zip')));
});

test('tracked policy excludes media and secrets while admitting vault notes/config', () => {
  assert.deepEqual(unsafeTrackedFiles(['notes/episode.md', '.obsidian/app.json', '.gitignore', 'settings.yaml']), []);
  assert.equal(unsafeTrackedFiles(['clips/a.mp4', '.env', 'tokens.json', 'rclone.conf']).length, 4);
});

const git = async (directory, ...args) => (await execute('git', ['-C', directory, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { windowsHide: true })).stdout.trim();
async function vaultFixture(t) {
  const root = await temporary(t);
  const remote = path.join(root, 'remote.git'), vault = path.join(root, 'vault'), other = path.join(root, 'other');
  await mkdir(remote); await mkdir(vault);
  await git(remote, 'init', '--bare', '--initial-branch=main');
  await git(vault, 'init', '--initial-branch=main');
  await writeFile(path.join(vault, 'episode.md'), '# Fixture\n');
  await git(vault, 'add', 'episode.md'); await git(vault, 'commit', '-m', 'fixture');
  await git(vault, 'remote', 'add', 'origin', remote); await git(vault, 'push', '-u', 'origin', 'main');
  await execute('git', ['clone', remote, other]);
  return { remote, vault, other };
}

test('vault checks reject non-repository, nested repository, dirty tree and media', async t => {
  const fixture = await vaultFixture(t);
  await syncVault(fixture.vault);
  await mkdir(path.join(fixture.vault, 'notes'));
  await assert.rejects(syncVault(path.join(fixture.vault, 'notes')), /different repository/);
  await writeFile(path.join(fixture.vault, 'episode.md'), 'changed');
  await assert.rejects(syncVault(fixture.vault, true), /uncommitted/);
  assert.equal(await readFile(path.join(fixture.vault, 'episode.md'), 'utf8'), 'changed');
  await git(fixture.vault, 'restore', 'episode.md');
  await writeFile(path.join(fixture.vault, 'clip.mp4'), 'fixture');
  await git(fixture.vault, 'add', 'clip.mp4'); await git(fixture.vault, 'commit', '-m', 'media fixture');
  await assert.rejects(syncVault(fixture.vault), /tracks media/);
});

test('vault sync only fast-forwards and rejects divergence without altering history', async t => {
  const fixture = await vaultFixture(t);
  await writeFile(path.join(fixture.other, 'remote.md'), 'remote');
  await git(fixture.other, 'add', '.'); await git(fixture.other, 'commit', '-m', 'remote note'); await git(fixture.other, 'push');
  await syncVault(fixture.vault, true);
  assert.equal(await readFile(path.join(fixture.vault, 'remote.md'), 'utf8'), 'remote');
  await writeFile(path.join(fixture.vault, 'local.md'), 'local');
  await git(fixture.vault, 'add', '.'); await git(fixture.vault, 'commit', '-m', 'local note');
  await syncVault(fixture.vault, true);
  assert.equal(await git(fixture.vault, 'rev-parse', 'HEAD'), await git(fixture.remote, 'rev-parse', 'main'));
  await writeFile(path.join(fixture.other, 'diverge.md'), 'other');
  await git(fixture.other, 'add', '.'); await git(fixture.other, 'commit', '-m', 'other branch');
  // The fixture remote is advanced from a separate local writer after catching up.
  await git(fixture.other, 'fetch'); await git(fixture.other, 'rebase', 'origin/main'); await git(fixture.other, 'push');
  await writeFile(path.join(fixture.vault, 'diverge-local.md'), 'local divergent');
  await git(fixture.vault, 'add', '.'); await git(fixture.vault, 'commit', '-m', 'local divergence');
  const before = await git(fixture.vault, 'rev-parse', 'HEAD');
  await assert.rejects(syncVault(fixture.vault, true), /diverged/);
  assert.equal(await git(fixture.vault, 'rev-parse', 'HEAD'), before);
});
