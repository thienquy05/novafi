'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { formatCurrency } from '@/lib/utils';

interface RollingNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  /** Auto-fit bounds, matching AnimatedNumber so the hero stays on one line. */
  maxSize?: number;
  minSize?: number;
  className?: string;
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Single digit reel: a vertical 0–9 strip masked to one glyph, translated so the
 * target digit sits in the window — a slot-machine settle. Each reel lands a beat
 * after the one to its left (`delay`) so the whole number cascades into place.
 */
function Reel({ digit, delay }: { digit: number; delay: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-block overflow-hidden align-bottom"
      style={{ height: '1em' }}
    >
      <motion.span
        className="flex flex-col"
        initial={{ y: 0 }}
        animate={{ y: `-${digit * 10}%` }}
        transition={{ type: 'spring', stiffness: 190, damping: 24, delay }}
        style={{ willChange: 'transform' }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="block text-center" style={{ height: '1em', lineHeight: 1 }}>
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/**
 * Currency value that rolls into place on mount like an odometer. Mirrors
 * AnimatedNumber's container/auto-fit contract (block, nowrap, shrink-to-fit) so
 * it's a drop-in for the dashboard hero number. Honors prefers-reduced-motion by
 * rendering the final string statically.
 */
export function RollingNumber({
  value,
  prefix = '',
  suffix = '',
  maxSize = 46,
  minSize = 26,
  className = '',
}: RollingNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxSize);
  const reduce = useReducedMotion();

  const full = `${prefix}${formatCurrency(value)}${suffix}`;

  // Shrink font-size until the number fits its container — same loop as
  // AnimatedNumber. Reels use a fixed-width per glyph (tabular figures), so the
  // measured width is stable while the digits roll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = maxSize + 'px';
      let size = maxSize;
      while (el.scrollWidth > el.clientWidth && size > minSize) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
      setFontSize(size);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full, maxSize, minSize]);

  const base = `block overflow-hidden whitespace-nowrap tracking-tight ${className}`;

  if (reduce) {
    return (
      <span ref={ref} className={base} style={{ fontSize, lineHeight: 1 }}>
        {full}
      </span>
    );
  }

  // Build cells: digit chars become reels (with a left→right stagger), everything
  // else ($, comma, dot, minus) renders statically at the same 1em height.
  let digitIndex = 0;
  const cells = Array.from(full).map((ch, i) => {
    if (ch >= '0' && ch <= '9') {
      const delay = Math.min(digitIndex * 0.05, 0.5);
      digitIndex += 1;
      return <Reel key={i} digit={Number(ch)} delay={delay} />;
    }
    return (
      <span key={i} className="inline-block align-bottom" style={{ height: '1em', lineHeight: 1 }}>
        {ch}
      </span>
    );
  });

  return (
    <span ref={ref} className={base} style={{ fontSize, lineHeight: 1 }}>
      <span className="sr-only">{full}</span>
      <span aria-hidden className="inline-flex items-end">
        {cells}
      </span>
    </span>
  );
}
