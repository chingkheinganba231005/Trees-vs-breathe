import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');

function git(args: string): string {
  try {
    return execSync(`git -C "${repo}" ${args}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** Same provenance fields as python/treesvb/results.py. */
export function writeResult(
  relpath: string,
  payload: Record<string, unknown>,
  generatedBy: string,
): string {
  const path = resolve(repo, 'results', relpath);
  mkdirSync(dirname(path), { recursive: true });
  const doc = {
    schema: 1,
    generated_by: generatedBy,
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    commit: git('rev-parse HEAD') || 'unknown',
    dirty: git('status --porcelain -- python apps/web/src') !== '',
    ...payload,
  };
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  return path;
}
