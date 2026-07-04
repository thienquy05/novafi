'use client';
import { Children, isValidElement, Fragment } from 'react';
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

// Flatten React fragments passed directly as children so each real section is a
// top-level item — a direct child of the container's `space-y-*` (so the gaps
// actually apply) AND its own staggered item. Without this, a page that returns
// its whole body inside a single `<>…</>` (Credit, Investments, Savings, …)
// collapses into one motion wrapper with no `space-y` between its sections, so
// the cards stick together. Recurses for nested fragments; non-element children
// (false/null conditionals) pass through untouched.
function flattenItems(children: React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === Fragment) {
      out.push(...flattenItems((child.props as { children?: React.ReactNode }).children));
    } else {
      out.push(child);
    }
  });
  return out;
}
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
  const items = flattenItems(children);

  if (reduce) {
    return <div className={className}>{items}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      animate="show"
    >
      {items.map((child, i) =>
        isValidElement(child) ? (
          <motion.div key={child.key ?? i} variants={item}>{child}</motion.div>
        ) : (
          child
        ),
      )}
    </motion.div>
  );
}
