# treesvb

The Python side of Trees vs Breath: the reference solvers (NumPy for tests, JAX for the A100), the CODASC loader and metrics, dataset generation, surrogate training and export, and the validation report. The Colab notebooks in `colab/` import this package, so the physics has one source of truth.

```
uv venv .venv && uv pip install -e "python[test,notebooks]"
pytest
```
