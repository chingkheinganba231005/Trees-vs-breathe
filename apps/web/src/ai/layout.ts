import type { GreenElement } from '../sim/greenery';

/** The blocks of a design in a URL: base64url JSON of [x0, x1, z0, z1, lambda H, hedge?]. */
export function encodeLayout(elements: readonly GreenElement[]): string {
  const rows = elements.map((e) => [
    +e.x0.toFixed(4),
    +e.x1.toFixed(4),
    +e.z0.toFixed(4),
    +e.z1.toFixed(4),
    +e.lamH.toFixed(3),
    e.kind === 'hedge' ? 1 : 0,
  ]);
  return btoa(JSON.stringify(rows)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeLayout(param: string | null): GreenElement[] | null {
  if (!param) return null;
  try {
    const json = atob(param.replace(/-/g, '+').replace(/_/g, '/'));
    const rows = JSON.parse(json) as number[][];
    if (!Array.isArray(rows)) return null;
    return rows.map((r, i) => {
      const [x0, x1, z0, z1, lamH, hedge] = r.map(Number);
      if (![x0, x1, z0, z1, lamH].every((v) => Number.isFinite(v))) throw new Error('bad layout');
      return {
        id: `layout-${i}`,
        kind: hedge ? ('hedge' as const) : ('trees' as const),
        x0: x0!,
        x1: x1!,
        z0: z0!,
        z1: z1!,
        lamH: lamH!,
      };
    });
  } catch {
    return null;
  }
}
