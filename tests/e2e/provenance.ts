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

// Captured when the test file loads, before the run, as results.py does: the result describes
// the code that ran, whatever is edited while it runs.
const START = {
  commit: git('rev-parse HEAD') || 'unknown',
  dirty: git('status --porcelain -- python apps/web/src') !== '',
};

function packageVersion(name: string): string {
  const file = resolve(repo, 'node_modules', name, 'package.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

/** Same provenance fields as python/treesvb/results.py, plus the browser that ran the test. */
export function writeResult(
  relpath: string,
  payload: Record<string, unknown>,
  generatedBy: string,
  browserVersion: string,
): string {
  const path = resolve(repo, 'results', relpath);
  mkdirSync(dirname(path), { recursive: true });
  const doc = {
    schema: 1,
    generated_by: generatedBy,
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    ...START,
    versions: {
      node: process.version.replace(/^v/, ''),
      '@playwright/test': packageVersion('@playwright/test'),
      chromium: browserVersion,
    },
    ...payload,
  };
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  return path;
}
