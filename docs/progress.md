# Progress

Phases follow `BRIEF.md` section 12. Each phase starts with a checklist here; items are ticked as they are finished and verified.

## P0 — Setup

- [x] `BRIEF.md` at the repo root; `CLAUDE.md` with the working rules
- [x] Monorepo: `apps/web` (Vite + React + TypeScript + Tailwind), `python/treesvb`, `colab/`, `docs/`, `results/`, `data/`, `tests/`
- [x] Web shell: colour tokens for light and dark themes, Atkinson Hyperlegible Next and Mono, hash router with all nine screens, English and Traditional Chinese strings, the "What the model leaves out" list, the "Simulated" tag
- [x] Unit tests (Vitest): WCAG AA contrast of every text colour pair, steady lightness steps in the fumes and heat ramps, CSS and token values in sync, string keys identical in both languages, router, engine selection
- [x] Playwright smoke test on a phone and a desktop viewport: every screen, Traditional Chinese, dark theme before first paint, navigation to every screen, no console errors. Screenshots in `test-results/screens/`, inspected by eye
- [x] Python package: Colab plumbing (A100 check, run folders, manifest with SHA-256, download instructions, `verify` command); notebook build, check and smoke runner; pytest
- [x] `colab/00_setup_check.ipynb`, runnable in CPU smoke mode
- [x] CI workflow: web job (lint, format, typecheck, unit, build, Playwright) and Python job (ruff, pytest, notebook sync check, notebook smoke run)
- [x] GitHub Pages workflow
- [x] CI green on GitHub (run 1 on commit `15e81b4`: web and Python jobs, every step passed)
- [x] Deployed to GitHub Pages: run 37026963028 (commit `710a2dc`), build and deploy jobs both succeeded. The container's network blocks `*.github.io`, so the live URL was not fetched from here; instead the Playwright smoke test now serves the production build under the same `/Trees-vs-breathe/` subpath as Pages (28 of 28 pass). Confirmed on a real phone: pending (please open the URL once)

### Decisions

| ID    | Decision                                                                                                                      | Why                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| D-001 | npm workspaces                                                                                                                | One tool fewer in CI than pnpm; the repo has a single JS package for now                                                |
| D-002 | Hash routing (`#/design`) with a 30-line router                                                                               | Deep links work on GitHub Pages and offline with no server rewrites; no router dependency                               |
| D-003 | Vite `base: './'`                                                                                                             | The same build works under `/Trees-vs-breathe/` and from any offline path                                               |
| D-004 | TypeScript 6.0.3, not 7.0                                                                                                     | typescript-eslint 8.71 supports TypeScript below 6.1                                                                    |
| D-005 | Playwright 1.56.1                                                                                                             | Matches the Chromium build (1194) preinstalled in the development container; CI installs its own browser                |
| D-006 | Notebooks written as jupytext percent `.py` in `colab/src/`; `.ipynb` generated, committed without outputs, and checked in CI | Reviewable diffs, one source                                                                                            |
| D-007 | Notebooks put the cloned `python/` folder on `sys.path` instead of `pip install -e`, and do not reinstall numpy               | An editable install is not importable until the kernel restarts; reinstalling numpy over Colab's build forces a restart |
| D-008 | Pages deploys from whichever branch is the repository default                                                                 | Works before and after a `main` branch exists                                                                           |
| D-009 | Colour values live in `src/theme/tokens.ts`; `index.css` mirrors them; a test enforces both agreement and contrast            | Tailwind needs CSS variables, tests need numbers                                                                        |
| D-010 | Python 3.12 in CI                                                                                                             | Closest to the Colab runtime                                                                                            |
| D-011 | Playwright serves the build under `/Trees-vs-breathe/`, the Pages subpath                                                     | A wrong asset base path fails the smoke test instead of the live site                                                   |

### Open questions

- **Q-001 (blocks the P0 exit).** GitHub Pages has to be switched on once: repository Settings → Pages → Build and deployment → Source: GitHub Actions. The workflow's token cannot do this itself.
- **Q-002.** The repository had no commits, so the first push made `claude/relaxed-lamport-aefen3` the default branch (confirmed on GitHub). Keep it, or create `main` from it?
- **Q-003.** No licence chosen for the code yet. MIT is common for hackathon entries. Your call.
- **Q-004 (needed by P3).** Three real Hong Kong streets for the presets: narrow (H/W ≈ 3), medium (≈ 1.5), wide (≈ 0.5).

## P1 — Live solver core (plan)

Goal: one D2Q9 lattice Boltzmann solver in three implementations (NumPy, JAX, browser) that pass the textbook benchmarks, agree with each other, and show the street-canyon vortex live.

### Sources to verify first (recorded in `docs/sources.md`)

- [ ] Hou, Sterling, Chen and Doolen 1996: the Smagorinsky form for LBM (effective relaxation time), and the value of Cs we adopt
- [ ] Guo, Zheng and Shi 2002: the forcing scheme. Needed already in P1 for the body-force Poiseuille case; P2 reuses it for crown drag
- [ ] Ghia, Ghia and Shin 1982: centreline velocity tables for the lid-driven cavity at Re 100 and 1000
- [ ] Oke 1988: H/W thresholds between isolated roughness, wake interference and skimming flow
- [ ] Krüger et al. 2017, _The Lattice Boltzmann Method_: half-way bounce-back, velocity inlet, outflow and free-slip boundaries

### Python reference (`python/treesvb/solver2d/`)

- [ ] `docs/solver.md`: equations, lattice units and the conversion to physical units, boundary conditions, the stability limit (lattice velocity ≤ 0.08), and the effective Reynolds number
- [ ] NumPy D2Q9: BGK with Smagorinsky, Guo forcing, pull streaming, half-way bounce-back on a solid mask, velocity inlet, zero-gradient outlet, free-slip top, periodic option; float64 and float32
- [ ] JAX version of the same kernel, jit-compiled and written with a batch axis so `jax.vmap` works for the P4 dataset
- [ ] Blow-up guard shared by every implementation: detect NaN or runaway velocity, restore the last good state, lower the lattice velocity
- [ ] Benchmarks in pytest writing `results/benchmarks/*.json`: Poiseuille relative L2 error below 1% at H ≥ 32 cells; cavity within 2% (Re 100) and 5% (Re 1000) of Ghia; mass conservation
- [ ] NumPy against JAX on every benchmark, within 0.5%

### Browser (`apps/web/src/sim/`)

- [ ] CPU: TypeScript port of the kernel in a Web Worker (Float32Array A-B buffers)
- [ ] GPU: WGSL compute shaders (pull collide-stream, boundaries), A-B buffers, several sub-steps per frame; a render pass with colour maps; a particle pass moving a few thousand wind markers
- [ ] Engine selection with a real adapter probe (`requestAdapter()`), device-lost handling, and quiet fallback to the CPU worker
- [ ] Golden outputs: Python writes small steady benchmark fields to `tests/golden/`; Vitest checks the CPU worker against them (within 0.5%); Playwright checks the WGSL kernel in headless Chromium if a software WebGPU adapter is available, and otherwise through a `?selftest` page I ask you to open on your phone
- [ ] Design screen v1: the empty street with live wind particles and a speed field, an H/W slider, and readouts of the effective Reynolds number and lattice velocity, tagged "Simulated"
- [ ] Regime sweep over H/W (0.3 to 3): count vortices in the time-averaged stream function, compare with Oke 1988 and with one vortex in skimming flow and stacked vortices in deep streets; `results/street/regimes.json`
- [ ] First "How we know" cards (benchmarks), read from `results/benchmarks/*.json`

### Exit

Benchmark JSON green in CI for NumPy, JAX and the CPU worker, the GPU kernel checked (headless or on a phone), and a screenshot of the street vortex.

### Risks

- Headless WebGPU may not run in the container or on CI runners. Then the GPU check moves to the self-test page on real phones.
- Cross-implementation agreement within 0.5% only makes sense on steady, laminar cases; turbulent canyon flow diverges between float32 implementations after enough steps. Golden comparisons use the steady benchmarks and short fixed-step canyon runs.
