# Results

The single source for every number shown in the app or in `docs/validation.md`. Files here are written by the test suites and the Colab notebooks, never by hand.

Each JSON file carries enough provenance to be traced:

```json
{
  "schema": 1,
  "generated_by": "pytest tests/python/test_benchmarks.py",
  "generated_at": "2026-10-02T14:00:00Z",
  "commit": "<git sha>",
  "...": "the results"
}
```

Colab outputs arrive with a `*.manifest.json` beside them; `python -m treesvb.colab verify <manifest>` checks their checksums.

| Folder | Written by | Phase |
| --- | --- | --- |
| `benchmarks/` | Solver benchmark tests (Poiseuille, cavity, conservation, cross-implementation) | 1 |
| `street/` | Regime sweep, direction checks, Reynolds sensitivity | 1–2 |
| `codasc2d/` | 2D solver against CODASC | 2 |
| `colab/` | Colab notebooks (setup check) | 0 |
| `reference2d/` | Colab `01` | 2 |
| `codasc3d/` | Colab `02` | 4 |
| `dataset/` | Colab `03` (manifest only) | 4 |
| `surrogate/` | Colab `04` | 4 |
| `sun/` | Solar position and UTCI checks | 3 |
