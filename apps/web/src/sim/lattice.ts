// D2Q9 constants. The direction order matches python/treesvb/solver2d/lattice.py:
//
//   6 2 5
//   3 0 1
//   7 4 8

export const Q = 9;
export const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1] as const;
export const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1] as const;
export const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36] as const;
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6] as const;
/** Mirror in y (cy -> -cy), used by the free-slip top. */
export const MIRROR_Y = [0, 1, 4, 3, 2, 8, 7, 6, 5] as const;
export const CS2 = 1 / 3;
