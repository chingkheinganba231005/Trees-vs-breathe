"""Lid-driven cavity centreline velocities from Ghia, Ghia and Shin (1982).

Ghia, U., Ghia, K. N. and Shin, C. T. (1982). High-Re solutions for incompressible flow using the
Navier-Stokes equations and a multigrid method. J. Comput. Phys. 48, 387-411. Table I (u along
the vertical centreline x = 0.5) and Table II (v along the horizontal centreline y = 0.5),
normalised by the lid speed, positions normalised by the cavity side.

The journal is not reachable from the build container, so the values come from secondary
reproductions, checked on 2026-10-02 (docs/sources.md):

- Re 1000: Najjar, Solberg and White (2008), LLNL-TR-403164, Tables 7 and 8, which list
  Ghia's 17 values next to Botella and Peyret (1998). https://www.osti.gov/servlets/purl/936989
- Re 100: the reference_u.txt and reference_v.txt files of a Nextjournal notebook (accessed
  2026-10-02), whose extreme values match Table 1 of Mramor, Vertnik and Šarler (2013),
  CMC 36(1), https://cdn.techscience.cn/files/cmc/2013/v36n1/cmc.2013.036.001.pdf.
  Other reproductions give u = 0.73722 at y = 0.9609 (here 0.73772), v = 0.10890 at x = 0.0781
  (here 0.10891) and x = 0.9609 for v = -0.07391 (here 0.9606). We use 0.9609 for the position,
  since it is Ghia's grid point 124 on 129, and keep the velocities as fetched; the differences
  are below 0.0005, far inside the 2% tolerance of the benchmark.
"""

from __future__ import annotations

import numpy as np

# Re 100, Table I: y, u
U_RE100 = np.array(
    [
        [1.0000, 1.00000],
        [0.9766, 0.84123],
        [0.9688, 0.78871],
        [0.9609, 0.73772],
        [0.9531, 0.68717],
        [0.8516, 0.23151],
        [0.7344, 0.00332],
        [0.6172, -0.13641],
        [0.5000, -0.20581],
        [0.4531, -0.21090],
        [0.2813, -0.15662],
        [0.1719, -0.10150],
        [0.1016, -0.06434],
        [0.0703, -0.04775],
        [0.0625, -0.04192],
        [0.0547, -0.03717],
        [0.0000, 0.00000],
    ]
)

# Re 100, Table II: x, v
V_RE100 = np.array(
    [
        [1.0000, 0.00000],
        [0.9688, -0.05906],
        [0.9609, -0.07391],
        [0.9531, -0.08864],
        [0.9453, -0.10313],
        [0.9063, -0.16914],
        [0.8594, -0.22445],
        [0.8047, -0.24533],
        [0.5000, 0.05454],
        [0.2344, 0.17527],
        [0.2266, 0.17507],
        [0.1563, 0.16077],
        [0.0938, 0.12317],
        [0.0781, 0.10891],
        [0.0703, 0.10091],
        [0.0625, 0.09233],
        [0.0000, 0.00000],
    ]
)

# Re 1000, Table I: y, u (LLNL-TR-403164 Table 7)
U_RE1000 = np.array(
    [
        [0.0000, 0.00000],
        [0.0547, -0.18109],
        [0.0625, -0.20196],
        [0.0703, -0.22220],
        [0.1016, -0.29730],
        [0.1719, -0.38289],
        [0.2813, -0.27805],
        [0.4531, -0.10648],
        [0.5000, -0.06080],
        [0.6172, 0.05702],
        [0.7344, 0.18719],
        [0.8516, 0.33304],
        [0.9531, 0.46604],
        [0.9609, 0.51117],
        [0.9688, 0.57492],
        [0.9766, 0.65928],
        [1.0000, 1.00000],
    ]
)

# Re 1000, Table II: x, v (LLNL-TR-403164 Table 8)
V_RE1000 = np.array(
    [
        [0.0000, 0.00000],
        [0.0625, 0.27485],
        [0.0703, 0.29012],
        [0.0781, 0.30353],
        [0.0938, 0.32627],
        [0.1563, 0.37095],
        [0.2266, 0.33075],
        [0.2344, 0.32235],
        [0.5000, 0.02526],
        [0.8047, -0.31966],
        [0.8594, -0.42665],
        [0.9063, -0.51550],
        [0.9453, -0.39188],
        [0.9531, -0.33714],
        [0.9609, -0.27669],
        [0.9688, -0.21388],
        [1.0000, 0.00000],
    ]
)

TABLES = {100: (U_RE100, V_RE100), 1000: (U_RE1000, V_RE1000)}

SOURCE = {
    "citation": "Ghia, Ghia and Shin (1982), J. Comput. Phys. 48, 387-411, Tables I and II",
    "re1000_via": "Najjar, Solberg and White (2008), LLNL-TR-403164, Tables 7-8, "
    "https://www.osti.gov/servlets/purl/936989",
    "re100_via": "Nextjournal reference_u.txt/reference_v.txt (accessed 2026-10-02), extremes "
    "cross-checked with Mramor, Vertnik and Šarler (2013), CMC 36(1), Table 1",
    "accessed": "2026-10-02",
}
