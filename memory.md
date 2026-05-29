# Project Memory

A running log of changes made to the NovaFi codebase.

## 2026-05-29 — Keep dashboard card action buttons on one line

**Goal:** The "View All" button in the Bill Forecast card was wrapping onto two lines in narrow layouts. Make all dashboard card header action buttons render their text cleanly on a single row.

**Changes:**
- `app/(app)/dashboard/page.tsx` — Added `whitespace-nowrap` to the four `CardHeader` action links so their labels never wrap:
  - Budget card "Manage" (indigo) link → `/planning`.
  - Savings Goals card "Manage" (purple) link → `/planning`.
  - Bill Forecast card "View All" (amber) link → `/bills` (the one that was wrapping; kept existing `inline-block mt-1`).
  - Recent Transactions card "View All" (emerald) link → `/transactions`.

**Notes:**
- Pure styling change; no logic, copy, or i18n keys touched.

## 2026-05-29 — Add display name preference in Settings

**Goal:** Let users choose the name shown in the dashboard greeting, defaulting to their Google account name when left blank.

**Changes:**
- `types/index.ts` — Added `displayName: string` to the `TaxSettings` interface (empty string = fall back to Google account name).
- `lib/utils.ts` — Added `displayName: ''` to `DEFAULT_TAX_SETTINGS`.
- `lib/sheets.ts` — Persist the new field in the user's Google Sheets `Settings` tab:
  - `getSettings` now reads the `display_name` key (defaults to `''`).
  - `saveSettings` now writes the `display_name` row.
- `app/(app)/settings/page.tsx` — New "Name Preference" card at the top of the settings list:
  - Uses `useSession()` (next-auth) to read the Google account name, shown as the input placeholder.
  - Text input bound to `settings.displayName`, saved via the existing Save Settings flow.
  - "Use Google name" link clears the custom value (reverts to default) when a custom name is set.
  - Loader now backfills `displayName: s.displayName ?? ''`.
- `app/(app)/dashboard/page.tsx` — Greeting now uses `settings.displayName` (trimmed) when set, otherwise falls back to the first word of the Google account name.
- `locales/en.json` & `locales/vi.json` — Added settings keys: `namePreference`, `displayName`, `displayNameDesc`, `displayNamePlaceholder`, `useGoogleName`.
- `lib/__tests__/tax.test.ts` — Added `displayName: ''` to the `BASE_SETTINGS` fixture to satisfy the updated type.

**Notes:**
- Settings live in the user's Google Sheets (no DB), so the new field is just another key-value row.
- Custom names are shown as-is in the greeting; Google names are still trimmed to first name only (existing behavior preserved).

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors, `npm test` 290/290 passing.
