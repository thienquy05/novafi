import { describe, it, expect } from 'vitest';
import { DASHBOARD_CARDS, resolveDashboardLayout, serializeDashboardLayout } from '@/lib/dashboardLayout';

describe('dashboard layout', () => {
  it('defaults to every card, visible, in the default order', () => {
    expect(resolveDashboardLayout([])).toEqual(DASHBOARD_CARDS.map((id) => ({ id, visible: true })));
  });
  it('keeps the saved order and hidden flags, drops unknown/duplicate ids, appends new cards', () => {
    const r = resolveDashboardLayout(['netWorth', '-credit', 'bogus', 'netWorth']);
    expect(r.slice(0, 2)).toEqual([{ id: 'netWorth', visible: true }, { id: 'credit', visible: false }]);
    expect(r).toHaveLength(DASHBOARD_CARDS.length);
    expect(r.filter((c) => !c.visible).map((c) => c.id)).toEqual(['credit']);
  });
  it('round-trips through serialize', () => {
    const r = resolveDashboardLayout(['-calendar', 'health']);
    expect(resolveDashboardLayout(serializeDashboardLayout(r))).toEqual(r);
  });
});
