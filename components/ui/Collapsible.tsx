'use client';
import type { ReactNode } from 'react';

type Props = {
  /** When true the body animates open; when false it animates closed. */
  open: boolean;
  children: ReactNode;
  /** Transition duration in ms. */
  duration?: number;
  className?: string;
};

/**
 * Smoothly reveals/hides its children by animating height with the CSS
 * grid-template-rows 0fr→1fr trick — no JS measuring, no layout jump. Content
 * stays mounted and clipped while collapsed, so expanding eases the rows below
 * down instead of snapping them.
 */
export function Collapsible({ open, children, duration = 300, className }: Props) {
  return (
    <div
      className={`grid transition-[grid-template-rows] ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'} ${className ?? ''}`}
      style={{ transitionDuration: `${duration}ms` }}
    >
      <div className="overflow-hidden min-h-0">{children}</div>
    </div>
  );
}
