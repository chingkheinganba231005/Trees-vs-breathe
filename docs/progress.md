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
- **Q-004 (resolved 2026-10-03).** The user chose Wing Lok Street (narrow), Nathan Road (medium) and Yen Chow Street (wide); measured in `results/streets/presets.json`.
- **Q-005 (resolved 2026-10-03).** Wing Lok Street measures H/W 4.4, beyond the H/W 2 the live model has been checked for. The user chose a Colab run of the street at its true shape on a fine grid, shown as a recorded result beside the live approximation (D-030).

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
- With C_s = 0.1 the street blew up at Re 10 000 and above; C_s = 0.17 is stable from Re 2000 to 50 000 (`results/street/stability.json`). Rerun with the final collision (D-028) on 2026-10-03: C_s = 0.17 still stable everywhere; C_s = 0.1 now fails at Re 5000 and 10 000 and holds at 2000, 20 000 and 50 000.
- The mean vortex of a single street turned the wrong way: the top of the street moved against the wind at about u_ref, and road fumes collected on the windward wall. In 2D the vortex shed from the first block's upwind edge stays over the street. The regime check had only counted vortices, so it passed anyway; it now also checks the rotation. Inflow fluctuations of 20% at roof height did not help; one street upwind did at H/W 1. At H/W 2 a run with one narrow street upwind (2.5H from the edge, superseded) still turned the wrong way, while the street on its own turned correctly, so distance alone does not decide. Every case at least 3H behind the edge turned correctly, which is now the rule (D-019, `results/street/upwind.json`). H/W 3 is only 8 cells wide at H = 24 and goes to the Colab job at H = 48; the Design slider stops at 2 until then.
- The regime check's "street floor with the wind" measure stopped telling the regimes apart once the vortex turned the right way: corner eddies at the foot of both walls carry the floor flow with the wind over a large part of the floor at every H/W, so the measure no longer separated H/W 0.3 from H/W 1 (`results/street/regimes.json` keeps reporting it). It is replaced by measures that follow the regime definitions: the top of the street moves with the wind in skimming and deep streets, and that flow weakens as the street narrows from H/W 0.3 to 1 (Oke 1988).
- Headless Chromium's default shell loses a WebGPU device once a canvas is configured; the full Chromium build with Vulkan on SwiftShader keeps it. Real GPUs are not affected.
- The production CSS minifier writes `#fff` for `#ffffff`, which the canvas colour reader did not accept.

### Decisions

| ID    | Decision                                                                                                     | Why                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| D-012 | NumPy and JAX share one step function written against an array module                                        | One algorithm, two backends, nothing to keep in sync                                                  |
| D-013 | JAX streams with shifts and masks plus a small gather, not one big gather                                    | XLA's CPU gather was the bottleneck; a test checks the result equals the map exactly                  |
| D-014 | Inlet and outlet columns are set from the previous state of their neighbours                                 | Keeps the GPU kernel free of read-after-write races between threads                                   |
| D-015 | Live street: Re 20 000, C_s 0.17, u_ref 0.05, H = 48 cells on WebGPU and 24 on the CPU (superseded by D-024) | From the stability sweep; C_s within the brief's range                                                |
| D-016 | Uniform inflow until the CODASC approach-flow profile is wired in (P2)                                       | No unverified profile exponent is assumed                                                             |
| D-017 | Evidence colours are neutral (ink and grey); series differ by mark (line or open markers)                    | Green, violet-grey and yellow-to-red each already carry one meaning in the app                        |
| D-018 | CODASC raw files are fetched by a script with checksums and not committed                                    | Its terms forbid modifying the material and only grant non-commercial scientific use with attribution |
| D-019 | The studied street starts at least 3H behind the upwind edge of a row of equal blocks                        | A street close to the edge sits under the first block's shed vortex in 2D and turns the wrong way     |

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
- [x] CODASC comparison results (Colab job `01_reference_2d`, run 20261003T050408Z, 24 cells per H): meets the urban criteria over all ten cases; the windward wall near the ground and the wide street with trees do not agree (analysis in `docs/codasc.md`)
- [x] Direction checks: trees raise and a central hedge lowers leeward pavement exposure; both pass
- [ ] Reynolds sensitivity: pavement exposure changes by less than 10% when Re doubles. In the third Colab run (first regularised collision) the tree-free W/H 1 street meets it at 24 cells; the dense-crown street and the 48-cell runs miss (analysis in `docs/codasc.md`)
- [x] Follow-up Colab run (20261003T055628Z): every study at 24 and 48 cells per H, a calibration per grid, run lengths scaled to the grid, and a settling measure per run
- [x] A collision with more margin near τ = ½: regularised, with the bulk stress relaxed fully, in all four implementations (D-028), goldens regenerated; on the thin double shear layer plain BGK blows up at every Reynolds number tried and the regularised collision at none, and outside the absorbing layers the street's largest step-to-step flicker is below BGK's and its average somewhat above (`results/benchmarks/collision_margin.json`)
- [x] Averaging windows four times longer (D-029) and the comparison again at 24 and 48: Colab run 20261003T085700Z, made with the first regularised collision; every run stable, the urban criteria met at both grids, the hedge direction not established
- [ ] The studies again with the current collision (bulk stress relaxed fully, BGK in the layers)
- [ ] Deep streets at 48 cells per H: H/W 2 holds two stacked vortices; H/W 3 held two in the BGK run and one in the third run (`results/street/regimes_h48.json`). The live app runs at 24 cells on every device (D-024), so its slider stops at 2
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
- Dragging the greenery stuttered on a desktop (reported by the user on 2026-10-03). Every slider event rebuilt the drag field, uploaded all of it and a zero-filled copy of the running means to the GPU, so a drag sent several megabytes per event. Changes are now applied at most once per frame, only the rows that changed are uploaded, and the means are cleared on the GPU. A browser check that counted uploads for a burst of slider events confirmed one small upload per frame (scratch measurement; the numbers are in the commit message).
- The live street ran at different speeds on different devices (reported by the user on 2026-10-03): each engine took as many steps per frame as it could, and the two engines used different grids, so a step was a different length of time. Both now use one grid and the shared clock (D-024, D-025). On the way, the CPU worker turned out to sit idle between frames and to spend as long reading the fields for each frame as on two steps; it now steps continuously on its own clock, and the field readers are written out per direction like the step, which made them several times faster.
- The first CODASC run showed that the resolution study compared grids at unequal physical time: run lengths were fixed in steps, so twice the grid meant half the flow-through times. Run lengths now scale with the grid, and each run reports how far its average still moves (`settling`).
- The first regularised collision kept the bulk stress at the shear rate. The full benchmark run caught it: the lid-driven cavity at Re 1000 never settled because of a two-step flicker at the lid's corner, and in the street the flicker grew. Relaxing the bulk stress fully fixed both (D-028); its docs had claimed it removed the odd-even ripple, which the measurement did not support.
- The regularised collision with full bulk relaxation then failed the street studies run on 2026-10-03: at 24 cells the street grew an instability at the foot of the outlet from about step 22 000 and failed near 26 000, with or without absorbing layers (BGK had run it stably). Plain BGK inside the absorbing layers fixed it; the street and the CODASC tree case run 100 000 steps (D-028). The Colab notebook had been pushed in between, so the user was asked not to run it until the fix was in.
- When greenery is added or moved, the flow carries on from its current state, like planting into a street where the wind already blows; only the running means restart. Changing the street shape rebuilds the grid and restarts everything.

### Decisions

| ID    | Decision                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-020 | The CODASC street is modelled behind one upwind street, like the live app                                                                                                              | The single 2D street turns the wrong way; the comparison tests the choice                                                                                                                                                                                                                                                                                                                                 |
| D-021 | One calibrated parameter: Sc_t, on the tree-free W/H 1 case only                                                                                                                       | The brief allows one; the other nine cases are predictions                                                                                                                                                                                                                                                                                                                                                |
| D-022 | The comparison runs on Colab at H = 24 and 48                                                                                                                                          | About 30 runs of 120 000 steps: hours on this CPU, about half an hour on an A100                                                                                                                                                                                                                                                                                                                          |
| D-023 | Colab results come back as one zip that the notebook downloads; `python -m treesvb.colab unpack` checks it before writing                                                              | Asked by the user on 2026-10-03. One file to send instead of several to place by hand, and nothing reaches the repo unless every checksum matches. Replaces the per-file hand-off in BRIEF.md section 10                                                                                                                                                                                                  |
| D-024 | The live street runs at 24 cells per building height on every engine                                                                                                                   | Asked by the user on 2026-10-03: the same model on every device. 24 is where the live street's stability was studied and every CODASC case ran stably; at 48 the dense crown and Re 40 000 blew up, and the CPU could not run 48 at a usable speed. Departs from BRIEF.md 5.1 (default 48, coarser on the CPU) until a more stable collision is validated at 48                                           |
| D-028 | Regularised collision (Latt and Chopard 2006): shear stress relaxes as in BGK, the higher moments and the bulk stress relax fully (Dellar 2001); plain BGK inside the absorbing layers | The 48-cell runs blew up with τ₀ within 0.0004 of ½. Mass, momentum and shear stress match BGK (test); the higher moments, which BGK carries nearly undamped near τ = ½, are dropped. Relaxing the bulk stress fully removed a corner flicker; BGK in the layers removed an instability at the outlet's foot. A few lines in each of the four implementations, unlike MRT or cumulant collisions          |
| D-029 | Averaging windows four times longer (320 000 steps at 24 cells), and a case shared by two studies runs once per Colab session                                                          | The halves of the old window differed by 12–150%; if the scatter falls as 1/√T, four times the window halves it. Rerunning shared cases would cost a quarter of the time, and the solver is deterministic on the same hardware                                                                                                                                                                            |
| D-025 | A shared playback clock: one flow-through time H / u_ref per second of wall time, as fixed lattice steps per frame from an accumulator; `?speed=` scales it                            | The same speed on every device that can keep up; a slower one runs slower and the Design screen says by how much. A lattice step cannot be stretched to the frame time (that changes the physics), so frames take a varying number of fixed steps, as game engines do for physics. One building height per second is a calm pace to watch; the CPU worker steps continuously on its own copy of the clock |

### Exit

The CODASC comparison table is generated, and the direction checks pass or come with a written analysis.

Met on 2026-10-03: the table is in `docs/validation.md` and both direction checks pass. The Reynolds check and the resolution question stay open in the follow-up run; neither blocks phase 3.

## P3 — Sun, shade and heat

Goal: the time of day moves the sun, shade falls from the roofs and the crowns, and each pavement gets a heat reading (UTCI) next to its fumes reading, so the trade-off is visible: crowns that cool the pavement can hold fumes in.

### Sources to verify first

- [x] Solar position: NOAA (Meeus); `pvlib` 0.16.1 (BSD-3-Clause) for the tests, run in a separate environment
- [x] Crown transmission of sunlight: Takács et al. (2016), Table 3 (A-018)
- [x] Diffuse fraction of global radiation: Erbs et al. (1982) as in pvlib
- [x] Mean radiant temperature of a standing person: six-directional method and SOLWEIG defaults (Ouyang et al. 2022 for Thorsson et al. 2007; UMEP manual); the ISO 6946 surface resistance stays `UNVERIFIED`
- [x] UTCI operational polynomial (Bröde et al. 2012) in `pythermalcomfort` 4.6.0 (MIT)
- [x] Wind at 10 m from pedestrian wind: UTCI's log law with roughness 0.01 m (Lee, Park and Mayer 2025)
- [x] Hong Kong Observatory data for a very hot day and a typical July day: open data are daily (King's Park), so the hours are rebuilt (A-022); DATA.GOV.HK terms
- [x] Sizes of Hong Kong street trees: Highways Department trunk sizes matched to AFCD measured trees (A-014)
- [ ] Bus headroom over carriageways (carried over from P2)

### Street

- [x] Three presets measured from Lands Department data (`python -m treesvb.hkstreets`, `results/streets/presets.json`); Street screen with drawings to scale and "Open in Design"
- [ ] Custom street: H, W, pavement widths, compass direction
- [ ] Phone mode: compass for the direction, tilt to the roofline for the height (h = d tan θ + eye height, with its uncertainty), thermometer reading
- [x] Weather presets measured (`python -m treesvb.hkweather`, `results/weather/presets.json`)
- [x] Weather preset and hour controls on Design; a street without a preset gets a direction choice, measured streets keep their bearing

### Sun and shade

- [x] Solar position in TypeScript within 0.1° of `pvlib` (`results/sun/position.json`); a Python port waits until the dataset needs it
- [x] Profile angle in the cross-section; shadows from roof edges and crowns; crown transmission by density (`apps/web/src/sun/canyon.ts`)

### Radiation and heat

- [x] Direct and diffuse split of global radiation, matching `pvlib`
- [x] Simplified SOLWEIG mean radiant temperature at each pavement; surface temperatures by a steady balance (A-017 to A-021)
- [x] UTCI polynomial in TypeScript, within 0.1 °C of `pythermalcomfort` over a grid of inputs (`results/sun/utci.json`)
- [x] Pedestrian wind converted to 10 m with UTCI's log law (A-023); the solver's pavement wind is wired in with the Design readouts
- [x] UTCI stress categories in plain words, both languages

### App

- [x] Design: per-pavement Heat (UTCI °C and category, sun or shade, radiant temperature, 10 m wind) next to the Fumes readouts, with the shade the greenery gives against the bare street; the street drawn to scale with the ground in sun and the sun's direction
- [x] Shade band and UTCI strip on the live canvas; a wind-speed control (the wind now comes from the weather preset)
- [x] Tree rows along the kerbs (A-024), the default on measured streets: CODASC's central row had put Nathan Road's local trees over the carriageway, where their shade missed the pavements
- [x] Trees sized in metres on the real streets: a typical local roadside tree (A-014, A-015), the default for presets; the wind-tunnel avenue stays as an option
- [ ] Lanes and the breathing zone sized in metres on the real streets in the live app (the Wing Lok run already uses them: A-012, A-016)
- [x] Wing Lok Street at its measured shape, recorded on Colab at 96 cells and shown beside the live view (D-030); the run had not settled, and the app says so
- [x] Constraint badges: pavement width and bus headroom
- [x] Evidence cards: solar position against `pvlib`, UTCI against `pythermalcomfort`, and the collision margin

### Decisions

| ID    | Decision                                                                                                                                                                                                                                               | Why                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-026 | Street presets: W wall to wall and H of the tallest block on each street front (outlines within 3 m), medians over points 5 m apart; Nathan Road and Yen Chow Street measured over 300 m centred on the EPD monitoring stations, Wing Lok Street whole | The brief asks for presets measured from Lands Department or CSDI data; the stations tie the presets to measured air quality; the 3 m rule follows from the data's stated position accuracy      |
| D-027 | A preset deeper than the checked range is shown at the deepest checked shape, with a note                                                                                                                                                              | The live model is only trusted where its vortex structure has been checked (Q-005 asks the user how to go further)                                                                               |
| D-030 | Wing Lok Street is also run at its measured H/W on Colab at 96 cells per building height (22 across the street), with no greenery, local trees and a hedge, and Design shows the recorded result beside the live view                                  | Chosen by the user (Q-005). 96 cells put 5 cells across the 2.7 m pavement zone; the spin-up is doubled because a deep street turns over slowly near the ground (`python -m treesvb.streetruns`) |

### Exit

Tests green, and the Design screen shows heat and fumes moving in opposite directions as crowns grow.

- [x] Tests green: sun position, UTCI and irradiance against their references; heat model unit tests; the end-to-end heat test with screenshots
- [ ] Heat and fumes in opposite directions: both readouts sit side by side on Design, but no study yet checks the direction across designs. The P4 sweep does (Trade-off screen), so this check moves there
- [x] Custom street starter on the Street screen: choose a street width, building height and pavement widths, then open it directly in Design with the live solver
- Carried into P4 or later: phone mode, shade band and UTCI strip on the live canvas, constraint badges, lanes and zone in metres in the live app

## P4 — The AI

Goal: a surrogate of the live solver that answers in milliseconds, so the app can sweep thousands of designs for the trade-off between heat and fumes, find good designs, and preview their fields. Every answer carries its spread, the app refuses inputs outside the training data, and the picks are checked with the real solver.

### Dataset (`python -m treesvb.dataset`, `colab/03_dataset.ipynb`)

- [x] Designs as the Design screen makes them: H/W on the slider's 18 positions from 0.3 to 2; trees (one row in the middle or one near each wall, width, distance from the wall, crown base and top, λH, sideways shift) or a hedge (height, width, λH, shift); ranges in A-025 (D-031, D-032)
- [x] Latin-hypercube blocks, stratified so every street shape gets one batch of 32: 20 tree designs, 10 hedges and 2 bare streets from independent disturbances (A-026); the test block and the out-of-distribution block (H/W 2.2, 2.5, 3) come from their own seeds; training blocks run until a time budget (D-033)
- [x] The live app's settings: 24 cells per H, uniform inflow 0.05, Re 20 000, C_s 0.17, Sc_t from `results/trees/calibration.json`, CODASC lanes closing in with the width, absorbing layers; batched with `jax.vmap`; the batched run matches the solver run by run (`tests/python/test_dataset.py`)
- [x] Stored per run: c⁺ and wind speed in the breathing band per column and per half of the averaging window (any pavement width can be read; the halves measure the noise), and c⁺, speed and velocity over the street on a 64 × 128 grid in float16
- [x] CPU smoke mode in CI; summary (`results/dataset/summary.json`) and manifest with each block's checksum committed, the blocks stay on Drive
- [x] Run length from time series of the live street at H/W 1 (bare, and dense crowns along both kerbs): the bare street's fumes settle within the spin-up; the street with dense crowns keeps nearly all its fumes for 50 000 steps and levels off near 100 000, so the spin-up is 96 000 steps; each run records the share of fumes its street still keeps, and runs still filling are flagged (D-033)
- [x] Hand `03` to the user; bring back the summary (run `20261003T144828Z`, summary and manifest copied to `results/`)
- [ ] The live readout and the CODASC runs start from an empty street too: the CODASC tree cases (40 000 steps spin-up) and the Design screen's fumes for crowns that close the street may read low until the street has filled. Measure on the next `01` run and show "still filling" on Design
- [ ] Reynolds independence, the reason wind speed is not an input: doubling Re moves the tree-free W/H 1 street's pavement exposure by 2% and 6% at 24 cells (threshold 10%), but the street with dense crowns by 13% and 22% (`results/trees/reynolds.json`); the app runs one Reynolds number at every wind speed, so the surrogate does too, and the dependence is listed under what the model leaves out

### Models (`colab/04_train_surrogate.ipynb`)

- [x] Training and export code (`python -m treesvb.surrogate`), notebook `04` with a CPU smoke mode run by CI after `03`'s; training uses the training blocks only, a tenth held back to choose the epoch; scores come from the exported ONNX files
- [x] Scalar model: an ensemble of 5 MLPs for the exposure on each pavement as a ratio to the bare street, and the pavement wind; the inputs are the geometry of the blocks a design puts in the street (D-034); the spread of the five is the uncertainty
- [x] Field model: a U-Net for c⁺ and wind speed on the 64 × 128 street grid, from the drag of the design drawn on that grid
- [x] Metrics on the test block (R², median relative error, FAC2) against the targets, with the noise of the solver's own averages beside them; the out-of-distribution block reported separately; parity plots; `results/surrogate/metrics.json` (export completed; the recorded metrics do not meet every target)
- [x] ONNX export with fp16 weights, each model at most 10 MB (`apps/web/public/models/`)

### App

- [x] `onnxruntime-web` 1.30.0, pinned, licences recorded: WebGPU first where the browser has it, wasm otherwise or if WebGPU fails; loaded only on the Trade-off screen (3.7 MB gzipped for wasm, 6.7 MB for WebGPU)
- [x] Out-of-distribution guard: inside the training box and near enough to training samples, or "Outside what the AI was trained on — run the physics"; in the search a design outside loses to any inside
- [x] Trade-off screen: Pareto chart of heat against fumes over a sweep, the bare street and the user's design (sent from Design) marked, any point's field from the U-Net, a table view; checked end to end in Chromium with stand-in models from the CPU smoke run (their numbers mean nothing)
- [x] "Design for me": NSGA-II on the surrogate (checked on ZDT1) with the presets "coolest without dirtier air", "cleanest air" and "balanced" (the knee)
- [x] "Check with physics": the CPU solver runs the chosen design in a worker for the dataset's run length, predicted beside simulated (D-036); "Open in Design" runs it live
- [x] Works offline: the models and onnxruntime ship with the app and nothing calls a server; a dependency-free service worker and web manifest cache the built app and runtime assets after the first visit (production preview verified)
- [ ] With the trained models: look at the Pareto fronts on the three streets, and check the picks with physics

### Colab handoff to finish the P4 set

- [x] The model zip from Colab is in place: `public/models/*.onnx`, a `guard.json`, and `results/surrogate/metrics.json`
- [x] The Trade-off screen has the real surrogate metrics loaded and the app shows the actual frontier instead of the stand-in smoke state
- [ ] The three-street Pareto sweep is reviewed and the picks are checked against the real solver
- [x] The surrogate metrics are reported in `docs/validation.md` and the app's How we know section before the P6 polish pass

The Colab exports are now present. The remaining P4 evidence task is to review the real frontier on Wing Lok Street, Nathan Road and Yen Chow Street and check the selected designs with physics. The recorded scalar and field metrics are loaded honestly, including `meets_targets: false`; this is evidence to improve, not a passing claim.

### Decisions

| ID    | Decision                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-031 | The dataset spans H/W 0.3–2, the Design slider's range; H/W 2.2, 2.5 and 3 form the out-of-distribution set                                                                                                         | The brief asks for 0.3–3, but the live street's vortex structure is checked only to H/W 2 at 24 cells (`results/street/regimes.json`, D-027), and the app never runs the solver beyond it. The surrogate is tested there, not trained                                                                                                                                                                             |
| D-032 | Designs follow the Design screen (trees or a hedge, H/W on the slider's positions); pavement width is not a run input, it is read after the run from the stored band                                                | Every sample is a design the app can make; 18 shapes (17 grids) keep the batches full and the compilations few; pavement width only changes which cells are averaged                                                                                                                                                                                                                                              |
| D-033 | Each run: 96 000 steps of spin-up and 96 000 averaged (200 H/u_ref each), sampled every 48 steps; training blocks of 576 runs start until `BUDGET_MIN` (150 min) has passed; the test block uses 9 of the 18 shapes | A street closed off by dense crowns keeps nearly all its fumes until its concentration has built up: at H/W 1 with dense crowns along both kerbs, street c⁺ was 92, 131 and 129 over steps 24–72k, 72–120k and 120–144k, against about 20 for the bare street (scratch time series, 2026-10-03). The noise left in the averages is measured from the two halves of every run and reported beside the test metrics |
| D-034 | The scalar model's inputs are the blocks a design puts in the street (edges as shares of W, bottom, top, log λH, H/W), not the Design controls                                                                      | Any layout the app draws maps onto them, including merged rows and shifted ones, and the out-of-distribution guard measures distance in the same space                                                                                                                                                                                                                                                            |
| D-035 | Models are exported with float16 weights that a Cast turns back into float32 inside the graph; the arithmetic stays float32                                                                                         | Half the size of float32 (BRIEF.md 7.6 asks for fp16), and every onnxruntime-web backend runs float32, while float16 kernels are missing from some wasm builds. The scores are computed from these files                                                                                                                                                                                                          |
| D-036 | "Check with physics" runs the CPU solver in a worker on the chosen design for the dataset's run length (96 000 + 96 000 steps) and divides by the dataset's bare street of the same shape                           | Like for like with the training data, so the comparison tests the surrogate rather than a shorter or differently averaged run. The CPU solver measured 213 steps/s on the 24-cell street in this container with other jobs running (about a quarter of an hour for a check); a laptop is faster, and a WebGPU check can follow                                                                                    |

## P5 — Decision and evidence

Goal: turn the design, the model checks and the street context into a decision tool, with the numbers and caveats exposed in the app and the printable summary.

### Decision screens

- [x] Compare: up to four designs side by side, with a chosen design and the reason stated, plus field thumbnails and the metrics table
- [x] How we know: benchmark cards, the CODASC comparison, the direction checks, and the left-out list, all generated from `results/*.json`
- [x] Hong Kong context: roadside air quality, summer heat stress and the AVA context
- [x] Report: a one-page summary for sharing with a district council or residents' group and a print-ready layout
- [x] `docs/validation.md` generated from the JSON results and checked into the repo

### App-level checks

- [x] Every model number is tagged simulated in the app and the docs
- [x] The app keeps the source and caveats visible: assumptions and left-out effects are listed in UI and docs
- [x] The app routes through the decision screens in the hash router and keeps the phase 5 navigation in place
- [x] Offline PWA shell: install manifest and service worker are present; production preview registers the worker and creates the app cache. A real phone offline launch and performance measurement remain team acceptance checks

### Exit

- [x] Every row of section 4 is visibly met in the app, with the decision path and evidence traceable from the screen to the results JSON (where available)
- [x] The project continues to meet the brief's evidence-and-decision requirement for P5

### Notes

- The Compare, Hong Kong and Report screens are now filled in as direct app views rather than placeholders so the phase 5 flow is complete in the browser.
- Remaining work after P5 is the broader P6 polish: offline PWA, accessibility refinement, the pitch kit and final presentation-mode pass.
- [x] Stretch notebook `05_street_atlas.ipynb`: screens the measured street presets through the trained surrogate, refuses out-of-range streets to physics, and hands off `apps/web/public/data/atlas.json` for a future atlas screen.
