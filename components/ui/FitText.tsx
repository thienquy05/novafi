'use client';
import { useRef, useState, useEffect } from 'react';

interface FitTextProps {
  children: string;
  maxSize?: number;
  minSize?: number;
  className?: string;
}

export function FitText({ children, maxSize = 28, minSize = 12, className = '' }: FitTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxSize);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    const fit = () => {
      el.style.fontSize = maxSize + 'px';
      let size = maxSize;
      while (el.scrollWidth > el.clientWidth && size > minSize) {
        size -= 0.5;
        el.style.fontSize = size + 'px';
      }
      setFontSize(size);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, maxSize, minSize]);

  return (
    <span
      ref={spanRef}
      className={`block whitespace-nowrap overflow-hidden tracking-tight leading-tight ${className}`}
      style={{ fontSize }}
    >
      {children}
    </span>
  );
}
