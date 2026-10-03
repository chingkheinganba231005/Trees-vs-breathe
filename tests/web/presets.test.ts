import { describe, expect, it } from 'vitest';
import {
  parseCustomStreet,
  presetByKey,
  streetEnds,
  streetPresets,
} from '../../apps/web/src/content/presets';

describe('street presets', () => {
  it('loads the three measured streets', () => {
    expect(streetPresets().map((p) => p.key)).toEqual(['wing_lok', 'nathan_mong_kok', 'yen_chow']);
    for (const p of streetPresets()) {
      expect(p.width_m.median).toBeGreaterThan(0);
      expect(p.aspect_h_over_w.p25).toBeLessThanOrEqual(p.aspect_h_over_w.median);
      expect(p.aspect_h_over_w.median).toBeLessThanOrEqual(p.aspect_h_over_w.p75);
    }
    expect(presetByKey('nowhere')).toBeNull();
    expect(presetByKey(null)).toBeNull();
  });

  it('names the two ends of a street axis', () => {
    expect(streetEnds(0)).toEqual(['N', 'S']);
    expect(streetEnds(117)).toEqual(['SE', 'NW']);
    expect(streetEnds(40)).toEqual(['NE', 'SW']);
    expect(streetEnds(179)).toEqual(['S', 'N']);
  });

  it('parses a custom street from the hash params', () => {
    expect(
      parseCustomStreet(
        '#/design?street=custom&height=34&width=22&pavementLeft=2.5&pavementRight=3&bearing=45',
      ),
    ).toEqual({
      key: 'custom',
      heightM: 34,
      widthM: 22,
      pavementLeftM: 2.5,
      pavementRightM: 3,
      bearingDeg: 45,
      aspectHOverW: 34 / 22,
    });
    expect(parseCustomStreet('#/design?street=wing_lok')).toBeNull();
  });
});
