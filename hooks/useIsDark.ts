'use client';
import { useEffect, useState } from 'react';

/**
 * Tracks whether the `dark` class is present on <html>, reacting live when the
 * theme toggle adds/removes it. Used by chart components whose colors are set
 * via JS props (recharts SVG attributes) rather than Tailwind classes, so they
 * can't rely on `dark:` variants.
 */
export function useIsDark() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}
