# Change Log

## 2026-05-14 — Fix decimal precision in balance calculations

**Branch:** `claude/fix-decimal-precision-1MI9l`

**Problem:** Credit account balance showed 476.xx in the app instead of the correct 477.07. Floating-point arithmetic drift accumulated across multiple add/subtract operations on decimal monetary values.

**Root cause:** All eight balance-effect functions in `lib/calculations.ts` (`applyExpenseBalance`, `applyIncomeBalance`, `applyTransferFromBalance`, `applyTransferToBalance`, and their four `reverse*` counterparts) returned raw JavaScript floating-point results with no rounding, allowing errors like `0.1 + 0.2 = 0.30000000000000004` to compound over time.

**Files changed:**
- `lib/calculations.ts`: Added private `roundCents(n)` helper (`Math.round(n * 100) / 100`) and wrapped every return value in all eight balance functions with it.
- `lib/sheets.ts` (`getTransactions`): Added `valueRenderOption: 'UNFORMATTED_VALUE'` (was missing, unlike `getAccounts`) so currency-formatted cells return raw numbers instead of formatted strings.



## 2026-05-14 — Fix credit refund balance bug

**Branch:** `claude/fix-credit-refund-YYNab`

**Problem:** Recording an income/return transaction on a credit card (e.g. Capital One) caused the balance to increase (more debt shown) instead of decreasing (less owed). The same bug affected editing and deleting income transactions on credit/loan accounts.

**Root cause:** `applyIncomeBalance` and `reverseIncomeBalance` in `lib/calculations.ts` did not accept an `isDebt` flag, unlike the expense and transfer equivalents. They always added/subtracted unconditionally.

**Files changed:**
- `lib/calculations.ts` (lines 235, 251): Added `isDebt: boolean = false` parameter to `applyIncomeBalance` and `reverseIncomeBalance`. When `isDebt=true`, income reduces the balance; reversing income restores it.
- `app/api/transactions/route.ts` (lines 48, 96, 110, 147): All four call sites (POST create, PUT reverse-original, PUT apply-updated, DELETE reverse) now derive `isDebt = account.type === 'credit' || account.type === 'loan'` and pass it through.
- `lib/__tests__/calculations.test.ts`: Added debt-account test cases for both functions.
