# Trees vs Breath

Everyone says plant more trees. In a narrow Hong Kong street, a tree can make the air at your nose dirtier. Trees vs Breath tests a street's trees before anyone plants them.

**AI proposes, physics verifies, the wind tunnel judges.**

An entry for HacKU 2026, Deep Technology track, Problem Statement 3: _Test the Change Before You Make It_. The full brief is in [`BRIEF.md`](BRIEF.md).

- Live app: https://chingkheinganba231005.github.io/Trees-vs-breathe/
- Status: phase 1 (live solver) closing, phase 2 (trees, hedges and fumes) in progress. See [`docs/progress.md`](docs/progress.md) and [`docs/validation.md`](docs/validation.md).

## What it does

A district council, a landscape designer or a residents' group picks a street, plants trees and hedges in a cross-section of it, and sees two outcomes on each pavement:

- **Heat:** the Universal Thermal Climate Index (UTCI) and the hours of strong heat stress.
- **Fumes:** the pedestrian exposure to traffic exhaust, compared with the same street without trees.

A bigger, denser crown shades more pavement, but it also blocks the wind that flushes the street. The app shows that trade-off as a Pareto frontier and checks its physics against wind-tunnel measurements.

## Repository

```
apps/web/        Vite + React + TypeScript app (solver, sun and heat, AI inference, screens)
python/treesvb/  Reference solvers, CODASC comparison, dataset, training, validation report
colab/           A100 notebooks (sources in colab/src/)
results/         JSON from tests and Colab runs: the single source for every number shown
data/            Raw sources with provenance, licence and checksums
docs/            Progress, sources, assumptions, validation, pitch, Q&A
tests/           Vitest, pytest and Playwright suites
```

## Running it

Requires Node 22.12 or later and Python 3.11 or later.

```
npm ci
npm run dev            # http://localhost:5173
npm test               # unit tests
npm run e2e            # production build + Playwright smoke test with screenshots

uv venv .venv && uv pip install -e "python[test,notebooks]"
pytest
python -m treesvb.notebooks smoke   # run the Colab notebooks on CPU
```

Every model output in the app is simulated and labelled as such. What the model leaves out is listed on the "How we know" screen and in [`docs/validation.md`](docs/validation.md); assumptions and their sources are in [`docs/assumptions.md`](docs/assumptions.md) and [`docs/sources.md`](docs/sources.md).

## Licence

MIT. See [`LICENSE`](LICENSE). Fonts are under the SIL Open Font License 1.1; third-party licences are listed in [`docs/sources.md`](docs/sources.md).
