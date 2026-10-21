import { describe, expect, it } from 'vitest';
import { directionFor, nextTap, spritePosition } from '@/lib/mascotSprite';

describe('mascot sprite helpers', () => {
  it('maps cells, dead zone, directions, and keeps the prior sector near a boundary', () => {
    expect(spritePosition(4)).toBe('50% 50%');
    expect(spritePosition(8)).toBe('100% 100%');
    expect(directionFor(1, 1, 20)).toEqual({ direction: 'center', sector: -1 });
    expect(directionFor(-100, 0, 20).direction).toBe('left');
    expect(directionFor(100, 0, 20).direction).toBe('right');
    expect(directionFor(100, 45, 20, 0).direction).toBe('right');
    expect(directionFor(Number.NaN, 0, 20).direction).toBe('center');
  });

  it('cycles payoffs across slow taps and makes four rapid taps dizzy', () => {
    let count = 0, total = 0, last = 0;
    for (const [now, payoff] of [[2000, 'heart'], [2100, 'sparkle'], [2200, 'delighted'], [2300, 'dizzy'], [5000, 'sparkle']] as const) {
      const next = nextTap(now, last, count, total);
      expect(next.payoff).toBe(payoff);
      ({ count, total } = next);
      last = now;
    }
  });
});
