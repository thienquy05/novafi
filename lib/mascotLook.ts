import type { HealthStatus } from '@/lib/colors';

/** Normalised gaze: each axis in [-1, 1], `{0, 0}` = looking straight ahead. */
export type Look = { x: number; y: number };

export type PokeReaction = 'joy' | 'surprise' | 'worry';

/**
 * Turn the pointer's offset from the mascot's centre (px) into a gaze vector.
 *
 * Inside the dead zone (`deadZone` px) the mascot settles back to centre so it
 * doesn't jitter when the cursor is right on top of it; past that the gaze eases
 * in over `ramp` px and then holds at full deflection, pointing along the
 * pointer's angle.
 */
export function computeLook(dx: number, dy: number, deadZone: number, ramp = deadZone * 3): Look {
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist <= deadZone) return { x: 0, y: 0 };
  const t = Math.min(1, (dist - deadZone) / Math.max(ramp, 1));
  const strength = t * t * (3 - 2 * t); // smoothstep — no visible snap at the dead-zone edge
  return { x: (dx / dist) * strength, y: (dy / dist) * strength };
}

/** How Nova reacts to a poke — a thriving Nova is delighted, a stressed one flinches. */
export function reactionFor(status: HealthStatus): PokeReaction {
  if (status === 'great' || status === 'good') return 'joy';
  if (status === 'warning' || status === 'danger') return 'worry';
  return 'surprise';
}
