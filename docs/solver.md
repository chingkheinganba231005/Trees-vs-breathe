# The 2D solver

One algorithm, four implementations that must agree:

| Implementation               | File                                                    | Used for                                       |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| NumPy (float64)              | `python/treesvb/solver2d/core.py` via `numpy_solver.py` | Tests, golden outputs                          |
| JAX (float32 or float64)     | the same `core.py` via `jax_solver.py`                  | Long runs, Colab A100, batches with `jax.vmap` |
| TypeScript (float32 storage) | `apps/web/src/sim/cpu/solver.ts`                        | CPU worker in the browser                      |
| WGSL (float32)               | `apps/web/src/sim/gpu/shaders.ts`                       | WebGPU in the browser                          |

NumPy and JAX run literally the same step code. The TypeScript and WGSL versions are checked against golden outputs written by `python -m treesvb.golden` (`tests/golden/*.json`): the TypeScript streaming map must equal Python's exactly, and velocities must agree within 0.5% of the reference speed (`results/benchmarks/browser_agreement.json`).

## Lattice and units

D2Q9 with lattice spacing and time step 1, so the squared sound speed is c_s² = 1/3. Directions are numbered

```
6 2 5
3 0 1
7 4 8
```

with weights 4/9 (rest), 1/9 (axes) and 1/36 (diagonals). Arrays are indexed `[y, x]` with y = 0 at the ground.

The molecular viscosity is ν₀ = (τ₀ − ½)/3. A case fixes the Reynolds number Re = u_ref H / ν₀ and the lattice inflow speed u_ref, which sets τ₀. The lattice speed stays at or below 0.08 (BRIEF.md 5.1); the street uses 0.05.

## One step

1. **Stream (pull).** The population arriving at node x in direction i is read from the post-collision state at x − c_i. Every boundary rule only changes where that value is read from, so the rules live in one precomputed map (`domain.py`, `build_stream_map`; TypeScript `buildStreamMap`; inline in WGSL).
2. **Moments.** ρ = Σ f_i, ρu = Σ f_i c_i + F/2, where F = ρ g is the body force (Guo, Zheng and Shi 2002).
3. **Relaxation time.** τ₀, or with the Smagorinsky sub-grid model in the form of Hou et al. (1994):

   τ = ½ (τ₀ + √(τ₀² + 18√2 C_s² √Q / ρ)), with Q = Π:Π

   where Π = Σ c c (f − f^eq) + ½(F u + u F) is the non-equilibrium momentum flux with the forcing contribution removed (`core.flux`). This solves ν = ν₀ + C_s² |S| for the local strain rate |S| = √(2 S:S), using Π = −2ρ c_s² τ S. Hou et al.'s printed closed form has ν₀ where τ₀ belongs and a different prefactor, so the formula here is derived afresh and checked numerically: in uniform shear the solver's eddy viscosity must match C_s²|S| (`results/benchmarks/smagorinsky_shear.json`), and in a force-driven box without strain the corrected Π must vanish (`results/benchmarks/force_stress.json`).

4. **Regularised collision with the Guo forcing term** (Latt and Chopard 2006; bulk part after Dellar 2001).

   f_post = f^eq + (1 − 1/τ) w_i (9/2) (c_i c_i − I/3) : Π_d + ½ w_i [3(c_i − u) + 9(c_i·u) c_i] · F

   Π is the force-corrected non-equilibrium flux of step 3 and Π_d = Π − ½ tr(Π) I its trace-free part; for D2Q9 the middle term is w_i (9/2) [(c_x² − c_y²)(Π_xx − Π_yy)/2 + 2 c_x c_y Π_xy]. Written per moment, the Guo scheme relaxes the corrected non-equilibrium part of each moment at its own rate s and adds half the forcing moment, m_post = m^eq + (1 − s) m_neq + F_m/2; that is why the forcing enters at half weight here, and why plain BGK, with every rate equal to 1/τ, gives back the familiar (1 − 1/(2τ)) prefactor.

   Three choices differ from plain BGK (f_post = f − (f − f^eq)/τ + (1 − 1/(2τ)) w_i [...] · F):
   - Shear stress relaxes at 1/τ as in BGK, so the viscosity is unchanged; mass and momentum are conserved exactly (`tests/python/test_solver2d.py`).
   - The third and fourth moments are rebuilt as zero instead of relaxing at 1/τ. Near τ = ½ BGK lets them flip sign almost undamped every step, which is how the 48-cell street blew up. On the thin double shear layer of Minion and Brown (1997), with no sub-grid model, plain BGK fails at every Reynolds number tried and this collision at none (`results/benchmarks/collision_margin.json`).
   - The bulk (trace) part of the stress relaxes fully every step: a large bulk viscosity, which damps sound waves and leaves a slow, nearly incompressible flow alone (Dellar 2001). A first version kept the trace at the shear rate. It held a two-step flicker at the corner of the lid-driven cavity, which then never settled (Re 1000), and it raised the flicker in the street. With the trace relaxed fully the cavity converges as with BGK. In the street, outside the absorbing layers, the largest step-to-step flicker (at the roof corner) is lower than with BGK and the average flicker somewhat higher (`collision_margin.json`, `street_flicker`).

   - Inside the absorbing layers (step 5) the collision stays plain BGK. With the regularised collision there too, a street at 24 cells per building height grew a slow instability at the foot of the outlet: the outlet column copies its neighbour's velocity every step, and from about step 22 000 the corner between the ground and the outlet fed on itself until the run failed near step 26 000, with or without the layers. BGK ran that case stably, and in the layers the flow is only damped towards the far field, so nothing measured lives there. With this split the same street and the CODASC tree case run 100 000 steps.

   Plain BGK is also kept in `core.flow_step` for the collision benchmark.

5. **Absorbing layers.** Near open boundaries the density is relaxed towards 1:

   f_post += σ(x, y) (1 − ρ)/ρ · f^eq(ρ, u)

   which equals σ (f^eq(1, u) − f^eq(ρ, u)). σ ramps quadratically from 0 to σ_max = 0.05 over one building height at the inlet and the top and two at the outlet. This is a damping term of the kind analysed by Xu and Sagaut (2013, arXiv 1203.6350). Without it, sound from vortex shedding reflects between the inlet, the ground and the top and fills the street with pressure noise; `results/street/sponge.json` measures the difference.

6. **Boundary columns.** Inlet and outlet columns are set after collision from the previous state of their neighbours, which keeps the GPU kernel free of races:
   - inlet: f^eq(ρ_neighbour, u_inlet), a velocity inlet;
   - outlet: f^eq(1, u_neighbour), a pressure outlet.

   This is the equilibrium part of the non-equilibrium extrapolation of Guo, Zheng and Shi (2002, Chinese Physics 11, 366). The non-equilibrium part is left out on purpose: with τ near ½ it changes sign every step, and copying it one step late made the outlet unstable in our tests on 2026-10-02.

## Boundary rules in the streaming map

For a source (sx, sy) = (x − c_x, y − c_y), in this order:

1. x outside the grid: `periodic` wraps; `wall` is half-way bounce-back (the opposite direction at the node itself).
2. y outside the grid: `periodic` wraps; `wall` is bounce-back; `moving` is bounce-back plus 2 w_i ρ₀ (c_i · u_w)/c_s² with ρ₀ = 1; `freeslip` reads the y-mirrored direction at (sx, top row), a specular reflection.
3. A solid source is bounce-back.

Solid nodes and the inlet and outlet columns read themselves. Half-way bounce-back puts walls half a cell outside the last fluid row, so a channel of N rows is N cells wide.

## The street canyon

A row of equal buildings of height H and depth B = H stands on a no-slip ground, with streets of width W between them; the studied street is the last one. Enough streets go in front of it that its upwind wall stands at least 3H behind the row's upwind edge: one street at H/W 1 or wider, two at H/W 2 and 3. The domain extends 3H upstream of the row, 6H downstream and 5H up; the top is free-slip. The inflow is uniform at u_ref, and the boundary layer grows from the ground over the upstream fetch. Runs start from uniform flow, because starting from rest sends a pressure pulse of relative size u_ref/c_s through the domain. These lengths are assumptions (`docs/assumptions.md` A-002).

Why streets upwind: flow separates at the upwind edge of the first building, and in 2D the vortex it sheds can stay over the streets close behind it; its backward flow then turns their mean vortex the wrong way. At H/W 1 the street on its own did exactly that (`results/street/upwind.json`): the top of the street moved against the wind, and in a trial fumes from the road collected on the windward wall instead of the leeward wall. Inflow fluctuations of 20% at roof height (the CODASC approach flow) did not help. The effect is not a simple function of distance: at H/W 2 the street on its own turned correctly, while in a superseded run one narrow street upwind (2.5H from the edge) left it turning the wrong way. Every case with the studied street at least 3H behind the edge turned correctly, so that is the rule. In 3D, as in the wind tunnel, the shed vortex breaks up, so the effect belongs to 2D.

The live solver uses H = 24 cells on both engines (WebGPU and the CPU worker; D-024 in `docs/progress.md`), Re = 20 000 and C_s = 0.17. Both advance one flow-through time H / u_ref per second of wall time on a shared clock (`apps/web/src/sim/clock.ts`, D-025). The choice of C_s rests on the stability sweep in `results/street/stability.json`. C_s = 0.17 lies inside the range 0.1–0.17 given in BRIEF.md 5.1; Hou et al. tested C = C_s² = 0.0025, 0.01 and 0.04.

## Blow-up guard

Every 90 frames (GPU) or every frame (CPU worker), the maximum speed is checked. NaN or a speed of 0.4 lattice units or more restores the last healthy state and lowers the time step: the inflow speed drops by 20% at the same Reynolds number. If that would push τ₀ − ½ below 2 × 10⁻⁵, τ₀ stays at that margin and the Reynolds number falls instead, and the app says so (`apps/web/src/sim/guard.ts`).

## References

- Hou, S., Sterling, J., Chen, S. and Doolen, G. D. (1994). A lattice Boltzmann subgrid model for high Reynolds number flows. arXiv comp-gas/9401004; Fields Institute Communications 6 (1996), 151–166.
- Guo, Z., Zheng, C. and Shi, B. (2002). Discrete lattice effects on the forcing term in the lattice Boltzmann method. Phys. Rev. E 65, 046308. Formula checked against Li et al. (2016), arXiv 1508.00940, Eqs. 23–26.
- Guo, Z., Zheng, C. and Shi, B. (2002). Non-equilibrium extrapolation method for velocity and pressure boundary conditions in the lattice Boltzmann method. Chinese Physics 11, 366–374.
- Xu, H. and Sagaut, P. (2013). Analysis of the absorbing layers for the weakly-compressible lattice Boltzmann methods. J. Comput. Phys. 245, 14–42; arXiv 1203.6350.
