'use client';
import { useRef, useState, useEffect } from 'react';

interface FitTextProps {
  children: string;
  maxSize?: number;
  minSize?: number;
  className?: string;
}

/**
 * One-line text that shrinks (maxSize → minSize) to fit its box. If it still
 * doesn't fit at minSize (e.g. a 13-digit amount on a 320px phone) it WRAPS
 * instead of being clipped — text must always be fully visible.
 */
export function FitText({ children, maxSize = 28, minSize = 12, className = '' }: FitTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxSize);
  const [wrap, setWrap] = useState(false);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    const fit = () => {
      el.style.whiteSpace = 'nowrap'; // measure on one line
      el.style.fontSize = maxSize + 'px';
      let size = maxSize;
      while (el.scrollWidth > el.clientWidth && size > minSize) {
        size -= 0.5;
        el.style.fontSize = size + 'px';
      }
      const stillTooWide = el.scrollWidth > el.clientWidth;
      el.style.whiteSpace = '';
      setFontSize(size);
      setWrap(stillTooWide);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, maxSize, minSize]);

  return (
    <span
      ref={spanRef}
      className={`block tracking-tight leading-tight ${wrap ? 'whitespace-normal wrap-anywhere' : 'whitespace-nowrap'} ${className}`}
      style={{ fontSize }}
    >
      {children}
    </span>
  );
}
