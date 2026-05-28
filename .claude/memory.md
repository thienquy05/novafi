# Change Log

## 2026-05-28 — Force cache refresh option in Settings

**Branch:** `claude/web-app-cache-refresh-I6IlV`

**Problem:** When the app is added to the home screen (PWA/standalone mode), browser caches and sessionStorage can serve stale content after a deploy, and there's no way for the user to force a fresh load from within the app.

**Solution:** Added an "App Update" card in the Settings page with a "Force Refresh" button. Clicking it:
1. Clears `sessionStorage` (badge counts and categories cache from `Sidebar.tsx` and `useCategories.ts`)
2. Clears all Cache Storage API entries (`caches.keys()` + `caches.delete()`) — covers any future service workers or browser HTTP cache
3. Unregisters any service workers currently active
4. Navigates to the current page with a `?t=<timestamp>` query param via `window.location.replace()` to force the browser to fetch fresh HTML and assets

No data loss: all user data lives in Google Sheets on the server; only transient in-memory/sessionStorage caches are cleared.

**Files changed:**
- `app/(app)/settings/page.tsx`: Added `RefreshCw` icon import, `refreshing` state, `handleHardRefresh` async function, and "App Update" Card before the "Data Storage" card.
- `locales/en.json`: Added `appUpdate`, `appUpdateDesc`, `forceRefresh`, `refreshing` keys under `settings`.
- `locales/vi.json`: Same keys in Vietnamese.

---

## 2026-05-14 — Fix custom categories showing "categories.X" in spending chart

**Branch:** `claude/fix-categories-customization-hvwlP`

**Problem:** Custom expense categories (e.g. "Utilities") showed as "categories.Utilities" in the dashboard spending pie chart legend instead of just "Utilities".

**Root cause:** `SpendingPieChart` in `app/(app)/dashboard/DashboardCharts.tsx` rendered each category label using `t('categories.${entry.name}')`. The `t()` function in `lib/i18n/context.tsx` returns the full key string when a translation is not found. Built-in categories (Food, Grocery, etc.) have entries under `categories.*` in `locales/en.json` and `locales/vi.json`, but user-defined custom categories do not, so the raw key was returned and displayed.

**Fix:**
- Added `tCategory` helper inside `SpendingPieChart`: tries `t('categories.${name}')` and falls back to the bare `name` if the translation key was not found (i.e., `t()` returned the key itself).
- Replaced `t(\`categories.\${entry.name}\`)` with `tCategory(entry.name)` on the label span.

**Files changed:**
- `app/(app)/dashboard/DashboardCharts.tsx`: Added `tCategory` helper (line 223) and updated category label render (line 280).

---

## 2026-05-14 — Fix decimal precision in balance calculations

**Branch:** `claude/fix-decimal-precision-1MI9l`

**Problem:** Credit account balance showed 476.xx in the app instead of the correct 477.07. Floating-point arithmetic drift accumulated across multiple add/subtract operations on decimal monetary values.

**Root cause:** All eight balance-effect functions in `lib/calculations.ts` (`applyExpenseBalance`, `applyIncomeBalance`, `applyTransferFromBalance`, `applyTransferToBalance`, and their four `reverse*` counterparts) returned raw JavaScript floating-point results with no rounding, allowing errors like `0.1 + 0.2 = 0.30000000000000004` to compound over time.

**Files changed:**
- `lib/calculations.ts`: Added private `roundCents(n)` helper (`Math.round(n * 100) / 100`) and wrapped every return value in all eight balance functions with it.
- `lib/sheets.ts` (`getTransactions`): Added `valueRenderOption: 'UNFORMATTED_VALUE'` (was missing, unlike `getAccounts`) so currency-formatted cells return raw numbers instead of formatted strings.

---

## 2026-05-14 — Badge count tests + pre-commit hook

**Branch:** `claude/fix-numbers-z-index-UJ122`

**Changes:**
- Extracted `calcOverdueBills(bills, now)` and `calcOverBudget(budgets, transactions, monthKey)` from the inline logic in `app/api/badges/route.ts` into `lib/calculations.ts` (also added `Budget` to the import).
- Updated `app/api/badges/route.ts` to call the extracted functions.
- Added 22 new test cases in `lib/__tests__/calculations.test.ts` (203 tests total), covering: empty inputs, boundary conditions (exactly-at-limit not over), inactive bill exclusion, wrong-month exclusion, income-vs-expense discrimination, weekly/yearly normalization, and multi-category accumulation.
- Added `.githooks/pre-commit` (runs `npm test`) and `"prepare": "git config core.hooksPath .githooks"` in `package.json` so the hook is automatically activated after `npm install`.

---

## 2026-05-14 — Fix badge numbers z-index on mobile nav

**Branch:** `claude/fix-numbers-z-index-UJ122`

**Problem:** Badge count circles (red/amber numbers) on nav icons were rendered behind the icons instead of on top of them.

**Root cause:** The icon element had `relative z-10` applied, creating a stacking context that put it at z-level 10 within the parent `<div className="relative">`. The badge `<span>` was `absolute` with no explicit z-index (defaulting to `auto`/0), so it rendered below the icon.

**Files changed:**
- `components/Sidebar.tsx` (lines 368, 430): Added `z-20` to both badge `<span>` elements — one in the slide-up "more" sheet and one in the bottom bar — so they paint above the icon's z-level of 10.

---

## 2026-05-28 — Google Sheets row cleanup: remove 1000-row ceiling & auto-trim NetWorthHistory

**Branch:** `claude/sheets-memory-cleanup-VtQGV`

**Problem:** All high-volume sheet reads used hardcoded `A2:X1000` ranges, silently ignoring any rows written past row 1000. No enforcement prevented writes beyond this limit, creating a data visibility bug.

**Changes:**

1. **Lifted the artificial 1000-row ceiling** on Transactions and Paychecks (financial records that must never be auto-deleted):
   - `getTransactions`: `Transactions!A2:I1000` → `Transactions!A2:I`
   - `getPaychecks`: `Paychecks!A2:K1000` → `Paychecks!A2:K`
   - `batchGetBadgesData`: same Transactions range update
   - `batchGetDashboardData`: same Paychecks + Transactions range updates

2. **Also unbounded the NetWorthHistory read range**: `NetWorthHistory!A2:D1000` → `NetWorthHistory!A2:D`

3. **Added auto-trim logic in `appendNetWorthSnapshot`**: After each append, reads the current row count. If ≥ 1000, deletes the oldest 500 data rows (startIndex=1, endIndex=501 in 0-indexed) via `deleteDimension` batchUpdate. This is safe for monthly snapshots (not transactional records) and keeps the sheet lean indefinitely.

**Files changed:**
- `lib/sheets.ts`: 6 range string updates + `appendNetWorthSnapshot` cleanup block.

---

## 2026-05-14 — Fix credit refund balance bug

**Branch:** `claude/fix-credit-refund-YYNab`

**Problem:** Recording an income/return transaction on a credit card (e.g. Capital One) caused the balance to increase (more debt shown) instead of decreasing (less owed). The same bug affected editing and deleting income transactions on credit/loan accounts.

**Root cause:** `applyIncomeBalance` and `reverseIncomeBalance` in `lib/calculations.ts` did not accept an `isDebt` flag, unlike the expense and transfer equivalents. They always added/subtracted unconditionally.

**Files changed:**
- `lib/calculations.ts` (lines 235, 251): Added `isDebt: boolean = false` parameter to `applyIncomeBalance` and `reverseIncomeBalance`. When `isDebt=true`, income reduces the balance; reversing income restores it.
- `app/api/transactions/route.ts` (lines 48, 96, 110, 147): All four call sites (POST create, PUT reverse-original, PUT apply-updated, DELETE reverse) now derive `isDebt = account.type === 'credit' || account.type === 'loan'` and pass it through.
- `lib/__tests__/calculations.test.ts`: Added debt-account test cases for both functions.
