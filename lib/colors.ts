/**
 * Single JS source of truth for the palette used by canvas/SVG code that can't
 * read Tailwind classes or CSS variables (recharts, sparklines, the spending
 * heatmap, confetti, the Nova avatar). Mirrors the semantic tokens declared in
 * globals.css (`--color-success` etc.) so the visual language stays in sync.
 */

export const SEMANTIC = {
  success: '#10b981', // emerald — income, assets, healthy
  danger: '#f43f5e', // rose — overspend, liabilities
  warning: '#f59e0b', // amber — caution, bills due
  savings: '#8b5cf6', // violet — savings & goals
  primary: '#1d7fbf', // sky-blue — neutral / brand (matches indigo-500 override)
  primaryDeep: '#0e5080', // indigo-700 override
} as const;

/** Health-status → color, shared by HealthBanner config and the Nova avatar. */
export const STATUS_COLOR = {
  great: SEMANTIC.success,
  good: SEMANTIC.primary,
  warning: SEMANTIC.warning,
  danger: SEMANTIC.danger,
  neutral: '#94a3b8',
} as const;

export type HealthStatus = keyof typeof STATUS_COLOR;

/**
 * Sky-blue intensity ramp for the spending heatmap (light → deep).
 * Index 0 is the "no spend" tint; higher indices = heavier spend days.
 */
export const HEATMAP_SCALE = [
  '#eaf4fb', // 0 — barely/no spend
  '#c7e3f8', // 1
  '#97c8f0', // 2
  '#5aaee5', // 3
  '#2e95d8', // 4
  '#1568a3', // 5 — heaviest
] as const;

export const HEATMAP_SCALE_DARK = [
  'rgba(148,163,184,0.10)',
  'rgba(46,149,216,0.28)',
  'rgba(46,149,216,0.45)',
  'rgba(46,149,216,0.62)',
  'rgba(46,149,216,0.80)',
  '#2e95d8',
] as const;

/** Confetti uses the full celebratory spread of the palette. */
export const CONFETTI_COLORS = [
  SEMANTIC.success,
  SEMANTIC.primary,
  SEMANTIC.savings,
  SEMANTIC.warning,
  '#2e95d8',
  '#97c8f0',
] as const;
