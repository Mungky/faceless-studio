// Optional local PocketBase integration. No user DB, vault, Drive or paid provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { backup } from './backup.mjs';
import { studioRoot } from './operations-common.mjs';

test('native PocketBase creates and downloads a consistent backup through its API', async t => {
  const binary = path.join(studioRoot, '.runtime', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
  try { await access(binary); } catch { return t.skip('Run setup:local to install the native PocketBase executable first.'); }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-backup-native-'));
  if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(directory).startsWith('studio-backup-native-')) throw new Error('Unexpected fixture directory.');
  const database = path.join(directory, 'database');
  const password = randomBytes(32).toString('hex');
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  let child;
  try {
    await mkdir(path.join(directory, 'hooks')); await mkdir(path.join(directory, 'migrations'));
    await promisify(execFile)(binary, ['superuser', 'upsert', 'fixture@example.invalid', password, `--dir=${database}`], { windowsHide: true });
    child = spawn(binary, ['serve', `--http=127.0.0.1:${port}`, `--dir=${database}`, `--hooksDir=${path.join(directory, 'hooks')}`, `--migrationsDir=${path.join(directory, 'migrations')}`], { windowsHide: true, stdio: 'ignore' });
    let spawnFailed = false; child.once('error', () => { spawnFailed = true; });
    let ready = false;
    for (let i = 0; i < 80 && !spawnFailed; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Disposable PocketBase fixture starts');
    let copied = false;
    const file = await backup({ url: `http://127.0.0.1:${port}`, email: 'fixture@example.invalid', password, directory: path.join(directory, 'downloads'), remote: 'fixture:backups', rclone: 'simulated-rclone', rcloneConfig: '/fixture/config', timeout: 30 }, async () => { copied = true; });
    assert.ok(copied);
    const zip = await readFile(file);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.ok(zip.includes(Buffer.from('data.db')), 'Archive includes the PocketBase application database');
    assert.ok(zip.includes(Buffer.from('auxiliary.db')), 'Archive includes the PocketBase auxiliary database');
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
