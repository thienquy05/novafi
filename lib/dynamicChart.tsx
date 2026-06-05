'use client';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * Lazy-load a Recharts-backed chart so the (heavy) recharts library lands in an
 * on-demand chunk instead of the route's first-load JS. `ssr: false` is safe and
 * appropriate for charts — they need a measured DOM (ResponsiveContainer) and
 * render client-only anyway — and it lets this be used from any client component.
 * A pulsing skeleton stands in until the chunk loads.
 *
 * Reusable across every chart surface so the dynamic-import + fallback policy is
 * defined once. Must be called at module scope (next/dynamic requirement), e.g.
 *   const MyChart = dynamicChart(() => import('./MyChart'));
 */
export function dynamicChart<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  return dynamic(loader, {
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[8rem] rounded-2xl bg-slate-100 dark:bg-slate-700 animate-pulse" />
    ),
  });
}
