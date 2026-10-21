import { describe, it, expect } from 'vitest';
import { computeLook, reactionFor } from '@/lib/mascotLook';

describe('computeLook', () => {
  it('stays centred inside the dead zone', () => {
    expect(computeLook(0, 0, 30)).toEqual({ x: 0, y: 0 });
    expect(computeLook(10, -10, 30)).toEqual({ x: 0, y: 0 });
    expect(computeLook(30, 0, 30)).toEqual({ x: 0, y: 0 });
  });

  it('points along the pointer angle and saturates at 1', () => {
    const right = computeLook(500, 0, 30);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);

    const up = computeLook(0, -500, 30);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);

    const diag = computeLook(400, 400, 30);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1);
    expect(diag.x).toBeCloseTo(diag.y);
  });

  it('eases in between the dead zone and the full-deflection radius', () => {
    const near = computeLook(40, 0, 30); // just past the edge
    const mid = computeLook(75, 0, 30);
    expect(near.x).toBeGreaterThan(0);
    expect(near.x).toBeLessThan(mid.x);
    expect(mid.x).toBeLessThan(1);
  });

  it('never returns NaN or magnitudes above 1', () => {
    for (const [dx, dy] of [[0, 0], [1e9, -1e9], [-3, 4], [Infinity, 0], [NaN, 1]]) {
      const { x, y } = computeLook(dx, dy, 28);
      expect(Number.isNaN(x)).toBe(false);
      expect(Number.isNaN(y)).toBe(false);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('reactionFor', () => {
  it('maps health status to a poke reaction', () => {
    expect(reactionFor('great')).toBe('joy');
    expect(reactionFor('good')).toBe('joy');
    expect(reactionFor('neutral')).toBe('surprise');
    expect(reactionFor('warning')).toBe('worry');
    expect(reactionFor('danger')).toBe('worry');
  });
});
