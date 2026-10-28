import { realpath, access, open, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentsFor, readSettings, required } from './operations-common.mjs';

const execute = promisify(execFile);
const permitted = new Set(['.md', '.json', '.yaml', '.yml', '.toml', '.ini', '.canvas', '.base']);
const configNames = new Set(['.gitignore', '.gitattributes', '.editorconfig']);

export function unsafeTrackedFiles(files) {
  return files.filter(file => {
    const name = path.posix.basename(file).toLowerCase();
    return /(^|\/)(\.env(?:\..*)?|rclone\.conf|id_rsa|id_ed25519|credentials[^/]*|token[^/]*|secrets?[^/]*)(\/|$)/i.test(file) || (!configNames.has(name) && !permitted.has(path.posix.extname(name)));
  });
}

export async function syncVault(root, sync = false) {
  let actual;
  try { actual = await realpath(root); } catch { throw new Error('Configured vault does not exist. Point VAULT_GIT_ROOT at the existing vault; this tool never initializes it.'); }
  const git = async (args, label) => {
    try { return (await execute('git', ['-C', actual, ...args], { windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } })).stdout.trimEnd(); }
    catch { throw new Error(`${label} failed. Inspect the existing repository manually; credentials and Git output are withheld.`); }
  };
  const top = await git(['rev-parse', '--show-toplevel'], 'Vault repository check');
  if (await realpath(top) !== actual) throw new Error('Vault is inside a different repository. Configure the actual vault repository root; no action performed.');
  const gitDir = await git(['rev-parse', '--absolute-git-dir'], 'Git directory check');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'index.lock']) {
    try { await access(path.join(gitDir, marker)); } catch { continue; }
    throw new Error('A Git operation is in progress. Finish or abort it manually after reviewing the vault, then rerun.');
  }
  if (await git(['status', '--porcelain=v1', '--untracked-files=all'], 'Working tree check')) throw new Error('Vault has uncommitted or conflicting files. Review git status in the vault, resolve conflicts, and commit intended Markdown/config changes before syncing. Nothing was staged or stashed.');
  const files = (await git(['ls-files', '-z'], 'Tracked file check')).split('\0').filter(Boolean);
  if (unsafeTrackedFiles(files).length) throw new Error('Vault tracks media or disallowed/secret-looking files. Review git ls-files; move large media to Drive and untrack it only after preserving a copy. History cleanup requires a separate reviewed action.');
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], 'Branch check');
  const remote = await git(['config', '--get', `branch.${branch}.remote`], 'Upstream remote check');
  const merge = await git(['config', '--get', `branch.${branch}.merge`], 'Upstream branch check');
  if (!/^[a-zA-Z0-9_.-]+$/.test(remote) || remote === '.' || !merge.startsWith('refs/heads/')) throw new Error('Configure an existing private remote and branch upstream manually before syncing.');
  await git(['remote', 'get-url', remote], 'Remote configuration check');
  if (!sync) { console.log('Vault checks passed. Dry run: no fetch, merge, push, commit, stash, or remote changes. Private remote visibility must be confirmed by its owner.'); return; }
  const lockPath = path.join(gitDir, 'studio-vault-sync.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('Vault sync lock exists. Confirm no sync is running before removing studio-vault-sync.lock from the Git directory.'); }
  try {
    await lock.writeFile(String(process.pid));
    await git(['fetch', '--no-tags', remote], 'Fetch');
    // Recheck after fetch: another editor may have changed the working tree.
    if (await git(['status', '--porcelain=v1', '--untracked-files=all'], 'Working tree recheck')) throw new Error('Vault changed during fetch. Review and commit intended changes manually before rerunning.');
    const counts = (await git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], 'Divergence check')).split(/\s+/).map(Number);
    if (counts.length !== 2 || counts.some(value => !Number.isFinite(value))) throw new Error('Cannot determine vault divergence. Inspect upstream configuration manually.');
    const [ahead, behind] = counts;
    if (ahead && behind) throw new Error('Local and remote vault histories diverged. Review git log --graph --oneline --all and resolve manually. No merge, reset, or push was attempted.');
    if (behind) {
      const remoteFiles = (await git(['ls-tree', '-r', '--name-only', '-z', '@{upstream}'], 'Incoming file check')).split('\0').filter(Boolean);
      if (unsafeTrackedFiles(remoteFiles).length) throw new Error('Remote vault includes media or disallowed/secret-looking files. Review upstream manually before merging.');
      await git(['merge', '--ff-only', '@{upstream}'], 'Fast-forward merge');
    }
    if (ahead) await git(['push', remote, `HEAD:${merge}`], 'Fast-forward push');
    console.log(`Vault sync complete: ${behind ? 'fast-forwarded local vault' : ahead ? 'pushed existing commits' : 'already current'}. No commits were created.`);
  } finally { await lock.close(); await unlink(lockPath); }
}

export async function main(argv = process.argv.slice(2)) {
  const args = argumentsFor(argv, '--sync');
  if (args.mode === 'help') return console.log('node scripts/vault-sync.mjs [--dry-run | --sync] [--env-file /path/.env]\nDefault: read-only vault checks. --sync fetches and only fast-forwards a clean existing repository. No staging or commits.');
  const settings = await readSettings(args.envFile);
  return syncVault(settings.VAULT_GIT_ROOT || required(settings, 'VAULT_ROOT'), args.mode === 'run');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
