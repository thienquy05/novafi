/**
 * Thin wrapper over the Vibration API for subtle tactile feedback on mobile.
 * No-ops silently where unsupported (most desktops, iOS Safari) — call it
 * freely without guarding at each call site.
 */
export function haptic(pattern: number | number[] = 10): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(pattern);
  } catch {
    /* some browsers throw if called outside a user gesture — ignore */
  }
}

/** Named intensities so call sites read as intent, not magic numbers. */
export const Haptics = {
  /** A single soft tick — taps, toggles, reveals. */
  light: () => haptic(8),
  /** A firmer bump — destructive confirms, important toggles. */
  medium: () => haptic(16),
  /** Celebratory triple-tap — a transaction saved, a milestone hit. */
  success: () => haptic([10, 40, 24]),
  /** Attention buzz — over budget, validation error. */
  warning: () => haptic([22, 60, 22]),
};
