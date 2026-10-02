# Data

Raw source files. Every file is listed here with its source URL, access date, licence and SHA-256 before anything uses it. Large datasets generated on Colab stay on Google Drive and are listed in `results/dataset/manifest.json` instead.

| File | Source URL | Accessed | Licence | SHA-256 | Notes |
| --- | --- | --- | --- | --- | --- |
| `codasc/raw/*` (56 wall files and the approach-flow page; not committed) | https://www.umweltaerodynamik.de/bilder-originale/CODA/ (CODASC; http://www.codasc.de redirects there) | 2026-10-02 | CODASC terms: personal, internal or scientific non-commercial use with citation; no modification | one per file in `codasc/SHA256SUMS` | Fetch with `python -m treesvb.codasc fetch`; case set-up in `docs/codasc.md` |

Planned (see `BRIEF.md` section 9): Hong Kong Observatory hourly weather, EPD roadside and general-station NO₂, Transport Department traffic counts, Lands Department building data.
