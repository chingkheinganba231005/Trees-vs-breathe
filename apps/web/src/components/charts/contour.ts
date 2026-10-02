/** Contour segments of a grid at one level (marching squares). Grid row 0 is the bottom. */
export function contourSegments(
  values: ArrayLike<number>,
  rows: number,
  cols: number,
  level: number,
): [number, number, number, number][] {
  const v = (r: number, c: number) => values[r * cols + c]! - level;
  const segs: [number, number, number, number][] = [];
  const lerp = (a: number, b: number) => a / (a - b);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = v(r, c); // bottom-left
      const b = v(r, c + 1); // bottom-right
      const d = v(r + 1, c); // top-left
      const e = v(r + 1, c + 1); // top-right
      const pts: [number, number][] = [];
      // Crossings on the four edges, positions in cell-centre coordinates.
      if (a > 0 !== b > 0) pts.push([c + lerp(a, b), r]);
      if (b > 0 !== e > 0) pts.push([c + 1, r + lerp(b, e)]);
      if (d > 0 !== e > 0) pts.push([c + lerp(d, e), r + 1]);
      if (a > 0 !== d > 0) pts.push([c, r + lerp(a, d)]);
      if (pts.length === 2) segs.push([pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]]);
      if (pts.length === 4) {
        segs.push([pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]]);
        segs.push([pts[2]![0], pts[2]![1], pts[3]![0], pts[3]![1]]);
      }
    }
  }
  return segs;
}
