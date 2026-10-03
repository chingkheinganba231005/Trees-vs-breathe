/**
 * Writes `next` into every `stride`-th slot of `into`, starting at `offset`, and returns the
 * first and last node that changed, or null when none did. The GPU solver uses the span to
 * upload only the rows a moved crown touched, not the whole field.
 */
export function updateStrided(
  into: Float32Array,
  next: ArrayLike<number> | null,
  stride: number,
  offset = 0,
): [number, number] | null {
  const n = Math.floor((into.length - offset + stride - 1) / stride);
  let lo = -1;
  let hi = -1;
  for (let k = 0; k < n; k++) {
    const v = Math.fround(next?.[k] ?? 0);
    const i = k * stride + offset;
    if (into[i] !== v) {
      into[i] = v;
      if (lo < 0) lo = k;
      hi = k;
    }
  }
  return lo < 0 ? null : [lo, hi];
}
