import { appendFileSync } from 'node:fs';
import { test } from 'vitest';
import { CpuSolver } from '../../apps/web/src/sim/cpu/solver';
import { canyonDomain, canyonGeometry, uniformStart } from '../../apps/web/src/sim/street';
import { liveParams, LIVE_FLOW } from '../../apps/web/src/sim/streetSim';

test('cpu speed', () => {
  const g = canyonGeometry(24, 1);
  const d = canyonDomain(g);
  const s = new CpuSolver(d, liveParams(g, d.solid, LIVE_FLOW, []));
  const st = uniformStart(LIVE_FLOW.uRef, d.solid);
  s.setState(new Float32Array(s.n).fill(1), st.ux, st.uy);
  s.step(100);
  const t = performance.now();
  s.step(400);
  const ms = (performance.now() - t) / 400;
  appendFileSync(
    '/tmp/claude-0/-home-user-Trees-vs-breathe/bdfd5609-46b4-5774-8ef3-a8eb97ae0170/scratchpad/cpu-speed.txt',
    `tracer unrolled: ${ms.toFixed(2)} ms per step (${(1000 / ms).toFixed(0)} steps/s)\n`,
  );
});
