// Home (dashboard) card layout — which card groups show, in what order. Saved
// per account in settings.dashboardLayout as ordered ids; a leading '-' marks a
// hidden card (e.g. ['netWorth', '-credit', 'calendar', …]). Cards missing from
// the saved list (added in a later release) are appended, visible.

export const DASHBOARD_CARDS = [
  'calendar',     // Spending calendar + "where your money went"
  'balances',     // Assets / liabilities / savings / emergency strip
  'credit',       // Credit utilization
  'netWorth',     // Net worth trend + forecast
  'cashFlow',     // Monthly cash flow
  'health',       // Emergency fund + financial health score
  'budgetsGoals', // Budget progress + savings goals
  'billsRecent',  // Bill forecast, group money, recent transactions
] as const;

export type DashboardCardId = (typeof DASHBOARD_CARDS)[number];
export type DashboardCardState = { id: DashboardCardId; visible: boolean };

const isCard = (id: string): id is DashboardCardId => (DASHBOARD_CARDS as readonly string[]).includes(id);

export function resolveDashboardLayout(saved: readonly string[] | undefined): DashboardCardState[] {
  const out: DashboardCardState[] = [];
  const seen = new Set<string>();
  for (const entry of saved ?? []) {
    const hidden = entry.startsWith('-');
    const id = hidden ? entry.slice(1) : entry;
    if (!isCard(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, visible: !hidden });
  }
  for (const id of DASHBOARD_CARDS) if (!seen.has(id)) out.push({ id, visible: true });
  return out;
}

export function serializeDashboardLayout(cards: readonly DashboardCardState[]): string[] {
  return cards.map((c) => (c.visible ? c.id : `-${c.id}`));
}
