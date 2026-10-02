# Trees vs Breath: master build prompt

> Paste this whole document as the first message of a Claude Code session connected to the new repository, or add it to the repo and ask Claude to read and follow it.

## 0. Your role and the goal

You are the lead engineer building **Trees vs Breath**, an entry for HacKU 2026 in the Deep Technology track, answering Problem Statement 3 (quoted in section 2). The goal is to win. That means a working, beautiful and scientifically honest web app that judges can open on their own phones, plus the evidence and pitch materials that prove it works.

One-line pitch: *Everyone says plant more trees. In a narrow Hong Kong street, a tree can make the air at your nose dirtier. Trees vs Breath tests a street's trees before anyone plants them.*

Tagline for the method: **AI proposes, physics verifies, the wind tunnel judges.**

I (the user) have Google Colab Pro with an NVIDIA A100 (80 GB). Use it for all heavy GPU work through the protocol in section 10. You cannot run Colab yourself: you write the notebooks, I run them and bring the outputs back.

## 1. How to work

1. First, save this document to the repo root as `BRIEF.md` (if it is not already there). Create `CLAUDE.md` holding the working rules in this section, so every later session follows them.
2. Build in the phases of section 12, in order. Each phase ends with a runnable demo and passing tests. Do not start a phase until the previous one meets its exit criteria.
3. Before each phase, write a checklist plan in `docs/progress.md`. Tick items as you finish them, and record decisions and open questions there.
4. Verify by running things, not by assuming. Run the unit tests, the benchmark suite, the production build, and a Playwright smoke test that takes screenshots of every screen. Then look at the screenshots.
5. Commit in small, meaningful steps with clear messages, and push at the end of every phase.
6. Never invent a number. Every constant, dataset and claim comes from one of two places:
   - a cited source (author, year, table or page, URL, access date);
   - our own dated computation.

   If you cannot verify a source, for example because the network blocks it, mark it `UNVERIFIED` in `docs/sources.md` and tell me.
7. Tag every model output in the app as simulated. Keep `docs/assumptions.md` and the in-app "What the model leaves out" list current.
8. Ask me only when you are blocked: a Colab GPU run, a file you cannot download, or a decision with a large trade-off. When you hand me a Colab job, keep working on anything that does not depend on it.
9. Write code and documentation in plain, direct English, with no filler, no marketing tone and no emoji. Comments explain why, not what.
10. Pin dependency versions. Check the licence of every library and dataset before using it, and record it in `docs/sources.md`.

## 2. The problem statement (verbatim)

From the HacKU 2026 problem statements README: *"Every statement below uses the same four fields: Challenge, Scope requirement, Potential directions, Evidence. The Potential Directions are provided as examples only; you don't have to follow them and are free to come up with your own. You should define the user, the setting, the data and the method."*

**3. Deep Technology Problem Statement: Test the Change Before You Make It**

**Challenge.** Changing a physical system is expensive to get wrong in the world, and cheap to get wrong on paper. Build something that lets someone explore a change before committing money, space or materials, by turning a scientific or engineering relationship into an experiment or a decision tool they can actually use.

**Scope requirement.** Model one small system, with at least two adjustable inputs and one practical constraint. Demonstrate a trade-off between two outcomes — the system must not be able to improve both at once. You choose the system, the inputs, the outputs and the interface.

**Potential directions (excerpt, "Checking it against something real").** Build the bench as well as the model: one measured case that the model has to reproduce, and what you do when it does not. A model whose inputs are things you can measure with a phone, a tape and a thermometer, and nothing else. Two configurations run side by side, with the value you would choose and the reason stated.

**Evidence.** Check the model against a known relationship or a reference case, and show the check. Then compare at least two alternative configurations and say which you would choose, and why. Label anything simulated, and state which physical effects your model leaves out.

## 3. The product

**User.** Whoever decides what to plant on a street: a district council, the Highways Department's tree teams, a developer's landscape designer, or a residents' group arguing for trees.

**Setting.** One Hong Kong "street canyon": a street between two continuous rows of buildings, on a hot afternoon, with traffic.

**Decision.** What to plant, where, and how dense: no trees, sparse or dense trees, one row or two, low hedges, or a mix.

**The system.** A 2D vertical cross-section of the street, with the wind blowing across it. This is the case where fumes are hardest to clear, and it matches the central section of a long street. The cross-section contains:
- buildings on both sides, height H, street width W;
- the carriageway with traffic in the middle;
- a pavement on each side;
- tree crowns and hedges.

**Inputs.**
- Street (scenario): H, W, pavement widths, the street's compass direction, date and time, weather (from the Hong Kong Observatory), and wind speed at roof height.
- Design (what the user changes):
  - crown width, crown height, and crown base height;
  - crown density, which also stands in for tree spacing along the street;
  - rows: none, one (which side) or two;
  - hedge height and hedge density.

**Practical constraint.**
- Trunks and hedges fit only where the pavement is wide enough.
- Crowns must clear the carriageway headroom for double-decker buses. Look up the Highways Department or tree-management requirement; until it is verified, mark the value as an assumption.
- Crowns cannot pass through buildings.

The design controls stop at these limits and say why.

**Outcomes.**
1. **Heat:** UTCI (°C) on each pavement at the chosen hour, plus the hours per day in "strong heat stress" or worse (UTCI above 32 °C).
2. **Fumes:** the pedestrian exposure index on each pavement. This is the time-averaged dimensionless concentration c⁺ over the breathing zone (1.0–2.0 m height) across the pavement width. The app reports it as a ratio to the same street with no trees.

**The trade-off.**
- A bigger, denser crown shades more pavement, but its drag blocks the wind that flushes the street.
- Shade lowers heat stress; drag traps fumes.
- Present this as a Pareto frontier: once a design is on the frontier, more shade always costs more fumes.
- If a mix (for example trees plus a hedge) beats the bare street on both outcomes, that is a finding (the frontier moved). It is not a contradiction: show it and explain it.

## 4. Requirements map (acceptance)

| Statement asks | Feature | Where it shows |
| --- | --- | --- |
| Explore a change before committing money, space or materials | Plant, move and resize trees and hedges on a real street, live | Design screen |
| Turn a scientific or engineering relationship into a usable tool | Lattice Boltzmann airflow, tracer transport, sun geometry and UTCI behind simple controls | Design screen, How we know |
| One small system | One street cross-section | Everywhere |
| At least two adjustable inputs | Crown size, density, position, hedge height | Design screen |
| One practical constraint | Pavement width, bus headroom, buildings | Design controls and badges |
| A trade-off that can't be improved both ways | Heat against fumes, with the Pareto frontier | Trade-off screen |
| Check against a known relationship or a reference case | Benchmarks, flow regimes, CODASC wind-tunnel data, 3D runs on the A100 | How we know |
| Compare two or more configurations and choose | Side-by-side comparison, a chosen design and a stated reason | Compare screen, report |
| Label simulated; state what is left out | "Simulated" tags, left-out list, assumptions with sources | Everywhere, How we know |
| Inputs from a phone, a tape and a thermometer | Phone mode: compass for street direction, tilt angle for building height, paced or taped width, thermometer reading | Street screen |

## 5. Physics: airflow and fumes

### 5.1 Live 2D solver (browser)

- **Method.** D2Q9 lattice Boltzmann with BGK collision and a Smagorinsky sub-grid model in the standard LBM form (Hou et al. 1996). Cite the value of Cs you use (typically 0.1–0.17).
- **Body forces.** Use the Guo forcing scheme (Guo, Zheng and Shi 2002) for porous drag in tree crowns and hedges:

  ```
  f_crown = −(λ/2) |u| u      (force per unit mass)
  ```

  Here λ is the crown's pressure-loss coefficient (1/m), the porosity measure used by CODASC. Check the factor and the definition against the Gromke and Ruck papers. Convert λ between wind-tunnel scale and full scale using the model scale. In the UI, map sparse, medium and dense crowns to cited λ values.
- **Boundaries.**
  - Inlet: velocity profile matching CODASC's approach flow (read their documentation).
  - Top: free-slip.
  - Outlet: zero-gradient or convective.
  - Ground and buildings: half-way bounce-back.
- **Fumes.**
  - A passive tracer solved with a D2Q5 advection–diffusion lattice.
  - Effective diffusivity = ν_t / Sc_t + molecular diffusivity. Sc_t ≈ 0.7; cite the value (for example the Tominaga and Stathopoulos 2007 review).
  - Sources: line sources at road level, matching CODASC's source arrangement.
- **Normalisation.** Use the same dimensionless concentration as CODASC, so every comparison is like with like:

  ```
  c⁺ = c · u_H · H / (Q/l)
  ```

  u_H is the wind speed at roof height and Q/l is the release per metre of street.
- **Units and stability.**
  - Default resolution H = 48 cells; adapt it to the device.
  - Keep the lattice velocity at or below 0.08.
  - Report the effective Reynolds number.
  - Detect NaN or blow-up and recover automatically by restoring the last good state and lowering the time step. The demo must never crash.
- **Outputs.**
  - Time-averaged fields (exponential moving average plus a fixed averaging window), with convergence monitored.
  - Breathing-zone probes on both pavements.
  - Pedestrian wind speed (fed to UTCI).
- **Implementation.**
  - WGSL compute shaders with A-B buffers and a pull scheme, several sub-steps per frame.
  - A render pass with colour maps.
  - A compute pass that moves a few thousand marker particles to show the wind.
- **Fallbacks, both selectable with `?engine=gpu|cpu`:**
  1. A TypeScript CPU version of the same algorithm in a Web Worker, at lower resolution.
  2. If even that is too slow, pre-recorded frames.

### 5.2 Python reference solver

- A NumPy version (CPU, for tests) and a JAX version (GPU, for the A100) of exactly the same 2D algorithm.
- Use `jax.vmap` to run hundreds of street configurations in one batch for dataset generation.
- A cross-check test proves the browser GPU solver, the CPU worker and the Python reference agree on the benchmark cases to within 0.5%. Store golden outputs for this.

### 5.3 3D reference (A100 only)

- D3Q19 or D3Q27 LES for 2–4 CODASC configurations: an empty street plus tree avenues, with perpendicular wind.
- Reproduce their wind-tunnel geometry, approach flow and sources.
- Spend a short spike choosing between Autodesk's XLB (JAX) and our own JAX D3Q19. Check the licence and API first, and record why you chose.
- Budget about 1 hour of A100 time per run. Start coarse and refine. As a sizing guide: about 50 million cells is roughly 10 GB in single precision.
- Outputs:
  - wall and pavement concentrations at CODASC's measuring points;
  - the centre-plane fields, so the 2D solver can be compared with 3D;
  - decimated fp16 fields for an optional 3D view.

## 6. Physics: sun, shade and heat

1. **Sun position.** The NREL SPA algorithm (Reda and Andreas 2004), or NOAA's algorithm if you document its accuracy. Test against `pvlib` (target: within 0.1°).
2. **Shade in the cross-section.**
   - Take the street's compass direction and work out the sun's profile angle in the cross-section plane:

     ```
     tan(profile) = tan(altitude) / cos(sun azimuth − street normal azimuth)
     ```

   - Shadows come from roof edges and crowns.
   - Crowns pass a cited fraction of sunlight that depends on density. Label it as an assumption, sourced from published leaf-transmission values.
3. **Radiation.**
   - Split global radiation (from the Observatory) into direct and diffuse with a cited correlation, such as Erbs or Reindl.
   - Compute absorbed short- and long-wave radiation for a standing person: direct sun if sunlit, diffuse sky scaled by sky-view factor, and reflections and long-wave from walls and ground. This is a simplified version of SOLWEIG (Lindberg et al. 2008).
   - Then:

     ```
     Tmrt = (S_str / (ε σ))^0.25 − 273.15
     ```

   - Surface temperatures use a documented simple approximation, marked as an assumption.
4. **UTCI.**
   - Use the operational polynomial (Bröde et al. 2012), ported to TypeScript from a licensed reference implementation. `pythermalcomfort` is MIT-licensed. Test it against that implementation across a grid of inputs (target: within 0.1 °C).
   - UTCI expects wind at 10 m height. Convert the solver's pedestrian wind with a log profile, and document this.
   - Show UTCI stress categories in plain words.
5. **Weather presets.** Hourly Observatory data for one documented very hot day and one typical July day (temperature, humidity, global radiation, wind). Store them with dates and sources.

## 7. The AI

1. **Dataset.**
   - A Latin hypercube over the design and street inputs:
     - H/W from 0.3 to 3;
     - crown geometry, density and rows;
     - hedge height and density;
     - pavement widths.
   - Above the Reynolds-independence threshold, c⁺ and u/u_H do not depend on wind speed. Use this to drop wind speed as an input, and test that the claim holds for our solver.
   - Run the JAX reference on the A100 in batches; aim for 3,000–10,000 configurations.
   - Hold out a test set and an out-of-distribution region (for example the largest H/W).
2. **Models (PyTorch, trained on the A100).**
   - **Scalar model:** an ensemble of 5 MLPs predicting the pavement exposure on both pavements and the pedestrian wind. The ensemble spread is the uncertainty.
   - **Field model:** a U-Net predicting the time-averaged c⁺ and wind-speed fields on a normalised 128 × 64 grid, for instant previews of any design.
3. **Accuracy (report the actual numbers, never tune on the test set).**
   - Targets: test R² ≥ 0.95, median relative error ≤ 10%, and FAC2 ≥ 0.95 against the solver on pavement exposure.
   - Report the out-of-distribution results separately.
4. **Out-of-distribution guard.** Check that inputs are inside the training box and that the distance to the nearest training samples is within bounds. If not, show "Outside what the AI was trained on — run the physics" and offer the live solver.
5. **Design search.**
   - NSGA-II over the design variables, with constraint handling, on the surrogate.
   - Objectives:
     - minimise heat (mean UTCI on the pavements, or strong-heat-stress hours);
     - minimise the fume ratio.
   - Return the Pareto set, its knee, and the presets "coolest without dirtier air", "cleanest air" and "balanced".
   - Then **verify the top designs with the real solver** in the browser, and show the predicted and simulated values side by side.
6. **Browser inference.**
   - Export to ONNX at fp16, each model ≤ 10 MB.
   - Run with `onnxruntime-web`: the WebGPU backend first, wasm as fallback.

## 8. Evidence: the "How we know" screen and `docs/validation.md`

Every check is a card with a chart and its numbers. The numbers are read from `results/*.json` files written by the test and Colab pipelines, never typed by hand. `scripts/validate.ts` (or `python -m treesvb.validate`) regenerates `docs/validation.md` from the same files.

1. **Solver benchmarks.**
   - Channel flow against the exact Poiseuille solution (relative L2 error below 1% at H ≥ 32 cells).
   - The lid-driven cavity at Re 100 and 1000 against the centreline tables of Ghia et al. (1982) (within 2% and 5%).
   - Tracer conservation (imbalance below 0.5%).
   - GPU, CPU and Python agreement (within 0.5%).
2. **Street physics.** The vortex structure as H/W rises (Oke 1988): one trapped vortex in skimming flow, and stacked vortices in very deep streets. Show the sweep.
3. **Reynolds sensitivity.** Pavement exposure changes by less than 10% when Re doubles.
4. **The measured reference case (CODASC).**
   - Measured against simulated at the wall measuring points, for the empty street and for tree avenues of different density.
   - Report FAC2, FB and NMSE (Chang and Hanna 2004).
   - Compare with the urban acceptance criteria of Hanna and Chang (2012): FAC2 ≥ 0.30, |FB| ≤ 0.67, NMSE ≤ 6. Verify these thresholds against the paper.
   - Do it twice: the 2D solver at the centre plane, and the A100 3D LES (aim for FAC2 ≥ 0.5).
   - If the model misses, say so, and show what you did. Calibrate at most one parameter (the crown λ mapping) on one case, then predict the rest.
5. **Direction checks against the literature.**
   - In narrow streets with cross-wind, trees should raise pavement exposure, and low hedges between road and pavement should lower it.
   - Sources: the Abhijith et al. 2017 review in Atmospheric Environment (University of Surrey), and Gromke and Ruck.
   - If the model disagrees, investigate before shipping, and report what you found.
6. **2D against 3D.** Centre-plane agreement between the live solver and the A100 runs.
7. **Sun and heat.** Solar position against `pvlib`; UTCI against `pythermalcomfort`.
8. **The AI.**
   - Parity plots and metrics on the test set and the out-of-distribution set.
   - Agreement between the "Design for me" picks and the physics verification.
9. **What the model leaves out (always visible):**
   - 3D effects such as junctions, short streets and wind along the street (partly covered by the 3D runs);
   - NO–NO₂–O₃ chemistry (the fumes are a passive tracer);
   - pollution caught by leaves (deposition);
   - cooling by evaporation from leaves;
   - buoyancy from sun-heated walls;
   - turbulence from moving traffic;
   - real-scale Reynolds numbers;
   - traffic changing over the day.

## 9. Data

| Data | Source | Notes |
| --- | --- | --- |
| Wind-tunnel concentrations for streets with and without trees (28 configurations: aspect ratio, wind direction, tree arrangement, stand density, crown porosity) | CODASC, codasc.de (Karlsruhe Institute of Technology; Gromke and Ruck) | The reference case. Read its definitions of c⁺ and λ first. The site may be blocked here; if so, ask me to download it into `data/codasc/` |
| Hourly temperature, humidity, wind, global solar radiation | Hong Kong Observatory open data (data.gov.hk and the Observatory's open-data API) | Weather presets |
| Roadside and general-station NO₂ | EPD air quality data (data.gov.hk, aqhi.gov.hk) | Context page. A government press release gives the 2023 roadside NO₂ annual average as 66 µg/m³, against an objective of 40 µg/m³ (confirm) |
| Traffic counts | Transport Department, Annual Traffic Census | Relative release between streets |
| Building footprints and heights | Lands Department, CSDI portal (3D spatial data) | Street presets; street atlas (stretch) |
| Air Ventilation Assessment guidance | Planning Department (Hong Kong's AVA system) | Context: Hong Kong already assesses ventilation for big developments (confirm the current document) |

Record every file's source URL, access date, licence and SHA-256 in `data/README.md`.

**Street presets.** Pick three real Hong Kong streets with the user: narrow (H/W ≈ 3), medium (≈ 1.5) and wide (≈ 0.5). Measure them from the Lands Department or CSDI data, or with Hong Kong's GeoInfo Map measuring tool. Until they are measured, label them "example street, assumed dimensions".

## 10. Colab A100 protocol

Notebooks live in `colab/`. They import the repo's Python package, so there is one source of truth for the physics.

| Notebook | Purpose | A100 time | Outputs |
| --- | --- | --- | --- |
| `01_reference_2d.ipynb` | High-resolution 2D benchmarks, Reynolds sensitivity, 2D CODASC cases | 10–30 min | `results/reference2d/*.json`, small PNG figures |
| `02_codasc_3d.ipynb` | 3D LES of 2–4 CODASC cases | 1–3 h | `results/codasc3d/*.json`; `public/data/3d/*.bin` (fp16, ≤ 15 MB in total) |
| `03_dataset.ipynb` | Batched 2D runs over the design space | 1–2 h | Dataset on Drive (not committed); `results/dataset/manifest.json` (committed) |
| `04_train_surrogate.ipynb` | Train the MLP ensemble and the U-Net, evaluate, export | 30–60 min | `public/models/*.onnx`; `results/surrogate/metrics.json`; parity plots |
| `05_street_atlas.ipynb` (stretch) | Run many real streets through the surrogate and verify a sample | 30 min | `public/data/atlas.json` |

Rules for every notebook:
1. The first cell runs `!nvidia-smi`, checks for an A100, and prints library versions.
2. Pinned installs, for example `jax[cuda12]` and `torch` at fixed versions.
3. Get the code by cloning the repo (if it is public) or uploading a zip. Never put a token in a committed notebook.
4. Mount Google Drive and write to `/content/drive/MyDrive/trees-vs-breath/runs/<notebook>/<UTC timestamp>/`.
5. Write a `manifest.json` with the git commit, parameters, seeds, versions, GPU, wall time, and the SHA-256 of every output.
6. The last cell prints exactly which files to download and where in the repo each one goes. When I bring them back, you verify the checksums and wire them in.
7. Every notebook has a CPU smoke mode (tiny grid, a few runs) that CI executes, so the pipeline is tested without a GPU.
8. Keep committed artifacts small: each model ≤ 10 MB, 3D data ≤ 15 MB in total. Datasets stay on Drive.

Use this format when you hand me a job:

> **Colab job:** `03_dataset.ipynb` · A100 · about 90 min
> 1. Open the notebook in Colab, choose Runtime → A100.
> 2. Run all cells.
> 3. Download `<files>` from Drive and put them in `<paths>`, then reply "done".

Order: start `01` when the Python reference passes its tests (end of phase 2). Start `03` and `04` once `01` agrees with the browser solver. `02` can run in parallel.

## 11. The app

### 11.1 Screens

1. **Start.**
   - A live simulation of a narrow Hong Kong street with one tree, running behind the question "Plant a tree — cooler street or dirtier air?"
   - Buttons: "Test a street" and "Presentation mode".
2. **Street.**
   - The three presets, or custom H, W, pavement widths and street direction.
   - **Phone mode**, using a phone, a tape and a thermometer:
     - the compass gives the street's direction;
     - tilting the phone to the roofline from a taped or paced distance gives the building height, using h = d · tan θ + eye height, with its uncertainty shown;
     - the thermometer reading gives the air temperature.
   - The date, time and weather preset.
3. **Design (the core screen).**
   - The live cross-section, with layers you can toggle:
     - fumes (heat-map);
     - wind (moving particles);
     - shade band;
     - a UTCI strip along each pavement.
   - Tools to add, drag, resize and thicken trees and hedges.
   - A time-of-day slider that moves the sun, and a wind-speed control.
   - Per-pavement readouts: **Heat** (UTCI °C with the category in words) and **Fumes** (exposure against the street without trees, %), shown as ranges.
   - Constraint badges.
4. **Trade-off.**
   - The Pareto chart (heat against fumes) of the designs the AI swept, with your design marked.
   - Tap any point to preview its field from the U-Net.
   - "Design for me", with the three presets.
   - "Check with physics", which runs the real solver on the picks and shows predicted against simulated.
5. **Compare.**
   - Up to four designs side by side: field thumbnails and a metrics table.
   - The chosen design, with a one-sentence reason.
6. **How we know.** The section 8 cards, the left-out list, and the assumptions with their sources.
7. **Hong Kong.**
   - Roadside against general-station NO₂ compared with the objective (EPD).
   - Heat-stress context from the Observatory.
   - Air Ventilation Assessment context.
   - The street atlas (stretch).
8. **Report.** A one-page printable or PDF summary for a district council or residents' group.
9. **Presentation mode.**
   - A full-screen guided story (section 14), stepped with the arrow keys or a clicker.
   - Every state preloaded, so it works with no network.

### 11.2 Design system

- **Look and feel.**
  - Professional and human-made: editorial calm with signage-like clarity.
  - No brown or blue page backgrounds. A near-white light theme and a true dark theme.
  - Typeface: Atkinson Hyperlegible Next, plus its Mono.
- **Colour has meaning, and only one meaning each:**
  - one accent, deep green, for the user's design and trees;
  - fumes: a sequential violet-grey ramp;
  - heat: a sequential yellow-to-red ramp;
  - wind: neutral light particles.
  - Check every palette for colour-vision deficiency and WCAG AA contrast.
- **Charts.** One axis per chart. Label directly where possible. Every chart has a table view and carries its units in the header.
- **Words.**
  - Plain words first, units second; every term explained on tap.
  - Ranges, not false precision.
  - A "simulated" tag on every model number.
- **Layout and motion.**
  - Phone first and usable one-handed, with touch targets of at least 44 px.
  - Respect `prefers-reduced-motion`.
- **Languages and offline use.**
  - English and Traditional Chinese (繁體中文) from one strings file.
  - A PWA: a service worker caches the app, the models and the data, so it works offline at the venue.

### 11.3 Performance budgets and fallbacks

- **Budgets.**
  - App JavaScript ≤ 600 KB gzipped, not counting the ONNX runtime.
  - First interaction within 3 s on a mid-range phone over 4G.
  - The live solver at ≥ 30 fps at default resolution on a 2023 mid-range Android phone and on an iPhone, with adaptive resolution and sub-steps.
- **Fallbacks.**
  - Solver: WebGPU, then the CPU worker, then pre-recorded frames.
  - ONNX runtime: WebGPU, then wasm.
  - Every failure degrades quietly with an explanation and never shows a blank screen.

## 12. Build phases and exit criteria

- **P0 — Setup.**
  - Monorepo scaffold: the web app, the Python package, `colab/`, `docs/`.
  - CI: lint, typecheck, unit tests, Python tests, notebook smoke tests.
  - GitHub Pages deployment; `BRIEF.md`, `CLAUDE.md` and the docs skeleton.
  - *Exit:* CI green; the deployed page loads.
- **P1 — Live solver core.**
  - D2Q9 in WebGPU, the CPU worker and the Python reference.
  - Poiseuille and cavity benchmarks pass in all three, and they agree.
  - An empty street shows its vortex; an H/W slider; the regime test.
  - *Exit:* benchmark JSON green, and a screenshot showing the vortex.
- **P2 — Trees, hedges and fumes.**
  - Porous zones with Guo forcing; the D2Q5 tracer; sources and probes; c⁺; averaging.
  - The CODASC loader and the 2D comparison with FAC2, FB and NMSE.
  - The direction checks and the Reynolds sensitivity test.
  - Hand me `01`.
  - *Exit:* the comparison table is generated, and the direction checks pass or come with a written analysis.
- **P3 — Sun, shade and heat.**
  - Solar position, shading, crown transmission, Tmrt, UTCI, the Observatory presets and the readouts.
  - Tests against `pvlib` and `pythermalcomfort`.
  - *Exit:* tests green, and the Design screen shows heat and fumes moving in opposite directions as crowns grow.
- **P4 — The AI.**
  - Colab `02` (in parallel), `03` and `04`.
  - ONNX integration, ensemble uncertainty and the out-of-distribution guard.
  - The Pareto sweep, "Design for me" with NSGA-II, and the physics verification.
  - *Exit:* metrics reported (and meeting the targets, or honestly short of them), and the Trade-off screen works offline.
- **P5 — Decision and evidence.**
  - The Compare, How we know (generated from the results JSON), Hong Kong and Report screens, and `docs/validation.md` generation.
  - *Exit:* every row of section 4 is visibly met in the app.
- **P6 — Win kit and polish.**
  - Presentation mode, Traditional Chinese, offline PWA, an accessibility pass, and performance tuning on real phones (ask me to test on mine).
  - A README written as a real project page with screenshots, plus `docs/pitch.md`, `docs/qa.md`, a Playwright-recorded backup video of the full demo (60–90 s), and the one-page report.
  - *Exit:* section 15 is fully ticked.
- **Stretch goals, only after P6:**
  - a 3D street view (three.js) of the A100 fields;
  - oblique wind directions from 3D runs;
  - the street atlas: many Hong Kong streets on a map, each coloured by its recommended planting;
  - gradient-based design through a differentiable JAX solver.

The cloud container has no GPU. Test WebGPU code with headless Chromium flags where they work; otherwise rely on the CPU path, the cross-implementation tests and my phone tests. Playwright tests use `?engine=cpu`.

## 13. Repo layout

```
apps/web/                 Vite + React + TypeScript (+ Tailwind)
  src/sim/                WGSL shaders, GPU solver, CPU worker, units, probes
  src/sun/                solar position, shading, Tmrt, UTCI
  src/ai/                 ONNX inference, ensemble, OOD guard, NSGA-II
  src/screens/            Start, Street, Design, TradeOff, Compare, HowWeKnow, HongKong, Report, Present
  src/i18n/               en.json, zh-Hant.json
  public/models/          *.onnx
  public/data/            presets, weather, results used by the app
python/treesvb/           solver2d (numpy, jax), solver3d, geometry, forcing, scalar,
                          codasc, metrics (FAC2, FB, NMSE), dataset, train, export, validate
colab/                    01–05 notebooks
results/                  JSON from tests and Colab runs (the single source for every number shown)
data/                     raw sources with README (provenance, licence, checksums)
docs/                     BRIEF.md, validation.md, assumptions.md, sources.md, progress.md, pitch.md, qa.md
tests/                    vitest, pytest, playwright
.github/workflows/        ci.yml, pages.yml
```

## 14. Pitch kit

**Presentation-mode story (4 minutes):**
1. **0:00–0:20. Hook.** "Everyone says plant more trees. In a narrow Hong Kong street, a tree can make the air at your nose dirtier."
2. **0:20–0:45. The numbers.**
   - Roadside NO₂ against the objective (confirmed figures only).
   - Summer heat stress.
   - Hong Kong already runs air ventilation assessments for major projects (confirm the scope), but nothing tests street trees.
3. **0:45–2:00. Live.**
   - The narrow street: plant a tree, and the fumes pool while the shade spreads.
   - Add a hedge.
   - Open the trade-off chart, press "Design for me", then "Check with physics".
4. **2:00–3:00. Evidence.**
   - The benchmarks.
   - The CODASC scatter plot with its FAC2 band.
   - 3D against 2D.
   - The AI's accuracy.
5. **3:00–3:40. Decision.** What we would plant on each of the three streets and why. Then the left-out list.
6. **3:40–4:00. Close.** "Test the change before you plant it."

**Likely questions (`docs/qa.md`, with answers backed by our numbers):**
- Why 2D?
- Why should we trust it?
- Should Hong Kong cut trees? No: the right green in the right place.
- Don't trees clean the air?
- Where is the AI, and why not just optimise with the physics?
- What about evaporation cooling?
- How does this compare with an official Air Ventilation Assessment?

**Backup plan.**
- The offline PWA.
- The recorded video.
- Preloaded presentation states.
- A QR code to the GitHub Pages URL.
- A second device.

## 15. Definition of done (the judge's checklist)

- [ ] Opens on a phone from a QR code; works offline.
- [ ] Live street simulation at ≥ 30 fps on a mid-range phone.
- [ ] Growing crowns lowers heat and raises fumes; the trade-off chart shows the frontier.
- [ ] The constraint is enforced and explained.
- [ ] At least two configurations compared, with a stated choice and reason.
- [ ] How we know shows the benchmarks, the CODASC comparison with metrics (2D and 3D), the direction checks and the AI's accuracy, all with real numbers from `results/`.
- [ ] Every model number is tagged simulated; the left-out list and the assumptions with sources are visible.
- [ ] README, `validation.md`, `sources.md` and `assumptions.md` are complete; nothing is unverified without being flagged.
- [ ] Presentation mode, backup video and one-page report are ready.
- [ ] English and Traditional Chinese.

## 16. Sources to start from (confirm each one before relying on it)

- CODASC database: [research.tue.nl entry](https://research.tue.nl/en/publications/codasc-a-database-for-the-validation-of-street-canyon-dispersion-/); data at www.codasc.de.
- Trees against hedges in street canyons: [University of Surrey via ScienceDaily (2017)](https://www.sciencedaily.com/releases/2017/05/170516104745.htm); the Abhijith et al. 2017 review in Atmospheric Environment.
- Hong Kong roadside NO₂, 2023: [government press release](https://gia.info.gov.hk/general/202402/07/P2024020600615_448215_1_1707296293714.pdf).
- To look up and cite in the code:
  - Hou et al. 1996 (LBM Smagorinsky);
  - Guo, Zheng and Shi 2002 (forcing);
  - Gromke and Ruck (tree crowns, λ);
  - Oke 1988 (street-canyon regimes);
  - Ghia et al. 1982 (cavity benchmark);
  - Tominaga and Stathopoulos 2007 (turbulent Schmidt number);
  - Chang and Hanna 2004, Hanna and Chang 2012 (evaluation metrics and criteria);
  - Reda and Andreas 2004 (NREL SPA);
  - Lindberg et al. 2008 (SOLWEIG);
  - Bröde et al. 2012 (UTCI);
  - Erbs or Reindl (diffuse fraction);
  - the Hong Kong Planning Department's Air Ventilation Assessment guidance.

Start now with P0. When P0 is done, show me the deployed URL and your P1 plan.
