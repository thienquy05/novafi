'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  /** When true the body animates open; when false it animates closed. */
  open: boolean;
  children: ReactNode;
  /** Transition duration in ms. */
  duration?: number;
  className?: string;
};

/**
 * Smoothly reveals/hides its children by animating to the content's exact pixel
 * height (measured with a ResizeObserver) plus a fade. Animating a real height
 * eases more predictably than the CSS grid-template-rows 0fr→1fr trick — which
 * interpolates fr units and isn't composited — and because the height is kept in
 * sync with the live content, a nested section that expands re-animates this
 * wrapper too instead of clipping. Content stays mounted and clipped while
 * collapsed; respects prefers-reduced-motion.
 */
export function Collapsible({ open, children, duration = 300, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`overflow-hidden transition-[height,opacity] ease-out motion-reduce:transition-none ${className ?? ''}`}
      style={{
        height: open ? height : 0,
        opacity: open ? 1 : 0,
        transitionDuration: `${duration}ms`,
      }}
      aria-hidden={!open}
    >
      <div ref={ref}>{children}</div>
    </div>
  );
}
