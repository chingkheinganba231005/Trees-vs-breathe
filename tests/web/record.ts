import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Captured when the test file loads, as results.py does: the result describes the code that ran.
const START = {
  commit: git('rev-parse HEAD') || 'unknown',
  dirty: git('status --porcelain -- python apps/web/src') !== '',
};

function packageVersion(name: string): string {
  const file = resolve(repo, 'node_modules', name, 'package.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

/**
 * Write a result with the provenance fields of python/treesvb/results.py, only when
 * RECORD_RESULTS=1, so routine test runs do not rewrite committed files.
 */
export function recordResult(
  relpath: string,
  payload: Record<string, unknown>,
  generatedBy: string,
  versions: Record<string, string> = {},
): void {
  if (process.env.RECORD_RESULTS !== '1') return;
  const path = resolve(repo, 'results', relpath);
  mkdirSync(dirname(path), { recursive: true });
  const doc = {
    schema: 1,
    generated_by: generatedBy,
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    ...START,
    versions: {
      node: process.version.replace(/^v/, ''),
      vitest: packageVersion('vitest'),
      ...versions,
    },
    ...payload,
  };
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
}
