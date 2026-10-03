# CODASC: the wind-tunnel reference

CODASC ("COncentration DAta of Street Canyons") is a database of wind-tunnel concentrations in a street canyon with and without avenues of trees. Its authors are C. Gromke and B. Ruck, Laboratory of Building- and Environmental Aerodynamics, Institute for Hydromechanics (IfH), Karlsruhe Institute of Technology (KIT). It is the reference the brief names for phase 2.

Cite as: _CODASC data base, Laboratory of Building- and Environmental Aerodynamics, IfH, Karlsruhe Institute of Technology_; in figure legends: _© CODASC, KIT_. These are the database's own terms, read 2026-10-02. Use is allowed for personal, internal or scientific non-commercial purposes, and the material must not be modified. We therefore fetch the files with `python -m treesvb.codasc fetch` and check them against `data/codasc/SHA256SUMS`, and we do not commit them.

## What was measured

All facts below come from the sources listed at the end. The page numbers are those printed in the documents.

| Item                     | Value                                                                                                                                                                                    | Source                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Street                   | Two blocks of height H and depth H, street length L = 10 H; H = 0.12 m, L = 1.20 m                                                                                                       | Gromke 2008, p. 41                                            |
| Street width             | W/H = 1 and 2                                                                                                                                                                            | CODASC table; Gromke and Ruck 2012, p. 44                     |
| Wind                     | Directions 90°, 45° and 0° to the street axis                                                                                                                                            | CODASC table                                                  |
| Approach flow            | Power law U(z) = U(H) (z/H)^0.30; U(H) = 4.65 m/s, Re_H = 37 000                                                                                                                         | Gromke and Ruck 2012, p. 45, Eq. 2                            |
| Approach flow, tabulated | Mean speed and turbulence from z = 0.005 m to 0.52 m, wind tunnel 2 m wide and 1 m high                                                                                                  | CODASC page "Boundary Layer Profile"                          |
| Sources                  | Four line sources at street level, 1.42 m long (beyond the street ends), at 1.8 cm (x/H = 0.15) and 3.2 cm (x/H = 0.267) on both sides of the street axis; the same positions at W/H = 2 | Gromke 2008, pp. 42 and 78                                    |
| Measurement              | Taps 0.5 cm (x/H = 0.042) in front of wall A and wall B; the files hold c⁺ on a 100 × 7 grid of y/H from −5 to 5 and z/H from 0 to 1                                                     | Gromke 2008, p. 41; CODASC page "c+ data"; the files          |
| Normalised concentration | c⁺ = c u_H H / Q_l, with Q_l the tracer source strength per unit length                                                                                                                  | Gromke 2008, Eq. 5.7, p. 47; Gromke and Ruck 2012, Eq. 1      |
| Averaging                | 105 s per value                                                                                                                                                                          | Gromke 2008, p. 47                                            |
| Reynolds independence    | c⁺ shows no marked dependence on u_H for u_H ≥ 4.7 m/s (tested at 2.6, 4.7 and 6.6 m/s)                                                                                                  | Gromke 2008, p. 49                                            |
| Crowns, W/H = 1          | One lattice-cage block 0.5 H wide, centred in the street, from z = H/3 to z = H                                                                                                          | Gromke 2008, Fig. 6.1, p. 54                                  |
| Crowns, W/H = 2          | Two blocks 0.42 H wide, each 0.29 H from its wall, from z = H/3 to z = H                                                                                                                 | Gromke 2008, Fig. 6.33, p. 78; Gromke and Ruck 2012, p. 46    |
| Crown density            | λ = 80 m⁻¹ (pore volume 97.5%) and 200 m⁻¹ (96%), λ = Δp_stat / (p_dyn d)                                                                                                                | Gromke 2008, Eq. 5.2, p. 45; CODASC page "How to model trees" |
| Stand density            | ρ_s = 1: every cage cell filled, crowns touch; ρ_s = 0.5: every second cell filled                                                                                                       | Gromke 2008, p. 44                                            |

Wall A is the leeward wall of the upwind block when the wind blows across the street; wall B is the windward wall of the downwind block (CODASC page "c+ data", figure).

For wind along the street (0°), the A and B files of each case are byte-identical; the site says measurements at symmetric positions were averaged.

## What our 2D model compares

A 2D model can only represent wind across the street (90°), so the comparison uses the 10 cases at 90°: two street widths, each tree-free, and each with two crown densities at two stand densities. The model is a cross-section of an infinitely long street. CODASC's street is 10 H long, and its ends are ventilated by corner eddies. Gromke (2008, p. 55) reports concentrations about three times higher in the centre (−1.5 < y/H < 1.5) than near the ends. We compare against the centre of each wall, y/H = 0, at the five interior heights z/H = 1/6 to 5/6. The grid rows at z/H = 0 and 1 lie at or beyond the outermost taps, so we leave them out.

| Choice                                                                          | Why                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q_l is the total of the four sources per unit length                            | The sources say "source strength per unit length" without saying whether this means one line or all four; total is the natural reading of a single Q_l. A factor-four error would show up as a large bias. |
| Stand density 0.5 halves λ over the crown block                                 | A 2D section cannot hold gaps along the street; halving the drag keeps the drag per unit street length.                                                                                                    |
| The model runs at Re 20 000, the live solver's setting, not the tunnel's 37 000 | `results/trees/reynolds.json` measures how much the answer moves when Re doubles.                                                                                                                          |
| The measured wall data are without moving traffic                               | The example plot on the CODASC site matches Gromke (2008) Fig. 6.2 (p. 54), which p. 68 identifies as the case without moving traffic.                                                                     |

These choices are also listed in `docs/assumptions.md`.

## Results of the first comparison

Colab run `20261003T050408Z` on an A100 at 24 cells per building height, the CPU engine's grid. The tables are in `docs/validation.md`, section 3; this section says what they show. Numbers are left to those tables so they cannot drift from the results.

### What holds

- Over all ten cases together the model meets the urban criteria of Hanna and Chang (2012).
- On the leeward wall (A) of the W/H 1 street the model is close to the tunnel at every tap, with and without trees.
- Both direction checks pass: the avenue of trees raises the leeward pavement's exposure, and the hedge in the middle lowers it.
- At 48 cells per building height, streets with H/W 2 and 3 hold two stacked vortices with the upper one turning with the wind above, as Liu, Barth and Leung (2004) report. The live app runs at 24 cells on every device (D-024), where only H/W up to 2 has been checked, so its slider stops at 2.

### What does not

1. **The windward wall (B) near the ground.** At the two lowest taps the model is several times too high in every W/H 1 case, and too low further up. In a 2D section the small eddy in the corner at the foot of the windward wall is a closed recirculation, so fumes from the nearest lane leave it only by diffusion. In the tunnel the street has ends and the flow is three-dimensional and unsteady, which probably flushes the corner. On a grid twice as fine the excess shrinks but stays large. The app's windward pavement sits in this corner, so the exposure panel asks the user to treat its level with care.
2. **The calibration ends at the edge of its range.** NMSE falls all the way to the smallest Sc_t tried. The windward-foot excess dominates the error of the tree-free case, and more turbulent mixing drains the corner, so the calibration is compensating for a structural error; it also lowers wall B further up. Going below the range the CODASC literature reports for RANS (0.2 to 0.6, Gromke and Ruck 2012, p. 43) would tune the one free parameter against that error, so the range stays as it is.
3. **The wide street (W/H 2) with trees.** Two of the four tree cases put far more on the leeward wall than the tunnel, while the other two are close, and the difference follows neither crown nor stand density. In several of these runs the total tracer in the domain was still rising during the average (`tracer_total_drift` in `results/trees/codasc.json`), so they may not have settled. The next run measures settling directly.
4. **Reynolds sensitivity misses its target.** Doubling Re moves the windward pavement of the tree-free street (the same corner) and the leeward pavement of the tree street by more than the 10% the brief asks for.
5. **Grid resolution.** On a grid twice as fine the tree-free case moves much closer to the tunnel and the tree case moves away from it on wall A. That comparison was unfair: run lengths were fixed in steps, so the finer grid covered only half the flow-through times. Run lengths now scale with the grid (`trees.Run.at`), and every run reports how much its average still moves between the first and second half of the averaging window (`settling`).

### Second run: both grids, settling measured

Colab run `20261003T055628Z` (commit `1484bd9`) repeated every study at 24 and at 48 cells per building height, with run lengths matched in flow-through times, a calibration per grid and the settling measure. The tables are in `docs/validation.md`, section 3, one block per grid.

- At 24 cells every number repeats the first run exactly: on the same hardware and software the solver is deterministic.
- The averages have not settled. At 24 cells the first and second halves of the averaging window differ by tens of percent in the W/H 1 street, and in the W/H 2 street with dense trees by more than the average itself (the "Settling" column). The 2D street flow swings slowly, and a window of this length does not average the swings out. A difference between two cases smaller than their settling is not established.
- At 48 cells the cases that ran agree better with the tunnel than at 24, but four runs blew up: the dense crown at W/H 1 (in the comparison and the direction check), both runs at Re 40 000, and the tree-free street at 96 cells. At these settings the molecular relaxation time is very close to ½, where the BGK collision has almost no margin; only the Smagorinsky term keeps it stable, and only where the flow is sheared.
- The hedge in the middle of the W/H 2 street lowered the leeward pavement at 24 cells and raised it at 48. Both changes are smaller than the settling, so the model does not yet say which way a hedge works. The trees' effect at 24 cells is larger than the settling.
- The Reynolds check misses at 24 cells and could not be done at 48.

### What follows

1. A collision with more margin near a relaxation time of ½. Done: the regularised BGK collision runs in all four implementations (`docs/solver.md`, D-028), and on a stress test where plain BGK fails it holds.
2. Averaging windows four times longer (D-029), and the settling measure reported again.
3. The comparison again at 24 and 48 cells, in the Colab run prepared in `colab/01_reference_2d.ipynb`, together with Wing Lok Street at its measured shape.

Until then the live app runs at 24 cells on every device (`docs/progress.md`, D-024), and the numbers above are from the BGK runs.

## Sources

- Gromke, C. (2008). _Einfluss von Bäumen auf die Durchlüftung von innerstädtischen Straßenschluchten_. Dissertation, Universität Karlsruhe (TH), Institut für Hydromechanik, Heft 2008/2. Universitätsverlag Karlsruhe 2009, ISBN 978-3-86644-339-6. Licence CC BY-NC-ND 2.0 DE. https://publikationen.bibliothek.kit.edu/1000010154/688205, accessed 2026-10-02.
- Gromke, C. and Ruck, B. (2012). Pollutant concentrations in street canyons of different aspect ratio with avenues of trees for various wind directions. _Boundary-Layer Meteorology_ 144, 41–64. doi 10.1007/s10546-012-9703-z. Read in the submitted version at https://www.dora.lib4ri.ch/wsl/item/wsl:4284, accessed 2026-10-02.
- CODASC web pages: http://www.codasc.de, which redirects to https://www.umweltaerodynamik.de/bilder-originale/CODA/CODASC.html, accessed 2026-10-02.
