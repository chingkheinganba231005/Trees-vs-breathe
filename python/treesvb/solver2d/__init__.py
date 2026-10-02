"""2D lattice Boltzmann solver (D2Q9, BGK, Smagorinsky, Guo forcing) in NumPy and JAX."""

from .domain import Domain, build_stream_map
from .lattice import CX, CY, OPP, Q, W, equilibrium
from .numpy_solver import NumpySolver, Params

__all__ = [
    "CX",
    "CY",
    "OPP",
    "Domain",
    "NumpySolver",
    "Params",
    "Q",
    "W",
    "build_stream_map",
    "equilibrium",
]
