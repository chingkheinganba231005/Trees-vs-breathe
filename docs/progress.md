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
- [x] Deployed to GitHub Pages: run 37026963028 (commit `710a2dc`), build and deploy jobs both succeeded. The container's network blocks `*.github.io`, so the live URL was not fetched from here; instead the Playwright smoke test now serves the production build under the same `/Trees-vs-breathe/` subpath as Pages (28 of 28 pass). Confirmed on a real phone by the user on 2026-10-02

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

- **Q-001 (resolved 2026-10-02).** GitHub Pages switched on by the user (Source: GitHub Actions).
- **Q-002 (resolved 2026-10-02).** The user asked for a `main` branch; it was created from the P0 head.
- **Q-003 (resolved 2026-10-02).** MIT licence, at the user's request.
- **Q-004 (needed by P3).** Three real Hong Kong streets for the presets: narrow (H/W ≈ 3), medium (≈ 1.5), wide (≈ 0.5).

## P1 — Live solver core

Goal: one D2Q9 lattice Boltzmann solver in four implementations (NumPy, JAX, TypeScript, WGSL) that pass the textbook benchmarks, agree with each other, and show the street-canyon vortex live.

### Sources (recorded in `docs/sources.md`)

- [x] Hou, Sterling, Chen and Doolen (1994/1996): read on arXiv. Their C is C_s²; their printed closed form has a typo, so the formula is derived afresh and checked numerically
- [x] Guo, Zheng and Shi (2002, PRE): verified through the Li et al. (2016) review on arXiv
- [x] Ghia, Ghia and Shin (1982): Re 1000 through LLNL-TR-403164, Re 100 through a Nextjournal reproduction cross-checked with Mramor et al. (2013); the primary tables are not reachable from here
- [x] Oke (1988) through Buccolieri et al. (2020); Liu, Barth and Leung (2004) abstract for the deep-street check
- [x] Boundary conditions documented in `docs/solver.md` with Guo, Zheng and Shi (2002, Chinese Physics) and Xu and Sagaut (2013) instead of Krüger et al.

### Python reference (`python/treesvb/solver2d/`)

- [x] `docs/solver.md`: equations, units, boundary rules, absorbing layers, the guard
- [x] One step written against an array module (`core.py`), run by NumPy and by JAX (jit, `vmap`-ready); a precomputed streaming map holds every boundary rule
- [x] Benchmarks writing `results/benchmarks/*.json`: Poiseuille, cavity Re 100 and 1000 against Ghia, mass conservation, the eddy viscosity in uniform shear, the force correction of the stress, NumPy against JAX
- [ ] Full-resolution results committed (running from commit `f9140ce`)

### Browser (`apps/web/src/sim/`)

- [x] CPU solver in TypeScript, run in a Web Worker
- [x] WGSL kernel with A-B buffers and several steps per submit; a compute pass for 4096 wind markers; trails in a float texture; a compose pass for speed shading and buildings
- [x] Engine selection with a real adapter probe, device-loss fallback to the CPU, and `?engine=gpu|cpu`
- [x] Golden outputs (`python -m treesvb.golden`); Vitest checks the CPU solver and the streaming map; a Playwright project runs the WGSL kernel on a SwiftShader WebGPU adapter. Worst difference recorded in `results/benchmarks/browser_agreement.json`
- [x] Blow-up guard: health check, restore the last good state, lower the time step
- [x] Design screen v1: live street, H/W slider, wind and speed layers, the regime expected from the literature, model readouts tagged "Simulated", English and Traditional Chinese
- [x] Street studies (`python -m treesvb.street`): absorbing layers, stability, regime sweep over H/W 0.3 to 3
- [ ] Full-resolution street results committed (running)
- [x] "How we know" cards and `docs/validation.md`, both read from `results/`

### Found and fixed along the way

- The zero-gradient outlet fixed no pressure level, and mass built up (density up to 10% high). Replaced by a pressure outlet: equilibrium at density 1 with the neighbour's velocity.
- Copying the non-equilibrium part into the outlet one step late was unstable with τ close to ½, so the outlet uses the equilibrium part only.
- Sound from vortex shedding filled the domain with pressure noise of order the vortex pressure itself. Absorbing layers at the inlet, outlet and top remove most of it (`results/street/sponge.json`).
- Starting the street from rest sends a strong pressure pulse; runs start from uniform flow.
- With C_s = 0.1 the street blew up at Re 10 000 and above; C_s = 0.17 is stable from Re 2000 to 50 000 (`results/street/stability.json`).
- The mean vortex of a single street turned the wrong way: the top of the street moved against the wind at about u_ref, and road fumes collected on the windward wall. In 2D the vortex shed from the first block's upwind edge stays over the street. The regime check had only counted vortices, so it passed anyway; it now also checks the rotation. Inflow fluctuations of 20% at roof height did not help; one street upwind did (D-019, `results/street/upwind.json`).
- Headless Chromium's default shell loses a WebGPU device once a canvas is configured; the full Chromium build with Vulkan on SwiftShader keeps it. Real GPUs are not affected.
- The production CSS minifier writes `#fff` for `#ffffff`, which the canvas colour reader did not accept.

### Decisions

| ID    | Decision                                                                                  | Why                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| D-012 | NumPy and JAX share one step function written against an array module                     | One algorithm, two backends, nothing to keep in sync                                                  |
| D-013 | JAX streams with shifts and masks plus a small gather, not one big gather                 | XLA's CPU gather was the bottleneck; a test checks the result equals the map exactly                  |
| D-014 | Inlet and outlet columns are set from the previous state of their neighbours              | Keeps the GPU kernel free of read-after-write races between threads                                   |
| D-015 | Live street: Re 20 000, C_s 0.17, u_ref 0.05, H = 48 cells on WebGPU and 24 on the CPU    | From the stability sweep; C_s within the brief's range                                                |
| D-016 | Uniform inflow until the CODASC approach-flow profile is wired in (P2)                    | No unverified profile exponent is assumed                                                             |
| D-017 | Evidence colours are neutral (ink and grey); series differ by mark (line or open markers) | Green, violet-grey and yellow-to-red each already carry one meaning in the app                        |
| D-018 | CODASC raw files are fetched by a script with checksums and not committed                 | Its terms forbid modifying the material and only grant non-commercial scientific use with attribution |
| D-019 | The studied street is the second in a row of three equal blocks                           | A single street sits under the first block's shed vortex in 2D and turns the wrong way                |

### Exit

- [x] GPU kernel checked headless against the Python reference
- [ ] Benchmark and street result files green and committed; CI green
- [ ] Screenshot of the street vortex

### Still open from P1

- Performance on real phones (the brief's 30 fps target) can only be measured on a device; please open the Design screen and `selftest.html` on your phone when convenient.
- Time-averaged fields and breathing-zone probes in the browser are built in P2 together with the fumes.

## P2 — Trees, hedges and fumes (plan)

Goal: porous trees and hedges in the street, traffic fumes as a passive tracer, pedestrian exposure on both pavements, and the first comparison with the CODASC wind-tunnel measurements.

### Sources to verify first

- [ ] CODASC (Gromke and Ruck, KIT): geometry, approach-flow profile (tabulated on the site), line-source layout, measuring positions, c⁺ and λ definitions, file format; terms already read (non-commercial scientific use with attribution, no modification)
- [ ] Gromke (2011), vegetation modelling concept: how λ scales between wind tunnel and full scale
- [ ] Tominaga and Stathopoulos (2007): turbulent Schmidt number
- [ ] Chang and Hanna (2004) and Hanna and Chang (2012): FAC2, FB, NMSE and the urban acceptance criteria
- [ ] Abhijith et al. (2017): direction of the effect of trees and hedges in street canyons
- [ ] Hong Kong guidance on clearance of tree crowns over carriageways (bus headroom)

### Physics

- [ ] Porous drag f = −(λ/2)|u|u in crowns and hedges through the Guo forcing, with the velocity solved implicitly so dense crowns stay stable; check: a porous block across a channel must give back λ = Δp / (½ρu² d), CODASC's own definition
- [ ] D2Q5 advection-diffusion lattice for the tracer, diffusivity ν_t/Sc_t + D_mol; checks against an analytic diffusing pulse and tracer conservation (imbalance below 0.5%)
- [ ] Line sources at road level following CODASC's layout; c⁺ = c u_H H / (Q/l)
- [ ] CODASC approach-flow profile at the inlet, replacing the uniform inflow (assumption A-003)
- [ ] Time-averaged fields (moving average and a fixed window) with a convergence measure; breathing-zone probes on both pavements
- [ ] All four implementations, golden cases extended to trees and tracer

### Evidence

- [ ] CODASC loader (`python -m treesvb.codasc fetch` with checksums) and the 2D comparison at the centre plane: empty street at W/H 1 and 2, tree avenues at both crown densities and stand densities; FAC2, FB, NMSE against the Hanna and Chang criteria; at most one parameter calibrated on one case
- [ ] Direction checks: in a narrow street with cross-wind, trees raise and low hedges lower pedestrian exposure
- [ ] Reynolds sensitivity: pavement exposure changes by less than 10% when Re doubles
- [ ] Colab job `01_reference_2d.ipynb` for the high-resolution runs, handed over when the Python reference passes

### App

- [ ] Design screen: add, drag and resize trees and hedges; crown density; constraint badges (pavement width, bus headroom, buildings)
- [ ] Fumes layer (violet-grey ramp) and per-pavement exposure as a percentage of the same street without trees, shown as a range and tagged "Simulated"

### Exit

The CODASC comparison table is generated, and the direction checks pass or come with a written analysis.
