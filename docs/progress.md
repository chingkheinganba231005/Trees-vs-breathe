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
- [x] Full-resolution results committed

### Browser (`apps/web/src/sim/`)

- [x] CPU solver in TypeScript, run in a Web Worker
- [x] WGSL kernel with A-B buffers and several steps per submit; a compute pass for 4096 wind markers; trails in a float texture; a compose pass for speed shading and buildings
- [x] Engine selection with a real adapter probe, device-loss fallback to the CPU, and `?engine=gpu|cpu`
- [x] Golden outputs (`python -m treesvb.golden`); Vitest checks the CPU solver and the streaming map; a Playwright project runs the WGSL kernel on a SwiftShader WebGPU adapter. Worst difference recorded in `results/benchmarks/browser_agreement.json`
- [x] Blow-up guard: health check, restore the last good state, lower the time step
- [x] Design screen v1: live street, H/W slider, wind and speed layers, the regime expected from the literature, model readouts tagged "Simulated", English and Traditional Chinese
- [x] Street studies (`python -m treesvb.street`): absorbing layers, stability, regime sweep over H/W 0.3 to 3
- [x] Full-resolution street results committed
- [x] "How we know" cards and `docs/validation.md`, both read from `results/`

### Found and fixed along the way

- The zero-gradient outlet fixed no pressure level, and mass built up (density up to 10% high). Replaced by a pressure outlet: equilibrium at density 1 with the neighbour's velocity.
- Copying the non-equilibrium part into the outlet one step late was unstable with τ close to ½, so the outlet uses the equilibrium part only.
- Sound from vortex shedding filled the domain with pressure noise of order the vortex pressure itself. Absorbing layers at the inlet, outlet and top remove most of it (`results/street/sponge.json`).
- Starting the street from rest sends a strong pressure pulse; runs start from uniform flow.
- With C_s = 0.1 the street blew up at Re 10 000 and above; C_s = 0.17 is stable from Re 2000 to 50 000 (`results/street/stability.json`).
- The mean vortex of a single street turned the wrong way: the top of the street moved against the wind at about u_ref, and road fumes collected on the windward wall. In 2D the vortex shed from the first block's upwind edge stays over the street. The regime check had only counted vortices, so it passed anyway; it now also checks the rotation. Inflow fluctuations of 20% at roof height did not help; one street upwind did at H/W 1. At H/W 2 a run with one narrow street upwind (2.5H from the edge, superseded) still turned the wrong way, while the street on its own turned correctly, so distance alone does not decide. Every case at least 3H behind the edge turned correctly, which is now the rule (D-019, `results/street/upwind.json`). H/W 3 is only 8 cells wide at H = 24 and goes to the Colab job at H = 48; the Design slider stops at 2 until then.
- The regime check's "street floor with the wind" measure stopped telling the regimes apart once the vortex turned the right way: corner eddies at the foot of both walls carry the floor flow with the wind over a large part of the floor at every H/W, so the measure no longer separated H/W 0.3 from H/W 1 (`results/street/regimes.json` keeps reporting it). It is replaced by measures that follow the regime definitions: the top of the street moves with the wind in skimming and deep streets, and that flow weakens as the street narrows from H/W 0.3 to 1 (Oke 1988).
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
| D-019 | The studied street starts at least 3H behind the upwind edge of a row of equal blocks     | A street close to the edge sits under the first block's shed vortex in 2D and turns the wrong way     |

### Exit

- [x] GPU kernel checked headless against the Python reference
- [x] Benchmark and street result files green and committed; CI green
- [x] Screenshot of the street vortex: time-averaged streamlines for H/W 0.3 to 2 (`docs/img/street-vortex-regimes.png`, from `results/street/regimes.json`)

### Still open from P1

- Performance on real phones (the brief's 30 fps target) can only be measured on a device; please open the Design screen and `selftest.html` on your phone when convenient.
- Time-averaged fields and breathing-zone probes in the browser are built in P2 together with the fumes.

## P2 — Trees, hedges and fumes

Goal: porous trees and hedges in the street, traffic fumes as a passive tracer, pedestrian exposure on both pavements, and the first comparison with the CODASC wind-tunnel measurements.

### Sources to verify first

- [x] CODASC (Gromke and Ruck, KIT): geometry, approach flow, line sources, taps, c⁺ and λ, file format, terms. Read in Gromke (2008, dissertation, open access at KIT) and Gromke and Ruck (2012, submitted version); details with page numbers in `docs/codasc.md`
- [x] How λ scales between wind tunnel and full scale: λ_full / λ_model equals the model scale (Gromke 2008, Eqs. 5.3–5.5); Gromke (2011) itself not needed
- [x] Turbulent Schmidt number: the CODASC literature reports 0.2–0.6 as best for RANS of this street (Gromke and Ruck 2012, p. 43); calibrated on one case instead of taken from Tominaga and Stathopoulos (2007), which stays unread
- [x] Hanna and Chang (2012): urban criteria FB, NMSE, FAC2 (secondary, OSTI 1639930; definitions from the BOOT paper)
- [x] Abhijith et al. (2017): trees can worsen, hedges improve pavement air in street canyons; its Table 3 gives the hedge of Gromke et al. (2016)
- [ ] Hong Kong guidance on clearance of tree crowns over carriageways (bus headroom)

### Physics

- [x] Porous drag F = −(λ/2) ρ|u|u with the velocity solved implicitly; `results/benchmarks/porous_lambda.json`: the momentum balance closes within 0.05%, and λ by CODASC's definition comes back within 3.2% at u = 0.05, the error shrinking as u² (compressibility)
- [x] D2Q5 tracer with diffusivity ν₀ + ν_t/Sc_t; conservation to round-off and a Gaussian pulse within 1.1% of the exact solution (`tracer_conservation.json`, `tracer_pulse.json`)
- [x] Line sources at road level in CODASC's layout; c⁺ = C u_H H / Q_l
- [x] CODASC power-law approach flow (exponent 0.30) in the Python studies; the live street keeps uniform inflow until its stability is rerun with the profile
- [x] Time-averaged concentration and pavement exposure in Python; on the GPU the running mean of the concentration is kept next to the velocity means
- [x] All four implementations carry drag and tracer; the golden case `street_trees` checks velocity and concentration (`browser_agreement.json`)

### Evidence

- [x] CODASC loader (`python -m treesvb.codasc fetch` with checksums) and the comparison study (`python -m treesvb.trees`)
- [ ] CODASC comparison results (Colab job `01_reference_2d`)
- [ ] Direction checks: trees raise and a central hedge lowers leeward pavement exposure (Colab job; code and smoke run ready)
- [ ] Reynolds sensitivity: pavement exposure changes by less than 10% when Re doubles (Colab job)
- [x] Colab notebook `01_reference_2d.ipynb`, smoke-tested on CPU

### App

- [x] Design screen: an avenue of trees (CODASC crowns, light or dense) or a hedge in the middle (Gromke et al. 2016 sizes); position, crown base and crown width sliders; drag sideways on the street; the drag changes on the running solver without a rebuild, on both engines
- [ ] Constraint badges: pavement width and bus headroom wait for the Hong Kong street presets and a verified headroom source (P3); greenery is already kept between the buildings
- [x] Fumes layer on the violet-grey ramp, drawn from the running mean on both engines, with a key that uses the same colours and theme; per-pavement exposure against the same street without greenery, shown as a range and tagged "Simulated" (A-013)
- [x] End-to-end test: the bare street settles, trees are added, and the comparison appears (`tests/e2e/smoke.spec.ts`, with `?averaging=0.25` to finish in time)

### Found and fixed along the way

- Copying the neighbour's populations into the tracer outlet fed their non-equilibrium part back and blew up with τ near ½; the outlet now takes the equilibrium at the neighbour's previous concentration and velocity.
- A trial CODASC run with a single street put fumes on the windward wall: the vortex turned the wrong way (see P1, D-019). Behind an upwind street the leeward wall came out close to the wind tunnel in trial runs; the committed numbers will come from the Colab job.
- Right next to each lane the fumes field shows grid-scale ripples: a point source in a cell with very little diffusion. In the screenshots they sit within a few cells of the lanes. In a trial run (scratch, not a committed result) spreading each source over three cells left the wall values practically unchanged, so the sources stay as they are.
- In the same trials the lowest taps on wall B read several times the measured value: a corner eddy at the foot of the windward wall holds fumes from the nearest lane, and a 2D model mixes it out too slowly. To be reported with the results, not tuned away.

### Decisions

| ID    | Decision                                                                  | Why                                                                              |
| ----- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| D-020 | The CODASC street is modelled behind one upwind street, like the live app | The single 2D street turns the wrong way; the comparison tests the choice        |
| D-021 | One calibrated parameter: Sc_t, on the tree-free W/H 1 case only          | The brief allows one; the other nine cases are predictions                       |
| D-022 | The comparison runs on Colab at H = 24 and 48                             | About 30 runs of 120 000 steps: hours on this CPU, about half an hour on an A100 |

### Exit

The CODASC comparison table is generated, and the direction checks pass or come with a written analysis.
