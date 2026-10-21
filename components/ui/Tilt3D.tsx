'use client';
import { useRef, type ReactNode } from 'react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';

/**
 * "2.5D" depth for a hero card: with a mouse, the card tilts a few degrees toward
 * the pointer and a soft glare follows it. Touch input and prefers-reduced-motion
 * get the plain card (no motion, no battery cost) — the stacked-shadow depth is
 * done with CSS by the caller. Pure CSS 3D transforms via framer-motion (already
 * a dependency); no WebGL.
 */
export function Tilt3D({
  children,
  className = '',
  rounded = 'rounded-3xl',
  max = 5,
}: {
  children: ReactNode;
  className?: string;
  /** Match the child's corner radius so the glare doesn't spill. */
  rounded?: string;
  /** Max tilt in degrees. */
  max?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5); // pointer position within the card, 0..1
  const py = useMotionValue(0.5);
  const active = useMotionValue(0);
  const spring = { stiffness: 160, damping: 18, mass: 0.6 };
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), spring);
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), spring);
  const glareX = useTransform(px, (v) => `${v * 100}%`);
  const glareY = useTransform(py, (v) => `${v * 100}%`);
  const glareOpacity = useSpring(active, spring);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.22), transparent 55%)`;

  if (reduce) return <div className={className}>{children}</div>;

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
    active.set(1);
  }
  function onLeave() {
    px.set(0.5);
    py.set(0.5);
    active.set(0);
  }

  return (
    <div className={className} style={{ perspective: 1000 }}>
      <motion.div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        className={`relative h-full ${rounded}`}
      >
        {children}
        <motion.div
          aria-hidden
          className={`pointer-events-none absolute inset-0 ${rounded}`}
          style={{ background: glare, opacity: glareOpacity }}
        />
      </motion.div>
    </div>
  );
}
