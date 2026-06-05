'use client';
import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { formatCurrency } from '@/lib/utils';

type Kind = 'currency' | 'percent' | 'plain';

interface AnimatedNumberProps {
  value: number;
  /** How to render the running number. `format` props are strings so this can
   *  be used from Server Components (functions aren't serializable across the
   *  server/client boundary). */
  kind?: Kind;
  prefix?: string;
  suffix?: string;
  /** Decimal places for percent/plain. Currency always uses formatCurrency. */
  decimals?: number;
  maxSize?: number;
  minSize?: number;
  className?: string;
  duration?: number;
  /** Count up from 0 on first mount. When false, jumps straight to value. */
  animateOnMount?: boolean;
}

/**
 * Count-up number that also auto-fits its font size to the container (like
 * FitText), so it works inside the tight KPI cards on mobile.
 *
 * The running value is written via `textContent` rather than React state, so
 * the 60fps animation never triggers a re-render — and the fit logic, which
 * sizes against the final (widest) value once, stays stable while it counts.
 */
export function AnimatedNumber({
  value,
  kind = 'currency',
  prefix = '',
  suffix = '',
  decimals = 0,
  maxSize = 28,
  minSize = 13,
  className = '',
  duration = 0.9,
  animateOnMount = true,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxSize);
  const reduce = useReducedMotion();

  const fmt = (n: number) => {
    const body =
      kind === 'currency' ? formatCurrency(n)
      : kind === 'percent' ? `${n.toFixed(decimals)}%`
      : n.toFixed(decimals);
    return `${prefix}${body}${suffix}`;
  };

  // Fit against the FINAL value (the widest string) once; intermediate count-up
  // values are shorter, so they never overflow. Refit on container resize.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const mid = el.textContent; // preserve any in-flight animated value
      el.textContent = fmt(value);
      el.style.fontSize = maxSize + 'px';
      let size = maxSize;
      while (el.scrollWidth > el.clientWidth && size > minSize) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
      setFontSize(size);
      if (mid !== null) el.textContent = mid;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // fmt is derived from these; listing the primitives keeps the dep array honest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, kind, prefix, suffix, decimals, maxSize, minSize]);

  const prevRef = useRef(animateOnMount ? 0 : value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prevRef.current;
    prevRef.current = value;
    if (reduce || from === value) {
      el.textContent = fmt(value);
      return;
    }
    const controls = animate(from, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (v) => { el.textContent = fmt(v); },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, kind, prefix, suffix, decimals, reduce, duration]);

  return (
    <span
      ref={ref}
      className={`block whitespace-nowrap overflow-hidden tracking-tight leading-tight ${className}`}
      style={{ fontSize }}
    >
      {fmt(value)}
    </span>
  );
}
