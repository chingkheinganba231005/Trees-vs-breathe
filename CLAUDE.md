# Working rules for Trees vs Breath

The full brief is in `BRIEF.md`. Read it before starting work. These rules apply to every session.

## Process

1. Build in the phases of `BRIEF.md` section 12, in order. Each phase ends with a runnable demo and passing tests. Do not start a phase until the previous one meets its exit criteria.
2. Before each phase, write a checklist plan in `docs/progress.md`. Tick items as they are finished. Record decisions and open questions there.
3. Verify by running things, not by assuming: unit tests, the benchmark suite, the production build, and the Playwright smoke test that screenshots every screen. Look at the screenshots.
4. Commit in small, meaningful steps with clear messages. Push at the end of every phase.
5. Ask the user only when blocked: a Colab GPU run, a file that cannot be downloaded, or a decision with a large trade-off. While a Colab job is out, keep working on anything that does not depend on it.

## Numbers and claims

6. Never invent a number. Every constant, dataset and claim comes from either
   - a cited source (author, year, table or page, URL, access date), or
   - our own dated computation, written to `results/*.json`.
7. If a source cannot be verified (for example the network blocks it), mark it `UNVERIFIED` in `docs/sources.md` and tell the user.
8. Tag every model output in the app as simulated. Keep `docs/assumptions.md` and the in-app "What the model leaves out" list current.
9. Numbers shown in the app or in `docs/validation.md` are read from `results/*.json`, never typed by hand.

## Code and writing

10. Plain, direct English in code and docs. No filler, no marketing tone, no emoji. Comments explain why, not what.
11. Pin dependency versions (exact versions in `package.json` and `pyproject.toml`). Check the licence of every library and dataset before using it and record it in `docs/sources.md`.
12. Every dataset file in `data/` gets its source URL, access date, licence and SHA-256 in `data/README.md`.

## Commands

| Task                                                           | Command                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Install web deps                                               | `npm ci`                                                                                          |
| Dev server                                                     | `npm run dev`                                                                                     |
| Lint, format check, typecheck                                  | `npm run lint`, `npm run format:check`, `npm run typecheck`                                       |
| Web unit tests                                                 | `npm test`                                                                                        |
| Production build                                               | `npm run build`                                                                                   |
| Playwright smoke test (screenshots in `test-results/screens/`) | `npm run e2e`                                                                                     |
| Python env                                                     | `uv venv .venv && uv pip install -e "python[test]"`                                               |
| Python lint and tests                                          | `ruff check python tests/python colab && ruff format --check python tests/python colab && pytest` |
| Rebuild notebooks from `colab/src/*.py`                        | `python -m treesvb.notebooks build`                                                               |
| Run notebooks in CPU smoke mode                                | `python -m treesvb.notebooks smoke`                                                               |
| Check and unpack a zip returned from Colab                     | `python -m treesvb.colab unpack <zip>`                                                            |

The container has no GPU. Playwright tests use `?engine=cpu`. Heavy GPU work goes to the user's Colab A100 through the protocol in `BRIEF.md` section 10.
