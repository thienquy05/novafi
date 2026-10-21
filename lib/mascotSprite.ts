export const DIRECTIONS = ['up-left', 'up', 'up-right', 'left', 'center', 'right', 'down-left', 'down', 'down-right'] as const;
export const REACTIONS = ['blink', 'heart', 'sparkle', 'surprised', 'starstruck', 'bashful', 'sleepy', 'dizzy', 'delighted'] as const;
export type Direction = typeof DIRECTIONS[number];
export type Reaction = typeof REACTIONS[number];

const CLOCKWISE: Direction[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
const SECTOR = Math.PI / 4;
const PAYOFFS: Reaction[] = ['heart', 'sparkle', 'delighted'];

export function spritePosition(index: number): string {
  return `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%`;
}

export function directionFor(dx: number, dy: number, deadZone: number, previous = -1): { direction: Direction; sector: number } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < deadZone) {
    return { direction: 'center', sector: -1 };
  }
  const angle = Math.atan2(dy, dx);
  const delta = Math.atan2(Math.sin(angle - previous * SECTOR), Math.cos(angle - previous * SECTOR));
  const sector = previous >= 0 && Math.abs(delta) < SECTOR / 2 + 0.12
    ? previous : (Math.round(angle / SECTOR) + 8) % 8;
  return { direction: CLOCKWISE[sector], sector };
}

export function nextTap(now: number, last: number, count: number, total: number) {
  const streak = now - last < 1600 ? count + 1 : 1;
  return { count: streak === 4 ? 0 : streak, total: total + 1, payoff: streak === 4 ? 'dizzy' as const : PAYOFFS[total % PAYOFFS.length] };
}
