import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

function shortCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Relative base so the same build works on GitHub Pages under /<repo>/ and offline from any path.
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_COMMIT__: JSON.stringify(shortCommit()),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    // Test files live in the repo-level tests/ folder, as laid out in BRIEF.md section 13.
    dir: fileURLToPath(new URL('../../tests/web', import.meta.url)),
    environment: 'node',
  },
});
