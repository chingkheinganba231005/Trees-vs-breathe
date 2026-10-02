import { useMemo } from 'react';
import { AppShell } from './components/AppShell';
import { useRoute } from './lib/router';
import { browserHasWebGPU, parseEngineParam, resolveEngine } from './sim/engine';
import type { EngineChoice } from './sim/engine';
import { Design } from './screens/Design';
import { HowWeKnow } from './screens/HowWeKnow';
import { NotFound } from './screens/NotFound';
import { Placeholder } from './screens/Placeholder';
import { Present } from './screens/Present';
import { Start } from './screens/Start';

function screenFor(route: string, engine: EngineChoice) {
  switch (route) {
    case '/':
      return <Start />;
    case '/street':
      return <Placeholder title="street.title" intro="street.intro" phase={3} />;
    case '/design':
      return <Design engine={engine} />;
    case '/trade-off':
      return <Placeholder title="tradeOff.title" intro="tradeOff.intro" phase={4} />;
    case '/compare':
      return <Placeholder title="compare.title" intro="compare.intro" phase={5} />;
    case '/how-we-know':
      return <HowWeKnow />;
    case '/hong-kong':
      return <Placeholder title="hongKong.title" intro="hongKong.intro" phase={5} />;
    case '/report':
      return <Placeholder title="report.title" intro="report.intro" phase={5} />;
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
