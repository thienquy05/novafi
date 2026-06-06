'use client';
import { Children, isValidElement } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';

/**
 * Staggered entrance for a column of page sections. Each direct child is wrapped
 * in a motion item that fades + rises into place, one shortly after the next, so
 * resolved content (e.g. after the Google Sheets sync) glides in instead of
 * snapping. Runs once on mount.
 *
 * Honors `prefers-reduced-motion`: renders children untouched (instant, no
 * transform), matching the convention in AnimatedNumber/Collapsible.
 */
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

export function StaggerReveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      animate="show"
    >
      {Children.map(children, (child) =>
        isValidElement(child) ? (
          <motion.div variants={item}>{child}</motion.div>
        ) : (
          child
        ),
      )}
    </motion.div>
  );
}
