import '../index.css';
import type { GoldenCase } from '../sim/golden';
import { runSelfTest } from './run';
import type { SelfTestResult } from './run';

declare global {
  interface Window {
    __selftest?: SelfTestResult | { error: string };
  }
}

// Golden files written by `python -m treesvb.golden`, bundled only into this page.
const files = import.meta.glob<GoldenCase>('../../../../tests/golden/*.json', {
  import: 'default',
});

const root = document.getElementById('root')!;

function fmt(v: number | null): string {
  return v === null ? 'n/a' : v.toExponential(2);
}

async function adapterInfo(): Promise<{ device: GPUDevice | null; label: string }> {
  if (!('gpu' in navigator) || !navigator.gpu) return { device: null, label: 'no WebGPU' };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { device: null, label: 'no WebGPU adapter' };
  const i = adapter.info;
  const label = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' ');
  return { device: await adapter.requestDevice(), label: label || 'unnamed adapter' };
}

async function main() {
  root.innerHTML =
    '<h1 class="text-2xl font-bold">Solver self-test</h1><p class="mt-2">Running…</p>';
  const goldens = await Promise.all(Object.values(files).map((load) => load()));
  goldens.sort((a, b) => a.name.localeCompare(b.name));
  const { device, label } = await adapterInfo();
  const result = await runSelfTest(goldens, device, label);
  window.__selftest = result;
  const rows = result.rows
    .map(
      (r) =>
        `<tr class="border-t border-line"><td class="py-2 pr-3">${r.name}</td><td class="pr-3 font-mono">${fmt(r.cpuError)}</td><td class="font-mono">${fmt(r.gpuError)}</td></tr>`,
    )
    .join('');
  root.innerHTML = `
    <h1 class="text-2xl font-bold">Solver self-test</h1>
    <p class="mt-2 text-ink-muted">Each case runs on this device and is compared with the Python reference (NumPy, float64). Error: largest velocity difference as a fraction of the reference speed. Pass below ${result.threshold * 100}%.</p>
    <p class="mt-4 text-xl font-bold">${result.passed ? 'Passed' : 'Failed'}: worst ${fmt(result.worst)}</p>
    <p class="mt-1 font-mono text-sm text-ink-muted">GPU: ${label}</p>
    <table class="mt-6 w-full text-left text-sm"><thead><tr><th class="pr-3">Case</th><th class="pr-3">CPU</th><th>GPU</th></tr></thead><tbody>${rows}</tbody></table>`;
}

main().catch((err: unknown) => {
  window.__selftest = { error: String(err) };
  root.textContent = `Self-test failed to run: ${String(err)}`;
});
