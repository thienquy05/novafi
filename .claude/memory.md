# Change Log

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

## 2026-05-14 — Fix credit refund balance bug

**Branch:** `claude/fix-credit-refund-YYNab`

**Problem:** Recording an income/return transaction on a credit card (e.g. Capital One) caused the balance to increase (more debt shown) instead of decreasing (less owed). The same bug affected editing and deleting income transactions on credit/loan accounts.

**Root cause:** `applyIncomeBalance` and `reverseIncomeBalance` in `lib/calculations.ts` did not accept an `isDebt` flag, unlike the expense and transfer equivalents. They always added/subtracted unconditionally.

**Files changed:**
- `lib/calculations.ts` (lines 235, 251): Added `isDebt: boolean = false` parameter to `applyIncomeBalance` and `reverseIncomeBalance`. When `isDebt=true`, income reduces the balance; reversing income restores it.
- `app/api/transactions/route.ts` (lines 48, 96, 110, 147): All four call sites (POST create, PUT reverse-original, PUT apply-updated, DELETE reverse) now derive `isDebt = account.type === 'credit' || account.type === 'loan'` and pass it through.
- `lib/__tests__/calculations.test.ts`: Added debt-account test cases for both functions.
