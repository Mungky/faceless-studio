import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function argumentsFor(argv, action) {
  let envFile = path.join(studioRoot, '.env');
  if (argv.includes('--help')) return { envFile, mode: 'help' };
  let mode = 'check';
  let selected = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env-file' && argv[i + 1]) envFile = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run' || argv[i] === action) {
      if (selected) throw new Error('Choose one mode.');
      selected = true;
      mode = argv[i] === action ? 'run' : 'check';
    }
    else throw new Error('Unknown or conflicting arguments. Use --help.');
  }
  return { envFile, mode };
}

export async function readSettings(envFile) {
  try { return parseEnv(await readFile(envFile, 'utf8')); }
  catch { throw new Error('Cannot read the selected .env file. Use --env-file with a readable file.'); }
}

export function required(settings, key) {
  if (!settings[key]?.trim()) throw new Error(`Set ${key} in the selected .env file.`);
  return settings[key].trim();
}

