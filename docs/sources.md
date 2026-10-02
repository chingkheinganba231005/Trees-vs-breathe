# Sources

Every constant, dataset, claim and library used by the project, with how it was checked. Anything not yet checked is marked `UNVERIFIED` and is not used for a number in the app until it is.

## Literature

| Ref                                                                           | Used for                                             | Status            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| Hou, Sterling, Chen and Doolen (1996), Smagorinsky model in LBM               | Sub-grid model, Cs                                   | `UNVERIFIED` (P1) |
| Guo, Zheng and Shi (2002), forcing in LBM                                     | Body forces, crown drag                              | `UNVERIFIED` (P1) |
| Ghia, Ghia and Shin (1982), lid-driven cavity                                 | Cavity benchmark tables                              | `UNVERIFIED` (P1) |
| Oke (1988), street canyon regimes                                             | Regime thresholds by H/W                             | `UNVERIFIED` (P1) |
| Krüger et al. (2017), _The Lattice Boltzmann Method_                          | Boundary conditions                                  | `UNVERIFIED` (P1) |
| Gromke and Ruck; CODASC database                                              | Crown λ, c⁺, wind-tunnel reference case              | `UNVERIFIED` (P2) |
| Tominaga and Stathopoulos (2007)                                              | Turbulent Schmidt number                             | `UNVERIFIED` (P2) |
| Chang and Hanna (2004); Hanna and Chang (2012)                                | FAC2, FB, NMSE and urban acceptance criteria         | `UNVERIFIED` (P2) |
| Abhijith et al. (2017), Atmospheric Environment review                        | Direction checks: trees and hedges in street canyons | `UNVERIFIED` (P2) |
| Reda and Andreas (2004), NREL SPA                                             | Solar position                                       | `UNVERIFIED` (P3) |
| Lindberg, Holmer and Thorsson (2008), SOLWEIG                                 | Mean radiant temperature method                      | `UNVERIFIED` (P3) |
| Bröde et al. (2012), UTCI                                                     | Operational UTCI polynomial                          | `UNVERIFIED` (P3) |
| Erbs et al. (1982) or Reindl et al. (1990)                                    | Direct and diffuse radiation split                   | `UNVERIFIED` (P3) |
| Hong Kong Government press release, Feb 2024 (roadside NO₂ 2023)              | Context: roadside NO₂ against the objective          | `UNVERIFIED` (P5) |
| Planning Department, Air Ventilation Assessment guidance                      | Context                                              | `UNVERIFIED` (P5) |
| Highways Department or tree-management guidance on headroom over carriageways | Bus headroom constraint                              | `UNVERIFIED` (P2) |

## Data

None yet. Each dataset is listed in `data/README.md` with URL, access date, licence and SHA-256 before use.

## Software

Licences checked against the npm registry and PyPI metadata on 2026-10-02. All are compatible with publishing the app.

### Web app (shipped to the browser)

| Package                                | Version | Licence                       |
| -------------------------------------- | ------- | ----------------------------- |
| react, react-dom                       | 19.3.0  | MIT                           |
| @fontsource/atkinson-hyperlegible-next | 5.3.0   | OFL-1.1 (font), MIT (package) |
| @fontsource/atkinson-hyperlegible-mono | 5.3.0   | OFL-1.1 (font), MIT (package) |

### Web tooling (development only)

| Package                        | Version | Licence    |
| ------------------------------ | ------- | ---------- |
| vite                           | 8.3.2   | MIT        |
| @vitejs/plugin-react           | 6.1.1   | MIT        |
| tailwindcss, @tailwindcss/vite | 4.3.3   | MIT        |
| typescript                     | 6.0.3   | Apache-2.0 |
| vitest                         | 5.0.3   | MIT        |
| @playwright/test               | 1.56.1  | Apache-2.0 |
| eslint                         | 10.11.0 | MIT        |
| @eslint/js                     | 10.0.1  | MIT        |
| typescript-eslint              | 8.71.0  | MIT        |
| eslint-plugin-react-hooks      | 7.1.1   | MIT        |
| eslint-plugin-react-refresh    | 0.5.7   | MIT        |
| globals                        | 17.13.0 | MIT        |
| prettier                       | 3.9.9   | MIT        |
| @types/react, @types/react-dom | 19.3.0  | MIT        |
| @types/node                    | 22.20.5 | MIT        |

### Python

| Package   | Version | Licence                                                    |
| --------- | ------- | ---------------------------------------------------------- |
| numpy     | 2.4.6   | BSD-3-Clause (with bundled 0BSD, MIT, Zlib, CC0-1.0 parts) |
| pytest    | 9.1.1   | MIT                                                        |
| ruff      | 0.16.10 | MIT                                                        |
| jupytext  | 1.19.5  | MIT                                                        |
| nbclient  | 0.11.0  | BSD-3-Clause                                               |
| nbformat  | 5.11.1  | BSD-3-Clause                                               |
| ipykernel | 7.4.0   | BSD-3-Clause                                               |
| hatchling | 1.32.4  | MIT                                                        |

### CI

GitHub Actions: `actions/checkout`, `actions/setup-node`, `actions/setup-python`, `actions/upload-artifact`, `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages` (all MIT).
