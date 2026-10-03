import { useMemo } from 'react';
import { AppShell } from './components/AppShell';
import { useRoute } from './lib/router';
import { browserHasWebGPU, parseEngineParam, resolveEngine } from './sim/engine';
import type { EngineChoice } from './sim/engine';
import { Compare } from './screens/Compare';
import { Design } from './screens/Design';
import { HongKong } from './screens/HongKong';
import { HowWeKnow } from './screens/HowWeKnow';
import { NotFound } from './screens/NotFound';
import { Present } from './screens/Present';
import { Report } from './screens/Report';
import { Start } from './screens/Start';
import { Street } from './screens/Street';
import { TradeOff } from './screens/TradeOff';

function screenFor(route: string, engine: EngineChoice) {
  switch (route) {
    case '/':
      return <Start />;
    case '/street':
      return <Street />;
    case '/design':
      return <Design engine={engine} />;
    case '/trade-off':
      return <TradeOff />;
    case '/compare':
      return <Compare />;
    case '/how-we-know':
      return <HowWeKnow />;
    case '/hong-kong':
      return <HongKong />;
    case '/report':
      return <Report />;
    default:
      return <NotFound />;
  }
}

export function App() {
  const route = useRoute();
  const choice = useMemo(() => parseEngineParam(window.location.search), []);
  const engine = useMemo(() => resolveEngine(choice, browserHasWebGPU(navigator)), [choice]);

  // Presentation mode owns the whole screen.
  if (route === '/present') return <Present />;

  return (
    <AppShell route={route} engine={engine}>
      {screenFor(route, choice)}
    </AppShell>
  );
}
