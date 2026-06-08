'use client';
import { MotionConfig } from 'framer-motion';

/**
 * App-wide motion policy. `reducedMotion="user"` makes every framer-motion
 * animation honor the OS "Reduce Motion" setting automatically, so individual
 * components don't each need to branch on useReducedMotion(). Recharts has its
 * own animation system, so chart components still pass isAnimationActive
 * explicitly — this only governs framer-motion.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
