# Street reruns of 2026-10-03, not yet reviewed

Two reruns of the street studies, made on 2026-10-03 by `python -m treesvb.street` after the
solver moved to its final collision:

| File              | Study                                  | Generated            | Commit    | SHA-256 of the uncompressed file                                   |
| ----------------- | -------------------------------------- | -------------------- | --------- | ------------------------------------------------------------------ |
| `regimes.json.gz` | Regime sweep, H/W 0.3 to 2 at 24 cells | 2026-10-03T14:17:46Z | `0c50299` | `249e0f1aa5ed43ac6662356e3cd509f31989829d09a38335d54d2d4a9c9f6bd8` |
| `upwind.json.gz`  | Streets upwind of the studied street   | 2026-10-03T14:37:52Z | `8d76a27` | `d5f35152d7db802d79950e678fce7bed9bd5bf7b0029c1faf377e78df0b53edf` |

They were left uncommitted in a working copy and are kept here, compressed, so that nothing
reads them. The files the app and `docs/validation.md` use, `results/street/regimes.json` and
`results/street/upwind.json`, are still the runs of 2026-10-03T03:47:20Z and 03:39:12Z at
commit `21537b2`.

What would change if they replaced those files (`python -m treesvb.validate` run on them on
2026-10-29):

- The regime check would miss its target. At H/W 2.0 the rerun finds one vortex where two
  stacked vortices are expected; the 48-cell run (`results/street/regimes_h48.json`) finds
  two. The other expectations still hold: the top of the street moves with the wind at
  +0.40, +0.31 and +0.08 u_ref for H/W 0.3, 0.5 and 1.0, weakening as the street narrows.
- The upwind study's conclusions would hold: at H/W 1 the street on its own still turns the
  wrong way (top of the street at −0.44 u_ref), and every street at least 3H behind the row's
  upwind edge turns correctly (+0.10 u_ref at H/W 1, +0.01 at H/W 2).

To use them, after review:

```
gunzip -c pending/street-reruns-2026-10-03/regimes.json.gz > results/street/regimes.json
gunzip -c pending/street-reruns-2026-10-03/upwind.json.gz > results/street/upwind.json
python -m treesvb.validate
```

and update the text that describes the regimes (`docs/progress.md`, `docs/solver.md`).
