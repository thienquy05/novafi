# Project Memory

A running log of changes made to the NovaFi codebase.

## 2026-06-02 — Show negative "after bills" instead of flooring at $0.00 (branch claude/negative-balance-display-kPg8b)

**Problem reported:** On the dashboard "Watch spending" card, the "after bills" figure (safe-to-spend) was clamped to `$0.00` whenever bills exceeded what was left. The user couldn't see the actual shortfall — e.g. it showed `$0.00 after bills` when they were really under. They asked to surface the real negative amount so they know exactly how far under they are.

**Root cause:** `calcSafeToSpend(income, spending, bills)` returned `Math.max(0, income - spending - bills)`, flooring any deficit to 0.

**Changes:**
- `lib/calculations.ts` — `calcSafeToSpend` now returns the raw `income - spending - bills` (can be negative). Added a comment explaining the deficit is intentionally surfaced. `formatCurrency` already renders the minus sign, so no display plumbing was needed.
- `app/(app)/dashboard/DashboardCharts.tsx` — the "after bills" value in the spending-status card is now coloured rose (`text-rose-600 dark:text-rose-400`) when `safeToSpend < 0`, matching the app's existing over/negative convention (e.g. the budget "over" label); stays slate when ≥ 0. The dashboard StatCard for safe-to-spend already keyed its colour/bg off `safeToSpend > 0`, so it now correctly shows rose for a negative value with no change.
- `lib/__tests__/calculations.test.ts` — updated the two `calcSafeToSpend` cases that asserted the old floor: `(5000, 5500, 0)` now expects `-500`, `(1000, 800, 300)` now expects `-100`. Renamed them to describe surfacing the shortfall.

**Verification:** `npx vitest run lib/__tests__/calculations.test.ts` → 225 passed.

## 2026-06-02 — Safe-to-Spend made cash-aware (counts debt paybacks) (branch claude/hardcore-brahmagupta-59dff5)

**Problem reported:** Safe-to-spend mirrored net income but ignored money paid toward debt. Example: $1000 net income, pay back $900 on a credit card → safe-to-spend still showed $1000. Root cause: the dashboard fed `calcMonthExpense` (which sums only `type === 'expense'`) as the "spending" arg, and a credit-card payback is a `type === 'transfer'` (cash → debt account), which every aggregation deliberately skips. So debt paybacks never reduced safe-to-spend.

**Decision (user-chosen):** Use a **cash model** for safe-to-spend — count money when it actually leaves the bank: card payments/debt paybacks count; card *purchases* don't count until paid. This avoids double-counting a card purchase and its later payoff. (The accrual `calcMonthExpense` is unchanged and still drives savings rate / MoM — those are a separate concept.)

**Changes:**
- `lib/calculations.ts` — new pure fn `calcMonthCashSpending(transactions, accounts, monthKey)`. Sums, for the given month: (1) `expense` tx whose `account` is NOT a credit/loan account (cash out of a deposit account), plus (2) `transfer` tx whose `toAccount` IS a credit/loan account (payment settling debt). Ignores card charges, deposit-to-deposit transfers, and income. Uses the existing hoisted `roundCents`.
- `app/(app)/dashboard/page.tsx` — import `calcMonthCashSpending`; compute `monthCashSpending = calcMonthCashSpending(transactions, accounts, thisMonth)` and pass it (instead of `monthSpending`) into `calcSafeToSpend(monthIncome, monthCashSpending, billsThisMonth)`. `monthSpending` (accrual) still used everywhere else (savings rate, etc.).
- `lib/__tests__/calculations.test.ts` — new `calcMonthCashSpending` suite (6 cases): deposit-account expenses count; card charges ignored; payments into a debt account count; charge+payoff in one month = single count (no double-count); deposit→deposit transfer ignored; income/other-month ignored.

**Not changed / known edge case:** income posted directly to a debt account (e.g. a card refund, `type === 'income'` on a credit account) is still included in `monthIncome` for safe-to-spend; it isn't spendable cash, but it's rare and `calcMonthIncome` is shared with savings rate. Bills (`billsThisMonth`) left as-is — separate forecast construct, user didn't raise it.

**Verification:** `npx vitest run lib/__tests__/calculations.test.ts` → 225 passed. `tsc --noEmit` clean.

## 2026-06-02 — PR6 deferred: dead-code sweep + batch read endpoint (branch claude/pr6-deferred-cleanup)

The two parts intentionally left out of the original PR6 (performance/cleanup), done off master.

**1. Dead/legacy code removal (zero non-test references, confirmed with `grep -rn`):**
- `lib/calculations.ts`: removed `calcDebtScore` (the "legacy, retained for back-compat" debt-to-asset score — only tests referenced it), `calcGoalProgress`, `calcCategoryPct`, and `calcPaycheckEffectiveRate`. Each had no internal callers and no app usage. `calcProjectedSpend` was *kept* — it looked unused externally but is called internally by `calcSpendingPace`.
- `lib/utils.ts`: removed `formatPercent` (no references anywhere, not even a test).
- `lib/__tests__/calculations.test.ts`: removed the four now-orphaned `describe` blocks and their import names in sync (19 tests removed: 302 → 283).
- Checked but **kept**: `lib/csv.ts` (`transactionsToCsv` is used by the transactions page) and `lib/retry.ts` (all exports are live — `withRetryProxy` is used by `sheets.ts`/`auth.ts`, and `withRetry`/`isRetryableError`/`backoffDelay` are used internally by it; the test-only external counts were misleading because the calls are intra-file).

**2. Batch read endpoint (cut per-page round-trips + Sheets quota):**
- Added `batchGetSheets(accessToken, spreadsheetId, keys[])` to `lib/sheets.ts`, mirroring `batchGetDashboardData`. It fetches the always-present sheets (accounts/transactions/bills/paychecks/budgets/goals) in a single `spreadsheets.values.batchGet` (UNFORMATTED_VALUE), and routes Contacts/Splits through their existing getters since those tabs may not exist yet and a missing range fails the whole batch. All reads run concurrently. Exposes `BATCH_KEYS` and a `BatchKey` type.
- Extracted shared row parsers so the batch path and the single-resource getters can't drift: `rowToAccount`, `rowToGoal`/`parseGoals` (preserves the position sort), `rowToBudget`/`parseBudgets`. `getAccounts`/`getGoals`/`getBudgets` now delegate to these.
- New route `app/api/batch/route.ts`: `GET /api/batch?keys=a,b,c`. It reuses the **same per-resource cache keys** (`accounts:<id>`, `bills:<id>`, …) the individual GET routes use and mirrors each resource's TTL — so the mutating routes' existing `invalidateCache()` calls keep it fresh with zero extra wiring. Only cache-missing keys hit Sheets. Invalid/empty `keys` → 400; Sheets failure → 500.
- `app/(app)/bills/page.tsx`: replaced the 6-request fan-out (`/api/bills,accounts,paychecks,transactions,contacts,splits`) with one `/api/batch` call.
- `app/(app)/savings/page.tsx`: replaced the 3-request fan-out (`/api/accounts,transactions,goals`) with one `/api/batch` call.

No new sheets test added: the codebase tests only pure functions (no googleapis/module mocking anywhere), and the extracted parsers are behavior-identical to the already-exercised getters.

Verified: `tsc --noEmit` clean; eslint 0 errors (only pre-existing `set-state-in-effect` + `_lastCol` warnings); 283 tests pass.

## 2026-06-02 — Budget rollover: fixed cap, deficit-only on usage (branch claude/budget-calculation-bug-INfrq)

**Request:** the budget cap must stay **fixed**. When rollover is on, only last month's **overspend** should carry into this month's progress-bar usage; an **underspend** carries nothing (a new month starts at 0 used). Master had reverted to the two-way carryover model (`effectiveBudget = 2·base − prevMonthSpend`), which *moves the cap* up on underspend / down on overspend — the wrong behavior.

**Change (replaces the two-way model with deficit-only-on-usage):**
- `lib/calculations.ts`: removed `calcRolloverCarryover`/`calcEffectiveBudget`; added `calcRolloverDeficit(baseBudget, prevMonthSpend) = max(0, prevMonthSpend − baseBudget)` and `calcEffectiveSpent(spent, rolledOverDeficit) = spent + rolledOverDeficit`.
- `app/(app)/planning/page.tsx`: replaced `effectiveMonthlyAmount`/`carryoverAmount` with a single `rolledOverDeficit(budget)` (0 when rollover off). `totalBudgeted` sums the **fixed** `monthlyAmount`; `overBudgetCount` compares `calcEffectiveSpent(spent, deficit)` to the fixed cap. Per-budget: `monthly = monthlyAmount` (fixed), `usage = spent + rolledOver`; `pct`/`over`/`remaining`/`projected` use `usage`; `momDiff`/`categoryPct` still use actual `spent`. `BudgetItem` now takes `rolledOver`/`usage`, the header shows `usage / cap`, and the meta badge is a single rose `+{deficit} {t('planning.rolledOver')}` ("from last month") shown only when `rolledOver > 0` (no more green surplus badge).
- `lib/__tests__/calculations.test.ts`: swapped the carryover/effective-budget suites for `calcRolloverDeficit` (surplus→0, overspend→overage, exact/new→0) and `calcEffectiveSpent` (usage = spend + deficit).

Note: editing a budget still recomputes the deficit against the current cap (no per-month cap history is stored) — accepted per user as the intended/"normal" behavior. Branch was reset to latest master (9687d5a) before applying this, since earlier snapshot/revert work on it was abandoned.

Verified: `tsc --noEmit` clean; eslint 0 errors (pre-existing setState-in-effect warning only); 298 tests pass.

## 2026-06-02 — Loan create/payback: write cash transaction + loan atomically server-side (branch claude/awesome-goldberg-6BQLc)

**Goal:** Complete the money-flow consistency pass. Loan create and payback still posted the cash `transfer` transaction and the loan as two separate client requests (`/api/transactions` then `/api/loans`). A failure between them could leave a loan with no matching ledger row, or an orphan transfer with no loan. Now mirrors the delete path: one request writes both.

**Changes:**
- `app/api/loans/route.ts` — `POST` now accepts either a bare `Loan` (back-compat / note-only) or `{ loan, tx }`. When `tx` is present it `addTransaction`s it, applies the balance via `applyTransactionToBalances(accounts, tx, 'apply')`, persists changed accounts, and invalidates transactions/accounts/dashboard/badges caches — then upserts the loan. Added `addTransaction` import and `Transaction` type. Extracted a shared `persistChanged()` helper (identity-check on the accounts array) now used by both POST and DELETE.
- `app/(app)/transactions/page.tsx` — `handleAddLoan` and `handleRecordPayback` no longer POST to `/api/transactions` separately; they send `{ loan, tx }` (or `{ loan }` for note-only) to `/api/loans` in a single call. The loan object already carries the tx id in `principalTxId` / `repaymentTxIds`, so the reference matches what the server persists.

**Notes:**
- `buildLoanTx` sets `createdAt`, so same-day replay ordering during reconcile is preserved.
- This closes the create/payback gap flagged in the earlier audit; the loan↔transaction lifecycle (create, payback, delete) is now fully server-side and balance-consistent.

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors (pre-existing warnings only), `npm test` 309/309 passing.

## 2026-06-02 — Loan delete: reverse + delete linked cash transactions server-side (branch claude/awesome-goldberg-6BQLc)

**Goal:** Part of a money-flow consistency pass (sync transactions with accounts/paychecks/loans). A loan's principal and each payback are real `transfer` transactions that move account balances. Deleting a loan reversed those transactions in a **fragile client-side loop** (`handleDeleteLoan`): it DELETE'd each linked tx id one-by-one, then deleted the loan. If the page closed or a request failed mid-loop, you could end up with the loan gone but live orphan transfers still distorting balances (or partial reversal).

**Fix:** Moved the cascade into the loans API so it's atomic within one request.
- `app/api/loans/route.ts` — `DELETE` now loads loans, finds the target loan, deletes it, then collects `[principalTxId, ...repaymentTxIds]`, and for each still-existing transaction reverses its balance effect via `applyTransactionToBalances(working, tx, 'reverse')` and deletes the row, persisting only changed accounts with `upsertAccount`. Invalidates transactions/accounts/dashboard/badges caches when any tx was reversed. Added imports (`getTransactions`, `deleteTransaction`, `getAccounts`, `upsertAccount`, `applyTransactionToBalances`, `Account`). Mirrors the transactions/paychecks DELETE pattern.
- `app/(app)/transactions/page.tsx` — `handleDeleteLoan` no longer loops over `/api/transactions` DELETE (that would now double-reverse balances). It just DELETEs the loan and calls `load()` to refresh when the loan had any linked cash transaction.

**Notes:**
- Loan create/payback still post the tx then the loan from the client (tx-first, with error toast). A mid-step failure there can still orphan a transfer; not changed in this pass (lower risk than delete, and the existing flow already posts the balance-affecting tx first).
- Bill deletion intentionally leaves past payment expense transactions in place — a paid bill is a real historical expense, not owned by the recurring template.

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors (pre-existing warnings only), `npm test` 309/309 passing.

## 2026-06-02 — Paycheck delete now reverses its deposit (branch claude/awesome-goldberg-6BQLc)

**Bug (user):** "for the paycheck, it is only calculate the amount to deposit… we still don't have any formula that handle removal if we delete or change the paycheck amount, my account is messed up."

**Root cause:** Logging a paycheck created TWO unlinked records — a Paychecks row, plus a separate income `Transaction` (with its own random `generateId()`) that actually drives the account balance. `DELETE /api/paychecks` only deleted the Paychecks row, leaving the deposit transaction in the ledger. Since balances are reconciled from the transaction ledger, the deposit lingered and the account balance stayed inflated. There was also no link between the two, so the orphan deposit couldn't be found, and no edit path existed (changing an amount = delete + re-add, which left the orphan behind).

**Fix:** Make the paycheck *own* its deposit transaction via a shared id, and reverse it on delete.
- `app/(app)/paychecks/page.tsx` — `handleSave` now posts the auto-created deposit transaction with `id: entry.id` (the paycheck's id) instead of a fresh `generateId()`, so the paycheck and its deposit are deterministically linked.
- `app/api/paychecks/route.ts` — `DELETE` now, after removing the Paychecks row, looks up the transaction whose id equals the paycheck id; if found it calls `deleteTransaction` and reverses the balance via `applyTransactionToBalances(accounts, tx, 'reverse')`, persisting only changed accounts with `upsertAccount` (mirrors the transactions DELETE route). Added imports (`getTransactions`, `deleteTransaction`, `getAccounts`, `upsertAccount`, `applyTransactionToBalances`) and now invalidates `transactions`, `accounts`, and `badges` caches too. No-ops cleanly when a paycheck has no deposit account, and for legacy paychecks whose unrelated-id transaction can't be linked.

**Notes:**
- Forward-looking only. Paychecks logged BEFORE this change still have a random-id deposit transaction that can't be auto-linked, so deleting them won't reverse the deposit. Existing inflated balances must be repaired by manually deleting the leftover "Paycheck" income transactions on the Transactions page (then Settings → reconcile). Not auto-migrated — would require a fuzzy paycheck↔transaction match against real financial records.
- "Change the paycheck amount": there's still no in-place edit UI; the supported flow is delete + re-add, which is now balance-correct because delete reverses the old deposit and the re-add posts a fresh linked one.

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors (pre-existing warnings only), `npm test` 309/309 passing.
## 2026-06-02 — Revert budget rollover calculation to its original model (branch claude/blissful-brown-R7bUj)

**User request:** The rollover iterations that followed the original feature (the deficit-only redefinition + the frozen monthly-cap snapshot, all shipped earlier today) confused them. Lowering a budget amount showed a phantom "from last month" deficit that *re-raising the amount back to the initial value did not clear* — because the snapshot had frozen the lowered cap. They asked to **keep the Budget Rollover setting/toggle** but **revert the calculation code back to how it worked when the feature was first added** (`e3d5d39`), undoing all my later "fix" iterations (d5ae700 snapshot, 2ddd0ca edit-stability, 197d27d carry-from-history).

**Why the original model fixes the complaint:** `e3d5d39` has **no snapshot** — it derives everything live from the current cap and last month's actual spend, so restoring a budget amount immediately restores the display. The stuck-deficit class of bug can't occur because nothing is frozen.

### Restored the original two-way carryover model
- `carryover = baseBudget − prevMonthSpend` — positive (surplus) → larger effective cap; negative (overspend) → smaller effective cap.
- `effectiveBudget = baseBudget + carryover` — the **cap/denominator** moves, not the spent/numerator. (Deficit-only `usage = spent + deficit` is gone.)

### Files
- **`lib/calculations.ts`** — removed `calcRolloverDeficit`/`calcEffectiveSpent`; restored `calcRolloverCarryover` + `calcEffectiveBudget`.
- **`lib/__tests__/calculations.test.ts`** — swapped the deficit/effective-spent suites (incl. the snapshot regression test) back for the original `calcRolloverCarryover`/`calcEffectiveBudget` suites. Suite: **309 pass.**
- **`types/index.ts`** — removed `Budget.activeMonth`/`prevMonth`/`prevCap`.
- **`lib/sheets.ts`** — removed `monthKey` (export), `monthlyEquivalent`, and `reconcileBudgetMonths`; `getBudgets` range `A2:H200` → `A2:E200` (no snapshot parse); `upsertBudget` drops the snapshot write (`deleteRowById` last col `H` → `E`; appends 5 cols). Legacy cols F–H in existing sheets are now simply ignored (harmless leftover data; rows are deleted whole on upsert so they don't accumulate).
- **`app/api/budgets/route.ts`** — GET no longer imports/calls `reconcileBudgetMonths`; returns `getBudgets` directly.
- **`app/(app)/planning/page.tsx`** — import → `calcRolloverCarryover`/`calcEffectiveBudget`; `saveBudget` no longer writes the snapshot (`{ id, category, amount, period, position }` only); replaced `rolledOverDeficit()` with `effectiveMonthlyAmount()` + `carryoverAmount()`; `totalBudgeted`/`overBudgetCount` and per-budget `monthly`/`pct`/`over`/`remaining`/`projected` use the effective cap with plain `spent` (no more `usage`/`rolledOver`); `BudgetItem` takes `carryover` instead of `rolledOver`/`usage`, header shows `spent / effectiveCap`, and the meta badge is the two-way `+/−$X rollover` pill (emerald surplus / rose deficit).
- **`locales/en.json` + `vi.json`** — added `planning.rollover` ("rollover" / "chuyển tiếp") for the badge. `planning.rolledOver` left in place (now unused).

**Kept (per user):** the Budget Rollover toggle in Settings, the `budgetRollover` setting + its Sheets persistence (`e3d5d39`).

Verified: `npm run typecheck` clean, `npm run lint` 0 errors (25 pre-existing warnings), `npm test` 309/309 pass, `npm run build` succeeds.

---

## 2026-06-02 — Roll over last month's overspend even without a frozen snapshot (branch claude/budget-rollover-carry-from-history)

**Bug (user):** All Planning budgets showed `$0.00` used with empty bars at the start of June, even though the "vs last mo" line and 3-month average proved last month had real spending — e.g. Shopping ($291.67/mo cap) spent ~$1,338 and Transportation ($150 cap) spent ~$213 last month (both **overspent**). Nothing rolled over. "the amount isn't roll over too… I will need to keep that amount over the next month if overspent and the progress bar should display with proper percentage."

**Root cause:** `rolledOverDeficit()` returned `0` whenever `budget.prevMonth !== prevMonthKey || prevCap === undefined`. The frozen-cap snapshot (shipped earlier today) is only captured at a month boundary going forward, and the **first reconcile this month already advanced these legacy budgets to `activeMonth = '2026-06'` with an empty snapshot** — so they carry nothing until *next* month. The transaction history needed to compute the overspend was available, but the gate refused to use it.

**Decision (user):** make the overspend carry in **now**, from history, using last month's cap.

**Fix — `app/(app)/planning/page.tsx`:**
- `rolledOverDeficit()` now picks `lastMonthCap = (prevMonth === prevMonthKey && prevCap !== undefined) ? prevCap : monthlyAmount(budget)` — prefer the frozen cap when present (accurate across cap edits), otherwise **fall back to the budget's current monthly cap**. So `calcRolloverDeficit(lastMonthCap, prevSpentForCategory(cat))` carries a genuine prior overspend immediately instead of waiting a full month.
- `saveBudget()` now **freezes the pre-edit cap** the first time a snapshot-less budget is edited: `hasSnapshot = base.prevMonth === prevMonthKey && base.prevCap !== undefined`; when false it sets `prevMonth = prevMonthKey`, `prevCap = monthlyAmount(base)` (the OLD amount). Without this, the current-cap fallback would let lowering a cap retroactively turn last month's under-cap spend into a fabricated deficit (the d5ae700 bug). Freezing the old cap keeps the carried overspend measured against the real prior cap; changing this month's amount only moves the bar's denominator. The server's `upsertBudget` then persists the snapshot.

**Behavior note:** because the fallback uses transaction history, a budget whose category was overspent last month carries that overspend in even if it lacks a snapshot — including, by design, a newly added budget on a previously-overspent category. Surplus/underspend never carries (deficit-only). Requires the **Budget Rollover** setting to be ON.

**Tests:** pure-function suite unchanged (the cap-selection logic lives in the component); `calcRolloverDeficit`/`calcEffectiveSpent` still green. Verified `tsc --noEmit` clean, eslint 0 errors (pre-existing warnings only), 306 tests pass.

## 2026-06-02 — Stop budget edits from making the rollover bar jump/fill (branch claude/budget-rollover-progress-bar-V50Ng)

**Bug (user):** "When I change the budget amount, the progress bar goes full and it brings last month's number, subtracting it from the new budget I just set." Carry-in rollover (frozen `prevCap`, shipped earlier today) was correct in the math, but **editing the amount** still misbehaved in the UI.

**Root cause:** `saveBudget` in `app/(app)/planning/page.tsx` rebuilt the optimistic `Budget` object from the form only — `{ id, category, amount, period }` — **dropping** `position`/`activeMonth`/`prevMonth`/`prevCap`. So immediately after an edit the local row had no snapshot → `rolledOverDeficit()` returned 0 and the bar briefly shrank; then the next `/api/budgets` load returned the server-preserved snapshot and the bar **jumped back** to include the carried-over deficit (looking like the edit "filled" it). The deficit denominator is the new `amount`, so a lowered cap made the jump land at/over 100%.

**Decision (user):** keep the **carry-in / fill-the-bar** behavior (a genuine prior overspend should eat into this month's bar) — only kill the edit-time jump.

**Fix — `app/(app)/planning/page.tsx` `saveBudget`:** carry the existing row's snapshot through the edit. `const base = editBudget ?? sameCategory;` then the new budget includes `position/activeMonth/prevMonth/prevCap` from `base`. Now the optimistic state matches what the server stores, so the bar is stable across an edit. Because `prevCap` is the **frozen** last-month cap (untouched by the edit), changing this month's `amount` only moves the bar's denominator — it can never fabricate or resurrect a deficit. (Server `upsertBudget` already preserved these fields; this aligns the optimistic UI with it.)

**Tests:** existing `calcRolloverDeficit(500, 499.36) === 0` frozen-cap regression in `lib/__tests__/calculations.test.ts` still covers the "edit can't invent a deficit" math. Verified `tsc --noEmit` clean, eslint 0 errors (pre-existing warnings only), 306 tests pass.

## 2026-06-02 — Make budget rollover accurate via a frozen monthly-cap snapshot (branch claude/budget-calculation-bug-INfrq)

**Bug:** After lowering a budget (e.g. Insurance $500 → $110), the Planning card showed the spent amount and progress bar inflated by a phantom "+$X from last month" deficit, turning the bar full and red ("$279.36 over") even though nothing was spent this month. The Dashboard and reports correctly showed the category as **not** over budget, so the views disagreed.

**Root cause:** the opt-in rollover (Planning only) computed `rolledOverDeficit = max(0, prevMonthSpend − currentBudget)` and displayed `usage = spent + rolledOverDeficit`. Because the deficit was measured against the **current** cap and `Budget` stored only a single `amount` (no per-month history), lowering the cap retroactively reinterpreted last month: $499.36 spent under the old $500 cap (not overspent) exceeded the new $110 cap → fabricated $389.36. Dashboard/`BudgetBars` use plain `spent`, hence the mismatch.

**Decision (user):** keep carrying a real prior overspend **into this month's bar** (old behavior), but make it accurate so editing the cap never invents a deficit. This requires knowing last month's *actual* cap, which wasn't stored — so we now snapshot it.

**Data model — `types/index.ts`:** `Budget` gained `activeMonth?`, `prevMonth?`, `prevCap?`. `activeMonth` (YYYY-MM) is the month the current `amount` has been the active cap for; at each month rollover the just-ended month is frozen into `prevMonth`/`prevCap` (the monthly-equivalent cap that was active then).

**Persistence — `lib/sheets.ts`:**
- Budgets now span cols A–H (was A–E). `getBudgets` reads/maps F=`activeMonth`, G=`prevMonth`, H=`prevCap`; range `A2:H200`.
- `upsertBudget` preserves the snapshot fields across edits (merges from the existing row; a brand-new budget starts `activeMonth = current month` and carries nothing until it has lived a full month). Writes all 8 cols; delete extent `H`. `deleteRowById` deletes the whole row, so extra cols are safe.
- Added `monthKey(date?)`, `monthlyEquivalent(amount, period)`, and `reconcileBudgetMonths(...)`: on the first load of a new month it freezes `prevMonth = oldActiveMonth`, `prevCap = monthlyEquivalent(amount, period)`, `activeMonth = currentMonth` via an **in-place** `F:H` batch update (no row reordering). Legacy budgets with no prior `activeMonth` carry nothing the first time (we can't know a past cap → no phantom); accurate from the next month on. Only writes when a month actually changed.
- The batch readers (`A2:D200`) for the Dashboard are untouched — they don't need snapshots.

**Route — `app/api/budgets/route.ts`:** GET now calls `reconcileBudgetMonths` after `getBudgets` (cache-miss path) and caches/returns the reconciled budgets.

**UI — `app/(app)/planning/page.tsx`:** restored the `budgetRollover`-gated rollover, but `rolledOverDeficit(budget)` now returns `0` unless `budget.prevMonth === prevMonthKey` and `budget.prevCap` is set, otherwise `calcRolloverDeficit(budget.prevCap, prevSpentForCategory(cat))` — i.e. last month's spend vs last month's **frozen** cap. `usage`/`pct`/`over`/`remaining`/`projected`/`overBudgetCount` and the "+$X from last month" badge use that accurate deficit. Net effect: lowering Insurance to $110 (under $500 last month) shows `$0 / $110`, empty bar, no badge; a genuine prior overspend still carries into the bar.

**Tests — `lib/__tests__/calculations.test.ts`:** added a regression asserting `calcRolloverDeficit(500, 499.36) === 0` (frozen cap) while `calcRolloverDeficit(110, 499.36) ≈ 389.36` (the old phantom).

**Note:** Dashboard still shows current-month actual spend only (separate data path, no snapshots) — intentional; Planning is the surface that reflects carry-over.

Verified: `tsc --noEmit` clean; eslint 0 errors (only the pre-existing planning setState-in-effect + sheets `_lastCol` warnings); 299 tests pass (223 in the calculations suite).

## 2026-06-02 — Loans/IOU tracker + split bills count only my share

**Goal (per user decisions):** Add a personal lend/borrow (IOU) tracker, and make the Bills section's monthly/cashflow totals reflect only the user's share of split bills.

**Loans / IOUs** — a two-way tracker in the Transactions section. Money model: lending moves cash **out of an existing account** (no new account is created) via a `transfer` transaction with an empty counterparty, so it shifts the balance but is **not** counted as spending or income (transfers are already excluded from those aggregates). Repayment moves cash back **in** the same way. Borrowing is the mirror. Supports **partial paybacks** (running remaining, auto-settles at zero). An account is optional — with none picked, the loan is a pure note with no balance effect.
- `types/index.ts` — new `Loan` interface: `{ id, direction: 'lent'|'borrowed', contactId, contactName, account, principal, repaidAmount, date, note, settled, settledDate, principalTxId, repaymentTxIds[] }`.
- `lib/sheets.ts` — `Loans` tab (`A:M`, lazily auto-created via `ensureSheet`/`isMissingTabError`) with `getLoans`/`upsertLoan`/`deleteLoan`; `repaymentTxIds` stored pipe-joined. Added `Loan` to type imports + `LOANS_HEADER`.
- `lib/auth.ts` — new spreadsheets provision a `Loans` tab + header.
- `app/api/loans/route.ts` — GET (cached `loans:<id>`, SHORT TTL), POST upsert, DELETE.
- `lib/calculations.ts` — pure `calcLoanRemaining(principal, repaidAmount)` → `max(0, round(principal − repaid))`; 6 new tests in `lib/__tests__/calculations.test.ts`.
- `app/(app)/transactions/page.tsx`:
  - Reuses the existing **Contacts** list (fetches `/api/contacts`, inline "+ Add new contact"); fetches `/api/loans` in `load()`.
  - Module-level `buildLoanTx(direction, kind, amount, account, desc, date)` builds the cash `transfer` (cash out when lending principal or repaying a borrow; cash in otherwise; empty counterparty); `roundCents` helper.
  - Header **"Loans"** button (with open-count badge) + a summary card (owed-to-you / you-owe) — both open the Loans modal.
  - **Loans modal** (the "container"): inline add-loan form (direction toggle, contact, amount, account, date, note), owed/you-owe totals, open loans with remaining + progress bar + inline **Record payback** form, and a settled section. `handleAddLoan`/`handleRecordPayback`/`handleDeleteLoan`/`handleAddLoanContact`. Adding/repaying with an account also posts the cash transfer and calls `load()` to refresh balances; deleting a loan reverses all its linked transfers.
- i18n: new `loans.*` block in `locales/en.json` + `locales/vi.json`.

**Split bills → my-share-only totals** (`app/(app)/bills/page.tsx`): added module-level `myBillShare(bill)` (= `calcSplitShares(amount, splitAmount).mine` for shared bills, else full amount). The **Monthly** summary card, the cashflow calendar (`totalBillsAmt` + day tooltips), and the timeline (`totalThisMonth` + titles) now use `myBillShare` so they reflect what actually leaves your account. The per-bill card still shows the full amount plus the `you X / them Y` badge. (Dashboard bill forecast still uses full amounts — possible follow-up.)

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors (pre-existing warnings only), `npm test` 305/305 passing (299 prior + 6 new `calcLoanRemaining` tests).

## 2026-06-02 — Shared/split bills with "Owed to You" tracking

**Goal:** Let a bill be shared with another person. **Final money model (per user decision):** marking a shared bill paid records **only your own share** as the expense — the other person covers their part separately. The other person's share is tracked in a new **"Owed to You"** section with a Transferred checkbox; this tracker is **purely informational and creates no transactions**. Because the expense is already just your share, Spending / category totals / Safe-to-Spend / Reports / balances are all correct immediately, with no offsetting/refund entries. Contacts are reusable but kept minimal.

(Note: this shipped in two commits — the first implemented a "front the full amount, then post an offsetting refund when they pay you back" model; the second simplified to the "expense = my share, informational tracker" model described here. This entry reflects the final shipped behavior.)

**Data model:**
- `types/index.ts`:
  - `Bill` gained `splitContactId?: string` and `splitAmount?: number` (the other person's share of `amount`; your share = `amount - splitAmount`).
  - New `Contact` interface `{ id, name, createdAt }` — reusable people you split with.
  - New `Split` interface — one "owed to you" record created per split-bill payment: `{ id, billId, billName, contactId, contactName, amount, category, account, date, settled, settledDate }`. `billName`/`contactName` are denormalized for display; `category`/`account`/`date` capture how the bill was paid (context only); `settled`/`settledDate` track whether they've paid you. No transaction is linked — settling is informational.

**Persistence (`lib/sheets.ts`):**
- Added a generic `ensureSheet(sheets, spreadsheetId, title, header)` helper that lazily creates a tab + header row on demand (so spreadsheets provisioned before this feature get `Contacts`/`Splits` without a migration — mirrors the existing NetWorthHistory pattern).
- Added `isMissingTabError(err)` — the lazy-create `catch` for `getContacts`/`getSplits` now only swallows a missing-tab error (HTTP 400 / "Unable to parse range") and rethrows real failures (network/auth/5xx) instead of masking them as empty.
- Bills now persist split columns I/J. Extracted a shared `rowToBill` parser (legacy 8-col rows simply parse as unsplit). `getBills`, `upsertBill`, and both batch readers (`batchGetBadgesData`, `batchGetDashboardData`) use the wider `Bills!A2:J200` range / shared parser. `upsertBill`/`deleteBill` last-col bumped to `J`.
- New `Contacts` tab (`A:C`) CRUD: `getContacts`/`upsertContact`/`deleteContact` (lazy-ensure on read/write).
- New `Splits` tab (`A:K`) CRUD: `getSplits`/`upsertSplit`/`deleteSplit` (lazy-ensure). `settled` stored as `'true'/'false'`.
- Added `Contact`/`Split` to the type imports.

**Spreadsheet bootstrap (`lib/auth.ts`):** New spreadsheets now create `Contacts` and `Splits` tabs and seed their headers; Bills header extended with `split_contact_id`, `split_amount`.

**APIs:**
- New `app/api/contacts/route.ts` (GET cached `contacts:<id>` LONG TTL, POST upsert, DELETE) and `app/api/splits/route.ts` (GET cached `splits:<id>` SHORT TTL, POST upsert, DELETE) — modeled on the existing bills/goals routes.

**Calculations (`lib/calculations.ts`):** Added pure `calcSplitShares(total, theirShare)` → `{ mine, theirs }`, clamping `theirShare` to `[0, total]` and rounding to cents. Used for the modal preview, the bill-card badge, and to default the Record Payment amount to your share. Covered by 6 new tests in `lib/__tests__/calculations.test.ts`.

**Bills UI (`app/(app)/bills/page.tsx`):**
- `load()` now also fetches `/api/contacts` and `/api/splits`; added `contacts`/`splits` state plus inline new-contact state and `settlingSplitId`.
- Add/Edit bill modal: new "Split this bill" section — checkbox to enable, contact picker (with an inline "+ Add new contact" option that creates a reusable `Contact` via `handleAddContact`), a "Their share ($)" input, and a live your-share/their-share breakdown via `calcSplitShares` (shown whenever the bill amount > 0, so it never blanks out while editing).
- Active bill cards show a split badge (`{name} · you X / them Y`) when the bill is shared.
- Record Payment: for a shared bill the amount **defaults to your share** (`calcSplitShares(...).mine`); recording posts that expense, advances the due date, and — only after the expense write is confirmed `ok` — creates a pending `Split` ("owed to you") record (avoids an orphaned record if the expense fails).
- New "Owed to You" section: per-contact pending totals, and a row per split with a **Transferred checkbox** (`handleSplitToggle`). Toggling only flips `settled`/`settledDate` and writes the split — **no transaction is created**. A trash button (`handleDeleteSplit`) removes a record.
- Everything routes through the existing transactions plumbing, so account balances, dashboard Safe-to-Spend, Spending, and Reports stay consistent.

**i18n:** Added ~24 `bills.*` keys to `locales/en.json` and `locales/vi.json` (split section, owed-to-you section, transferred states, toasts).

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors (only pre-existing warnings), `npm test` 296/296 passing (290 prior + 6 new `calcSplitShares` tests). Dependencies were installed in the container (`npm ci`) so the checks could run.

## 2026-06-02 — Per-paycheck full tax figure + Bills cashflow includes tips

**Goal:** Two related paycheck issues.
(1) The per-paycheck card's "Taxes" line only showed income tax (federal + state + local), omitting FICA (Social Security + Medicare). This made it disagree with the YTD "Taxes & Deductions" card (computed as gross − net, which includes FICA), and the card's own lines didn't reconcile to net. The user wants each paycheck to show the full tax amount so they know how much to set aside.
(2) The Bills cashflow calendar summed only `netAmount` for paychecks, excluding tips (`gratuityAmount`), so it understated the deposited income. It should show net income = take-home + tips, matching the auto-created income transaction.

**Changes:**
- `lib/calculations.ts` — Added `calcPaycheckTotalTax(grossAmount, netAmount, k401, hsa)` returning `max(0, gross − net − k401 − hsa)`. This back-derives the full tax (income + FICA) since the stored `PaycheckEntry` doesn't persist FICA separately. Keeps the card balanced: wages − totalTax − (401k+HSA) + tips = take-home, and matches the YTD gross − net basis.
- `app/(app)/paychecks/page.tsx`:
  - Swapped the `calcPaycheckEffectiveRate` import for `calcPaycheckTotalTax`.
  - Per-paycheck card "Taxes" line now shows `calcPaycheckTotalTax(...)` (full income + FICA) instead of `federalWithheld + stateWithheld + localWithheld`.
  - The effective-rate label now derives from the full tax (`totalTax / gross`) so it stays consistent with the new Taxes figure.
- `app/(app)/bills/page.tsx` — In `CashflowCalendar`, all three paycheck displays now add `+ (p.gratuityAmount ?? 0)`: the header `totalPaychecksAmt` sum, the per-day tooltip, and the footer summary badges.
- `lib/__tests__/calculations.test.ts` — Added a `calcPaycheckTotalTax` describe block (full-tax back-derivation incl. the user's 819.93/708.60 → 111.33 case, exclusion of 401k/HSA, and non-negative clamp).

**Notes:**
- `calcPaycheckEffectiveRate` is kept (still has its own tests) but is no longer used by the page; the card now reports the full effective tax rate.
- Edge case: if a user has IRA contributions (`iraAnnual`), `gross − net − k401 − hsa` folds IRA into the "Taxes" figure since IRA isn't stored or shown anywhere on the card. This keeps the card arithmetic exact and matches the YTD basis; IRA is typically 0.

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors (pre-existing warnings only), `npm test` 293/293 passing.

## 2026-06-01 — Restart Transactions income/spending/net totals monthly

**Goal:** The INCOME / SPENDING / NET summary cards on the Transactions (Spending) page summed *every* transaction ever, so the numbers grew without bound and "this month vs last month" was impossible to read. Scope the totals (and the ledger below) to one month at a time, defaulting to the current month, with a month switcher so prior months stay reachable.

**Changes:**
- `app/(app)/transactions/page.tsx`:
  - Added month-scoping helpers near the other module-level helpers: `currentMonth()` (returns `today().slice(0,7)`), `shiftMonth(ym, delta)` (adds/subtracts months on a `YYYY-MM` string), and `formatMonthLabel(ym)` (→ e.g. "June 2026", `en-US` to match `formatDate`).
  - Added `selectedMonth` state (`string | null`), defaulting to `currentMonth()`. `null` = all-time view.
  - Extended the `filtered` memo with `matchMonth` (`tx.date.slice(0,7) === selectedMonth`, bypassed when `null`); added `selectedMonth` to its deps. Both the summary totals and the rendered list derive from `filtered`, so both now respect the selected month.
  - Added `selectedMonth` to `filterKey` so the paging counter resets when the month changes.
  - Added a month navigator above the summary cards: a pill with ◀ / month label / ▶ chevrons (`ChevronLeft` newly imported), plus an "All time" toggle button. Next-month chevron is disabled at the current month (no future data); chevrons are disabled/dimmed in all-time mode.
- `locales/en.json` & `locales/vi.json` — Added `transactions.allTime`, `transactions.prevMonth`, `transactions.nextMonth`.

**Notes:**
- Scoped *both* the cards and the ledger to the selected month (rather than cards-only) so the view is internally consistent — picking a month shows that month's numbers and that month's transactions. Search/type/category filters now operate within the selected month.
- Export CSV exports `filtered`, so it now exports the visible month's rows (consistent with what's on screen). All-time export is still available via the "All time" toggle.
- On the 1st of a month the current month may be near-empty — this is the intended "restart" behavior; tap ◀ to view the prior month.

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors (only pre-existing warnings elsewhere), `npm test` 290/290 passing.

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

## 2026-06-02 — Paycheck: keep full amount as real money, only calculate tax to set aside

**Goal:** Switch paychecks from a withholding model (deposit net take-home, taxes disappear) to a full-deposit model: the entire amount received is deposited as real money, and the app just calculates the tax to set aside (save). Per the user's choice, "tax to set aside" = all taxes (federal + state + city + FICA); 401k/HSA are NOT subtracted; the deposited amount is the full amount received (wages + tips).

**Changes:**
- `types/index.ts` — `PaycheckEntry`: added `ficaWithheld: number` (FICA to set aside, now persisted) and rewrote field comments for the full-deposit model. In this model `netAmount` = wages kept (= `grossAmount`) and `k401`/`hsa` are 0 (nothing auto-deducted); the federal/state/local/FICA fields are amounts to SAVE, not withheld.
- `lib/sheets.ts` — Persist FICA in a new Google Sheets column **L** for the `Paychecks` tab:
  - `getPaychecks` range `A2:K` → `A2:L`; `rowToPaycheck` reads `ficaWithheld: Number(r[11] ?? 0)`.
  - `addPaycheck` appends `entry.ficaWithheld ?? 0` as the 12th value.
  - `deletePaycheck` last column `'K'` → `'L'`.
  - Dashboard batchGet: `Paychecks!A2:K` → `A2:L` and its inline paycheck parser now reads `ficaWithheld` from `r[11]`.
- `lib/calculations.ts` — Replaced `calcPaycheckTotalTax(gross, net, k401, hsa)` with `calcPaycheckTaxToSave(entry)`: sums the explicit `federalWithheld + stateWithheld + localWithheld + ficaWithheld`, with a legacy fallback (`gross − net − k401 − hsa`) for old entries that predate the model / lack stored FICA. Returns `roundCents(max(explicit, legacy))`.
- `app/(app)/paychecks/page.tsx`:
  - `handleSave` now stores `ficaWithheld = preview.ficaSs + preview.ficaMedicare`, `k401 = 0`, `hsa = 0`, `netAmount = preview.grossPaycheck`. The auto-created income transaction deposits the **full amount** = `preview.grossPaycheck + gratuity` (was `preview.netPaycheck + gratuity`).
  - YTD cards: replaced "YTD Net"/"YTD Taxes & Deductions" with "YTD Deposited (real money)" (= gross + tips) and "YTD Tax to Set Aside" (= Σ `calcPaycheckTaxToSave`).
  - Per-paycheck row: "Taxes" column → "Set aside" (positive amount, no minus since it's earmarked, not removed); 401k+HSA column now only shows when > 0; deposit label → "Deposited"; effective-rate line uses `calcPaycheckTaxToSave / gross`.
  - Live preview: dropped the 401k/HSA deduction lines; taxes shown as positive "set aside" amounts under a "Set aside for taxes" hint; bottom line shows "Real money deposited" (= gross + tips) and "Tax to set aside" (= `preview.totalTax`).
  - Swapped import `calcPaycheckTotalTax` → `calcPaycheckTaxToSave`.
- `app/(app)/bills/page.tsx` — Updated the cash-flow comment to "Real money deposited" (the `netAmount + gratuity` math is unchanged and still correct since `netAmount` now equals gross).
- `locales/en.json` & `locales/vi.json` — paychecks keys: new `ytdDeposited`, `ytdTaxToSave`, `taxToSetAsideHint`, `realMoneyDeposited`, `taxToSetAside`, `setAside`, `deposited`; removed now-unused `ytdNet`, `ytdTaxes`, `netOfTaxable`, `netTakeHome`, `totalTakeHome`; updated `subtitle` and `effectiveTaxRate` copy.
- `lib/__tests__/calculations.test.ts` — Replaced the `calcPaycheckTotalTax` describe block with `calcPaycheckTaxToSave` tests (explicit-sum full-deposit entry, legacy back-derivation, never-negative).

**Notes:**
- Backward compatibility: legacy paychecks (logged under the old net-deposit model, no stored FICA) still display their full tax via the legacy fallback in `calcPaycheckTaxToSave`, and their deposit display (`netAmount + gratuity`) reflects what was actually posted.
- The 2026 tax engine (`lib/tax.ts`) is unchanged; `preview.totalTax` (fed + state + city + FICA) is exactly the "tax to set aside" total.

**Verification:** `npm run typecheck` clean, `npm run build` succeeds, `npm run lint` 0 errors (pre-existing warnings only), `npm test` 306/306 passing.

## 2026-06-02 — Paycheck: simplify YTD cards + use deposited (gross) amount everywhere

**Goal:** Follow-up to the full-deposit model. (1) Simplify the paycheck UI: collapse the four YTD cards to just two — "YTD Income (deposited)" and "YTD Tax" — and drop the verbose "real money" / "set aside" wording from the live-preview and per-paycheck card. (2) Make the deposited (full gross + tips) amount the single source of truth everywhere it's shown, so legacy entries (whose stored `netAmount` is an after-tax figure) no longer display the after-tax amount.

**Changes:**
- `lib/calculations.ts` — Added `calcPaycheckDeposited(p)` = `roundCents(grossAmount + (gratuityAmount ?? 0))`. This is now the one place that defines "what was deposited" — always the full amount, independent of how `netAmount` was stored (fixes legacy entries that recorded net < gross).
- `app/(app)/paychecks/page.tsx`:
  - YTD memo reduced to `{ ytdIncome, ytdTax }` (income via `calcPaycheckDeposited`, tax via `calcPaycheckTaxToSave`); grid is now 2 cards (`grid-cols-2`) — "YTD Income (deposited)" and "YTD Tax". Removed the Taxable Wages and Tips cards.
  - Per-paycheck "Set aside" column relabeled "Tax"; the "Deposited" figure now uses `calcPaycheckDeposited(p)` (was `netAmount + gratuity`).
  - Live preview bottom lines renamed: "Real money deposited" → "Income (deposited)" (`paychecks.income`), "Tax to set aside" → "Tax" (`paychecks.tax`); removed the "Set aside for taxes" hint line.
  - Imported `calcPaycheckDeposited`.
- `app/(app)/bills/page.tsx` — All three cash-flow paycheck sums now use `calcPaycheckDeposited(p)` instead of `netAmount + gratuity`; imported the helper.
- `locales/en.json` & `locales/vi.json` — paychecks keys: added `ytdIncome`, `ytdTax`, `income`, `tax`; removed now-unused `ytdTaxableWages`, `ytdDeposited`, `ytdTaxToSave`, `ytdTips`, `hsa`, `setAside`, `taxToSetAsideHint`, `realMoneyDeposited`, `taxToSetAside`.
- `lib/__tests__/calculations.test.ts` — Added a `calcPaycheckDeposited` describe block (gross + tips, missing tips → 0, full gross regardless of withheld tax).

**Notes:**
- Account balances are transaction-driven: a newly logged paycheck posts an income transaction for the full amount (`grossPaycheck + gratuity`) and the balance increments by that full amount, so the whole system already uses the deposited amount going forward. Paychecks logged under the OLD net-deposit model still have a net-valued transaction, so their historical account balance reflects net — that historical ledger data is intentionally NOT auto-migrated here (would require a fuzzy paycheck↔transaction match and mutating financial records); offered separately to the user.

**Verification:** `npm run typecheck` clean, `npm run build` succeeds, `npm run lint` 0 errors (pre-existing warnings only), `npm test` 309/309 passing.

## 2026-06-02 — Account delete: block when transactions still reference it (branch claude/awesome-goldberg-6BQLc)

**Goal:** Final part of the money-flow consistency pass. Deleting an account previously removed only the account row, leaving every transaction that referenced it (as source `account` or transfer `toAccount`) as an orphan pointing at a non-existent account. User chose the non-destructive "Block & warn" behavior over cascade-delete.

**Changes:**
- `app/api/accounts/route.ts` — `DELETE` now loads transactions first and counts those where `t.account === id || t.toAccount === id`. If any exist it returns HTTP 409 `{ error: 'account_has_transactions', count }` WITHOUT deleting. Otherwise deletes as before. Imported `getTransactions`.
- `app/(app)/accounts/page.tsx` — `handleDelete` detects the 409, restores the optimistically-removed account, and shows `accounts.toastHasTransactions` (with the count) instead of the generic failure toast.
- `locales/en.json` & `locales/vi.json` — added `accounts.toastHasTransactions` ("Can't delete: {count} transaction(s) still use this account. Move or delete them first.").

**Notes:**
- The transaction check also implicitly covers paycheck deposits and loan principal/payback transfers (those are transactions on the account), so an account in active use by a paycheck or loan can't be silently orphaned either.
- Non-destructive by design: no history is ever deleted; the user reassigns/deletes the referencing transactions (and any linked paycheck/loan) first, then the account.

**Verification:** `npm run typecheck` clean, `npm run lint` 0 errors (pre-existing warnings only), `npm test` 309/309 passing, locale JSON valid.
## 2026-06-02 — Balance Check (reconcile): stop the debt-overpayment clamp from inflating credit-card balances (branch claude/admiring-meitner-3kc96)

**Symptom (user report):** Running the "Balance Check" / reconcile on a credit card (Capital One) proposed a much higher "after" balance (e.g. $1,212.36 → $2,166.54). It behaved as if reconciliation only summed expenses and ignored the income/paybacks.

**Root cause:** `applyTransferToBalance(balance, amount, isDebt)` clamped debt payoffs at zero with `Math.max(0, balance - amount)`, but its inverse `reverseTransferToBalance` (`balance + amount`) did NOT clamp. So `apply` and `reverse` were not true inverses — the exact invariant `deriveOpeningBalance` and `reconcileAccountBalance` rely on. When a card **payment** replays chronologically *before* the charge it covers (a backdated payment, or simply because the opening balance was set to the current owed amount while transaction history exists), the running owed balance is still low/zero at that point, so the clamp silently discards the payment while the later expenses still pile on — inflating the reconciled balance.

**Fix:**
- `lib/calculations.ts` — `applyTransferToBalance` now returns `roundCents(isDebt ? balance - amount : balance + amount)` (no zero clamp). Overpaying a card now yields a legitimate negative (credit) balance — money the bank owes you — and `apply`/`reverse` round-trip exactly. Updated the surrounding reconcile/`deriveOpeningBalance` comments that referenced the now-removed clamp and its "known limitation".
- `lib/__tests__/ledger.test.ts` — Replaced the "clamps debt payoff transfers at zero" test with "lets a debt payoff transfer overshoot into a credit balance" (200 − 300 → −100) plus a new apply/reverse-inverse test. Added a `reconcileAccountBalance` regression test: a backdated card payment that replays before its charge now reconciles to the true owed balance (0), not the inflated value (1000).
- `lib/__tests__/calculations.test.ts` — Updated `applyTransferToBalance` overpayment test (50 − 100 → −50) and replaced the `reverseTransferToBalance` "KNOWN LIMITATION" clamp test with an exact apply/reverse round-trip test.

**Notes:**
- Both the live transaction route and the reconciler go through `nextBalanceForAccount` → `applyTransferToBalance`, so live balances and reconcile stay consistent; live credit-card payoffs that overpay can now show a negative (credit) balance, which is financially correct.
- Verification: standalone Node repro confirmed clamped reconcile = 1000 vs fixed = 0 for the backdated-payment scenario. `tsc --noEmit` shows no errors in the changed files (the unrelated module-not-found errors are because `node_modules` isn't installed in this environment).

## 2026-06-02 — Remove the Balance Check (account reconcile) feature (branch claude/admiring-meitner-3kc96)

**Goal:** Per user request, remove the "Balance Check" / reconcile tool entirely. Balances are transaction-driven and can be adjusted manually, so the reconcile maintenance tool is no longer wanted.

**Changes:**
- Deleted `app/api/accounts/reconcile/route.ts` (the dry-run preview + apply endpoint).
- `lib/calculations.ts` — Removed the entire "Reconciliation" section: `reconcileAccountBalance`, `deriveOpeningBalance`, `detectBalanceDrift`, `planReconcile`, the private helpers `compareTxChronological` and `ledgerForAccount`, and the types `BalanceDrift`, `ReconcileBackfill`, `ReconcilePlan`. Updated the unified-ledger comment ("Both the route and the reconciler…" → "The route's apply/reverse paths…").
- `app/(app)/settings/page.tsx` — Removed the Balance Check card and all its plumbing: the `ReconcilePlan` import, the four reconcile state vars, `checkBalances()`/`applyReconcile()`, and the card JSX. Dropped now-unused imports (`Scale`, `CheckCircle2`, `AlertTriangle` from lucide-react; `formatCurrency`).
- `locales/en.json` & `locales/vi.json` — Removed the 10 `settings.reconcile*` keys from both.
- `lib/__tests__/ledger.test.ts` — Removed the imports and describe blocks for `reconcileAccountBalance`, `deriveOpeningBalance`, `detectBalanceDrift`, `planReconcile` (including the credit-card clamp regression test added earlier). The `nextBalanceForAccount` / `applyTransactionToBalances` tests stay.
- Stale-comment cleanup: `app/api/transactions/route.ts` and `lib/sheets.ts` no longer reference the deleted reconcile endpoint.

**Notes:**
- Kept the shared ledger functions (`nextBalanceForAccount`, `applyTransactionToBalances`, `applyExpense/Income/Transfer*` apply+reverse) — they drive live balance updates on add/edit/delete and are unrelated to reconcile.
- Kept the `Account.openingBalance` field and its self-maintenance in `app/api/accounts/route.ts` plus the sheet column I read/write. It is now unused for computation but harmless; removing it would be a sheet-schema change. (Offered as a separate cleanup if desired.)
- `reconcileBudgetMonths` in `lib/sheets.ts` is a separate budget feature and was left intact.
- Note: this supersedes the credit-card debt-payoff clamp fix from earlier today for the reconcile path specifically — but the clamp removal in `applyTransferToBalance` is retained because it also affects live balance updates (overpaying a card now correctly yields a credit balance instead of being silently discarded).

**Verification:** `locales/*.json` parse OK; no remaining `settings.reconcile` references; no `tsc` errors reference any removed identifier (remaining tsc output is pre-existing missing-`node_modules`/`@types` noise in this environment).

## 2026-06-02 — PR6: Performance (pagination) + README rewrite (branch claude/pr6-performance-cleanup)

**Request (PR6 of 6):** "Performance — reduce loaded transactions (~20–30, expand more), same in Savings; reduce API calls. Cleanup unused/legacy code. Redesign/rewrite README." User said "you decide" on pagination size/style.

**Done (focused, low-risk subset):**
- `app/(app)/transactions/page.tsx` — `PAGE_SIZE` 50 → **25** (page already had visibleCount + "Show more"; just retuned to the requested 20–30 range).
- `app/(app)/savings/page.tsx` — added pagination to the savings transaction history (it previously rendered ALL matching tx): `SAVINGS_PAGE_SIZE = 25`, `visibleCount` state, `selectAccount()` helper that resets the window when the account filter changes, `visibleTx = savingsTx.slice(0, visibleCount)`, and a "Show more" button (reuses `t('transactions.showMore', {count})`).
- `README.md` — full rewrite. Fixes: product name was wrongly **"NoviFi"** throughout → **NovaFi**; corrected Financial Health Score weights (Savings 25 / Emergency 20 / **DTI 20** / **Budget 15** / Trend 10 / Volatility 10 — README had budget/DTI swapped); "liquid net worth excludes loan balances" (was "excludes illiquid investments"); **removed the phantom Daily Push / Vercel Cron section** (no such route exists — verified `app/api` has no cron/push route); updated to **11 sheet tabs** (added Contacts/Splits/Loans); added **Loans & IOUs** and **shared/split bills** (PR1 model) and the **tabbed Settings** (PR5); de-brittled the test-count claim; updated stack to Next.js 16 / React 19 / Tailwind v4 / Radix.

**Deferred (flagged as a follow-up task/PR, intentionally NOT done here to keep PR focused + within budget):** open-ended dead-code/legacy sweep (unused *exports* like possibly `calcDebtScore`/`lib/csv.ts`/`lib/retry.ts` — ESLint already 0 unused vars) and API-call batching (bills page fires 6 parallel fetches; savings 3 — could reuse `batchGet*` helpers in `lib/sheets.ts`). Spawned as a separate task.

**Verification:** `tsc --noEmit` clean; eslint 0 errors (25 pre-existing warnings); 298 tests pass; no "NoviFi" left in README. Branch off master.
## 2026-06-02 — PR5: Settings UI redesign — in-page tabs + polish (branch claude/pr5-settings-redesign)

**Request (PR5 of 6):** "Potentially enhance the UI, more clean and organized." Settings was one long flat scroll of 9 cards. **Iteration history:** (1) first built tabbed in-page pill-nav; (2) user said keep it ONE single page, reverted to non-clickable group bands; (3) user then preferred the tabbed switcher back ("easier to navigate"). **Final = in-page tabs.** The tabs live INSIDE the Settings page (sticky pill row under the page title); the app nav bar (`components/Sidebar.tsx`) is unchanged — "Settings" stays one nav entry. **Lesson: confirm structural direction (tabs vs single page) up front on a "you decide" redesign; the user iterated twice on this.**

**Final design (`app/(app)/settings/page.tsx`, behavior unchanged):**
- **In-page sticky tab nav** (`section` state: `general | taxes | categories | about`), pill buttons with icons, horizontally scrollable on mobile. Each tab renders only its cards.
  - **General**: Name Preference, Language & Region, Dashboard Preferences (toggles).
  - **Taxes & Payroll**: Payroll Deductions, Federal Tax, State & Local, FICA.
  - **Categories**: Custom Categories (add/hide/restore expense + income).
  - **About & Data**: App Update, Data Storage.
- Consistent `SectionTitle` (indigo icon chip + title) on **every** card. Icons: User, Globe, SlidersHorizontal, Receipt, Landmark, Building2, ShieldCheck, Tags, RefreshCw, Database.
- Module-level `ToggleRow` for the 3 dashboard-preference switches (~30 lines dup removed); federal-brackets switch stays custom (colored callout).
- Heavy 2026 IRS bracket **table + standard deduction in a `<details>` expandable** (summary shows active filing status); "Maximize savings" callout stays visible.
- `locales/en.json` + `vi.json`: added `settings.sectionGeneral/sectionTaxes/sectionCategories/sectionAbout`.

All handlers (save/reset/hard-refresh/category add-hide-restore/lang/dark mode) preserved verbatim. Branch off master.

**Verification:** `tsc --noEmit` clean; eslint 0 errors (25 pre-existing warnings); 298 tests pass.
## 2026-06-02 — PR4: UI fixes — toast close button + account-group pluralization (branch claude/pr4-ui-fixes)

**Request (PR4 of 6):** (1) The notification toast's little ✕ didn't close the popup. (2) Creating a Savings/Checking account showed a doubled "s" in the section header ("Savingss", "Checkings") and a stray "s" in Vietnamese.

**Root causes & fixes:**
- `lib/toast.tsx` — `<Toast.Root open>` was hard-coded open with no `onOpenChange`, so Radix's close (✕ click, swipe, duration) could never actually dismiss it; removal relied solely on a manual `setTimeout`. Fixed: dropped the forced `open`, added per-toast `duration={t.action ? 6000 : 3500}` and `onOpenChange={(open)=>{ if(!open) remove(t.id) }}` so the close button, swipe, and auto-timeout all funnel through one removal path (and auto-dismiss now pauses on hover, via Radix).
- `app/(app)/accounts/page.tsx` — section header rendered `{label}s` (singular type label + literal "s"). Added `ACCOUNT_TYPE_GROUP_LABELS` (localized plurals) and render `{label}` instead. `ACCOUNT_TYPE_LABELS` (singular) is still used by the add-account type picker.
- `locales/en.json` + `vi.json` — added `accounts.groupChecking/Savings/Credit/Investment/Loan` (en: "Checking", "Savings", "Credit Cards", "Investments", "Loans"; vi: natural noun forms with no plural "s").

**Verification:** `tsc --noEmit` clean; eslint 0 errors (25 pre-existing warnings); 298 tests pass. Branch off master.
## 2026-06-02 — PR2: Edit button for Loans / IOUs (full edit) (branch claude/pr2-loan-edit)

**Request (PR2 of 6):** Loans & IOUs had add / payback / delete but no edit. User chose FULL edit — including principal amount & account — with the principal cash transfer adjusted so balances stay correct.

**Changes:**
- `app/api/loans/route.ts` — added `PUT { updated, newTx?, removeTxId? }`: reverses+deletes the old principal transfer and applies the new one in one in-memory balance pass (`applyTransactionToBalances` + `persistChanged`), then `upsertLoan(updated)`; invalidates tx/accounts/dashboard/badges + loans caches. Paybacks (`repaymentTxIds`) are untouched — only the principal cash row is rebuilt.
- `app/(app)/transactions/page.tsx` — new `editingLoanId` state; `openEditLoan(loan)` pre-fills the existing inline loan form; `handleEditLoan()` rebuilds the principal `transfer` via `buildLoanTx(direction,'principal',…)` from the edited amount/account/direction/date, recomputes `settled` against the new principal (`repaidAmount >= principal`), and calls the PUT with `removeTxId = original.principalTxId`. The inline form's save button switches between add/edit (`handleEditLoan` + `loans.saveChanges`); added a Pencil edit button on each open-loan card; modal close / cancel / add all reset `editingLoanId`.
- `locales/en.json` + `vi.json` — added `loans.toastUpdated`, `loans.saveChanges`.

**Notes:** Editing direction with existing paybacks is an unusual combo — paybacks keep their original cash direction (only the principal transfer is rebuilt); typical edits (fix amount/account/note/contact/date on a fresh loan) are exact. Branch is off master (does not include PR1).

**Verification:** `tsc --noEmit` clean; eslint 0 errors (25 pre-existing warnings); 298 tests pass.
## 2026-06-02 — PR1: Shared bills as Loan-style receivables + dashboard "my share" sync + due-date colors (branch claude/pr1-bills-loan-model)

**Request (NovaFi enhancement, PR1 of 6):** When paying a SHARED bill, the FULL amount should leave the assigned account (you really pay the whole bill), but your expense tracker must count only YOUR share. The other person's share is tracked like a Loan receivable ("Owed to You"); when you mark them transferred, that cash returns to the account (NOT income, but logged in transfer history). Plus: dashboard summaries must use "my share" for bills everywhere; budget summary must include rollover; due-date colors red ≤3d / yellow 4–7d; fix the mobile-truncated HealthBanner subtitle.

**Model (mirrors loans):** On pay → my-share `expense` (counts as spending) + a `transfer` cash-OUT of the friend's share (empty counterparty, so it moves the balance but is NOT income/expense). On settle → a `transfer` cash-IN of their share (empty counterparty). Net account impact = your share; spending = your share always; the receivable is the friend's share. Delete reverses both transfers atomically server-side.

**Changes:**
- `types/index.ts` — `Split` gains `frontedTxId?` / `settleTxId?` (ids of the fronted-out and settle-in transfers).
- `lib/sheets.ts` — `SPLITS_HEADER` + 2 cols (`fronted_tx_id`, `settle_tx_id`); `getSplits` range `A2:M1000` parses `r[11]`/`r[12]`; `upsertSplit` writes them; `deleteRowById` last-col `K`→`M`. Legacy rows read as `''` (note-only).
- `lib/calculations.ts` — added exported `myBillShare(bill)` (single source of truth; full amount unless split → `calcSplitShares(...).mine`).
- `app/api/splits/route.ts` — rewritten to mirror loans route: POST accepts bare `Split`, `{split, tx}` (write+apply balance), or `{split, removeTxId}` (reverse+delete); DELETE reverses `frontedTxId`+`settleTxId` atomically via `applyTransactionToBalances` + `persistChanged`.
- `app/(app)/bills/page.tsx` — removed local `myBillShare` (imports shared one); added `buildSplitTx('cashOut'|'cashIn', …)` (transfer w/ empty counterparty); `handleRecordPayment` fronts friend's share when an account is selected (bundled `{split, tx}`), note-only otherwise; `handleSplitToggle` settle→cash-in `{split, tx}`, unsettle→`{split, removeTxId}`; due-date colors: `isUrgent = daysUntil<=3` (red, incl. overdue), `isDueSoon = 4..7` (yellow), else normal — applied to card border, icon, amount.
- `app/(app)/dashboard/page.tsx` — `billsThisMonth` + `upcomingBillsTotal` + bill-forecast row amount now use `myBillShare`; `budgetData` adds `rolledOver` (via `calcRolloverDeficit` when `settings.budgetRollover`); `overBudgetCount` compares `spent+rolledOver` to cap.
- `app/(app)/dashboard/DashboardCharts.tsx` — `BudgetData` gains `rolledOver?`; `BudgetBars` uses `usage = spent + rolledOver` for pct/over/remaining/projected and shows a `+{rolledOver} from last month` amber chip; `HealthBanner` subtitle no longer one truncating string — renders wrapping segments `{net}` · `{after bills}` (and `overIncome`/`recordPaycheckHint` branches) so it doesn't clip on mobile.
- `locales/en.json` + `vi.json` — added `bills.txFronted`, `bills.txSettled`; rewrote `bills.splitHelp` / `bills.splitPayNote` for the full-charge model; added `charts.netLabel`, `charts.afterBills`, `charts.overIncome`, `charts.recordPaycheckHint`.
- `lib/__tests__/calculations.test.ts` — added `myBillShare` suite (4 cases).

**Verification:** `tsc --noEmit` clean; eslint 0 errors (pre-existing setState-in-effect + `_lastCol` warnings only); 302 tests pass (was 298 + 4 new). User confirmed: no existing shared-bill data to migrate.
## 2026-06-02 — NovaFi enhancements: budget MoM w/ rollover, modal top clipping, sign-out → Settings + confirm, compact 2-decimals, loans-as-expense balance (branch claude/practical-kare-cf7794)

**Request (4 areas):** (1) Budget "vs last month" comparison should use the current month's USAGE including the rolled-over amount (rollover treated as current-month usage). (2) UI: modal/pop-up top was being clipped by the app top frame (status bar / header) — fix so the whole popup shows like Bills; also: confirm before signing out (misclick guard) and MOVE sign-out into Settings. (3) Transactions: show numbers to 2 decimals, collapsing to k/m when they don't fit the container. (4) Loans: lending ("lent") assigned to a credit card was reducing the owed balance like a payoff instead of adding to it; treat lent as an expense for the balance only (money moves), without affecting real income/expense totals.

**Changes:**
- `lib/utils.ts` — `formatCompact` now keeps up to 2 decimals for K/M (was `.toFixed(1)`), trimming trailing zeros via `parseFloat(n.toFixed(2)).toString()` ($1.23K, $5M, $1.2K). Values < $1,000 still use `formatCurrency` (2 decimals). Used by the Transactions income/spending/net summary cards.
- `lib/calculations.ts` — made the transfer "from" side debt-aware. `applyTransferFromBalance(balance, amount, isDebt)` now returns `balance + amount` for debt accounts (a charge/cash-advance INCREASES owed) and `balance - amount` for assets; `reverseTransferFromBalance(balance, amount, isDebt)` is its exact inverse. `nextBalanceForAccount` passes `isDebt` to both. Loans stay `type: 'transfer'`, so they never count toward income/expense totals — only the account balance moves. Fixes lending charged to a credit card (was treated like a payoff). NOTE: pre-existing credit-card loans created under the old formula will reverse with 2×amount drift if later edited/deleted (acceptable per the personal-use migration; no data migration written).
- `app/(app)/planning/page.tsx` — budget card `momDiff` changed from `spent - prevSpent` to `usage - prevSpent` (usage = spent + rolledOverDeficit), so "+$X vs last mo" reflects the effective bar including rollover.
- `components/ui/Modal.tsx` — ROOT CAUSE of the top-clipping (confirmed from the user's screenshot): the page renders inside `app/(app)/layout.tsx`'s `<main class="relative z-10">`, which creates a stacking context; the sticky `MobileHeader` is a SIBLING at `z-40`. So the modal's `z-[200]` only competed INSIDE main's z-10 layer — at the page level the whole modal sat below the z-40 header, which painted over the modal's title (and the backdrop never dimmed the header). Fix: render the modal through `createPortal(content, document.body)` (mount-gated via a `mounted` state to avoid SSR/hydration mismatch) so it escapes main's context and `z-[200]` wins over header (z-40) and nav (z-50). Also (belt-and-suspenders for the notch) added container `paddingTop: env(safe-area-inset-top)` and changed the mobile sheet `max-h` from `88dvh` to `calc(100dvh - 4.5rem - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 1rem)`. Desktop unchanged (`sm:max-h-[90vh]`, centered). Fixes every page using the shared Modal (loans, bills, transactions, planning, …).
- `components/Sidebar.tsx` — removed the Sign Out button from the desktop sidebar footer, the `MobileHeader` (now logo-only), and the mobile "More" sheet (Customize button now full-width). Dropped the now-unused `signOut` + `LogOut` imports; `MobileHeader` no longer needs `useTranslation`.
- `app/(app)/settings/page.tsx` — added an "Account" card in the General section with a Sign Out button; `handleSignOut()` confirms via `t('settings.signOutConfirm')` before `signOut({ callbackUrl: '/' })`. Imported `signOut` from next-auth/react and `LogOut` icon.
- `locales/en.json` + `vi.json` — added `settings.account`, `settings.signOutDesc`, `settings.signOutConfirm`.
- `lib/__tests__/calculations.test.ts` — updated `applyTransferFromBalance`/`reverseTransferFromBalance` suites for the new `isDebt` arg, added debt-account cases + apply/reverse inverse check.
- `lib/__tests__/ledger.test.ts` — added two `nextBalanceForAccount` cases: lending charged to a credit card increases owed (200→300), and reverse is its exact inverse.

**Verification:** `tsc --noEmit` clean; eslint 0 errors (25 pre-existing warnings); 288 tests pass. Image in the request (.heic) couldn't be read (OS sandbox); confirmed with user that the top-frame issue was the modal top being cut off by the header, and that sign-out should be moved into Settings (not duplicated).

## 2026-06-02 — PR3: Balance-sync safety — writes never auto-retry on ambiguous failures (branch claude/pr3-balance-sync-safety)

**Request (PR3 of 6):** "Accounts/Savings synced with related transactions (reverse correctly if a transaction is removed); safe/optimized so it won't mess up if a transaction failed."

**Audit findings (verified, no change needed):** every balance-mutating route already writes the ledger row first (source of truth) then applies/reverses balances via the shared `applyTransactionToBalances` + `persistChanged`, and **reverses correctly on delete** — confirmed `'reverse'` paths in transactions, loans, splits, and paychecks routes (loans/splits/paychecks also cascade-reverse their linked cash transfers server-side, from earlier hardening). Balances are stored (not recomputed on read) and `openingBalance` is preserved on edit; switching to recompute-on-write was rejected as unsafe (it would silently overwrite manually-adjusted balances — the reason the manual reconcile tool was removed).

**The one residual hole → fixed (`lib/retry.ts`):** the retry proxy retried **non-idempotent writes** (`append`/`update`/`batchUpdate`) on **network-layer errors** (ECONNRESET/ETIMEDOUT, no HTTP status). Such a drop can occur *after* the server already processed the write (lost response), so retrying could **duplicate a transaction** and permanently distort a balance — the exact "messed up" failure mode. Fixed by gating both 5xx **and** network-error retries behind the `idempotent` flag (renamed from `allow5xx`): idempotent reads (`get`/`batchGet`) still retry on 429/5xx/network; writes now retry **only on 429** (the quota gate rejects before processing, so it's provably safe). A dropped write now surfaces a visible error the caller can safely re-issue, instead of silently double-applying money. Updated the file's header policy comment and the proxy's per-call comment.

- `lib/__tests__/retry.test.ts`: rewrote the network-retry case to assert reads retry / writes don't; added a `withRetryProxy` test that a network error retries on `get` but not on `append`.

**Verification:** `tsc --noEmit` clean; eslint 0 errors (25 pre-existing warnings); 303 tests pass. Branch off master (which already has PR1/PR2/PR4/PR5 merged).

## 2026-06-02 — Bills: "Owed to You" moved into a Loans-style modal w/ expandable history (branch claude/laughing-aryabhata-caeb92)

**Request:** On the Bills page, replace the inline shared-payments ("Owed to You") list with a clickable container that opens a modal (styled like the Loans/IOUs modal on the transactions page). Reuse the existing `Split` data (auto-created when a shared bill is paid — no new store, no manual add). Modal shows all *unchecked* (pending/unsettled) shares; the settled history is hidden behind an expandable button and shows only the **10 most recent**.

**Decisions (from clarifying Qs):** data source = reuse existing splits / `/api/splits`; entry = auto from bill payments (unchanged); "10 recent transactions" = show all unchecked shares, hide history behind an expandable toggle, history capped at 10.

**Changes (all in `app/(app)/bills/page.tsx` + locales):**
- Imported `ChevronDown` from lucide-react.
- New state: `sharingOpen` (modal), `showSharingHistory` (history expand toggle).
- Replaced the inline `{splits.length > 0 && (...big list...)}` block (pending + settled rendered together) with a single clickable summary `<button>` (HandCoins icon, `bills.owedToYou` label, `bills.sharedOpenCount` subtitle, total owed + pending-count badge) that calls `setSharingOpen(true)`. Mirrors the loans summary button pattern on the transactions page.
- Added a new `<Modal open={sharingOpen}>` after the bill add/edit modal: total-owed card, per-person breakdown chips (`owedByContact`), the full pending list (`pendingSplits`) each with the unchecked settle toggle (`handleSplitToggle`) + delete (`handleDeleteSplit`), and a collapsible History section gated on `settledSplits.length > 0` — toggled by `showSharingHistory`, rendering `settledSplits.slice(0, 10)` (checked box can un-settle, delete available). Empty state = `bills.sharedEmpty`. Closing the modal also resets `showSharingHistory`.
- Reused existing derived values (`pendingSplits`, `settledSplits`, `totalOwed`, `owedByContact`) and handlers — no new API/data-model changes.
- `locales/en.json` + `vi.json` — added `bills.sharedTitle`, `bills.sharedOpenCount` ({n}), `bills.sharedEmpty`, `bills.sharedHistory` ({n}).

**Verification:** `tsc --noEmit` clean; both locale JSONs valid; eslint on the page = 0 new issues (only the 2 pre-existing warnings at lines 412 & 661).

## 2026-06-02 — Split-an-expense (one-time, multi-person) + Contacts management in Settings (branch claude/hopeful-lichterman-5a4819)

**Request:** Building on the loan + shared-bill model, add a way to split a *one-time* expense across **multiple** people at once (e.g. "I paid for dinner for the group") and log it like the shared-bill calculation. Also add a Contacts section in Settings to add/remove contacts, while keeping the inline "add new contact" option in the split flows.

**Decision — contacts are persistent (not localStorage):** the app already has a Google-Sheets-backed `Contact` entity with a full `/api/contacts` (GET/POST/DELETE) + `getContacts/upsertContact/deleteContact` in `lib/sheets.ts`. Since the user also wants a managed Contacts UI in Settings, reusing the existing persistent contacts is the clean/safe choice (available on every device, survives reinstalls). No new data model added — one-time splits reuse the existing `Split` receivable + cash-fronting machinery (each participant = one `Split`, tied together by a generated `billId` groupId; `billName` = the expense description).

**Changes:**
- `lib/calculations.ts` — exported `roundCents` (was module-private) so the bills page can reuse it for share math.
- `app/(app)/bills/page.tsx` — added a one-time "Split an Expense" feature:
  - Imports: added `X`, `Split as SplitIcon` from lucide-react; added `roundCents` from calculations.
  - New constants/types: `EMPTY_SPLIT_EXPENSE` (description/total/date/account/category/includeMe), `SplitParticipant` type `{key, contactId, amount, newName}`, `emptyParticipant()`.
  - New state: `splitExpenseOpen`, `splitExpenseForm`, `splitParticipants` (array, starts with one empty row), `savingSplitExpense`.
  - Handlers: `openSplitExpense`, `updateParticipant`/`addParticipantRow`/`removeParticipantRow`, `handleAddParticipantContact` (per-row inline create via `/api/contacts`, reuses `addingContact` state), `splitEqually` (divides total across rows + you when `includeMe`; remainder absorbed by your derived share, or the last person when you're excluded), and `handleSaveSplitExpense`.
  - `handleSaveSplitExpense` logic: your share (`total − sum(participant shares)`, ≥0) is the only real **expense** transaction (POST `/api/transactions`); each participant's share is posted **sequentially** to `/api/splits` (sequential, NOT parallel — every fronted `cashOut` transfer mutates the same account balance server-side, so parallel writes would race) as `{split, tx: frontedTx}` when an account is chosen (note-only `Split` otherwise). Reuses `buildSplitTx('cashOut', …)` + `t('bills.txFronted')`. Validates ≥1 participant with share>0 and that shares don't exceed the total; optimistically prepends the new splits and falls back to `load()` on failure. These splits then appear/settle/delete in the existing "Owed to You" modal with zero extra code.
  - Header: wrapped the action buttons; added a secondary "Split Expense" button (`SplitIcon`) beside "Add Bill".
  - New `<Modal>` (after the shared-payments modal): description, total, date, category, optional account, an "Include my share" toggle + "Split equally" button, repeatable participant rows (contact `<Select>` with the `NEW_CONTACT` sentinel → inline name input + Add button; per-row share `<Input>`; remove `X`), an "Add person" dashed button, and a live your-share / they-owe summary with an over-total warning (`seOver` disables Save).
- `app/(app)/settings/page.tsx` — added a "Contacts" section:
  - Imports: added `Users`, `UserPlus`, `Trash2` icons; `Contact` type; `generateId` from utils; `useToast`. New `SectionId` member `'contacts'`.
  - State: `contacts`, `newContactName`, `addingContact`, `toast`. New `useEffect` fetches `/api/contacts` on mount (sorted by name; swallows the missing-tab case). Handlers `addContact` (dedupes case-insensitively, optimistic add, rollback on failure) and `removeContact` (confirm + optimistic delete, rollback on failure).
  - Added `{ id: 'contacts', label: …, icon: Users }` to `SECTIONS` (between Categories and About) and a new render block: add-by-name input (Enter to submit) + avatar-initial list with per-row delete, empty state, and a note that contacts are saved to the Sheet and removal keeps past records intact.
- `locales/en.json` + `vi.json` — added bills keys: `splitExpense`, `splitExpenseTitle`, `splitExpenseHelp`, `splitExpensePlaceholder`, `totalAmount`, `whoShared`, `splitEqually`, `includeMe`, `person`, `addPerson`, `theyOwe`, `recordSplit`, `splitExpenseNeedPeople`, `splitExpenseOverTotal`, `toastSplitExpense` ({n},{amount}); and settings keys: `sectionContacts`, `contactsTitle`, `contactsDesc`, `contactNamePlaceholder`, `addContactBtn`, `contactsEmpty`, `contactsNote`, `contactAdded`, `contactSaveFailed`, `contactDeleteConfirm` ({name}). NOTE: `t()` only does flat `{key}` substitution (no ICU plurals), so the toast uses a plain "{n} people" form.

**Verification:** `tsc --noEmit` clean; both locale JSONs valid; eslint on both pages = 0 new errors (only the pre-existing set-state-in-effect / impure-Date warnings).

### Follow-up — group "Owed to You" splits by bill/expense (same branch)

**Request:** In the "Owed to You" tracker, group splits that belong to the **same bill/expense** so a one-time multi-person split (e.g. a dinner with 3 people) shows as **one card** with a per-person breakdown, instead of 3 separate lines — easier to track.

**Where it saves (clarified for the user, no change):** one-time splits persist to the **Splits** sheet tab (one row per participant, tied by a generated `billId` groupId) + the **Transactions** tab (your expense + per-person fronted transfers). The **Loans** tab is untouched. Confirmed `billId` is only ever a stored field — never used to look up a `Bill` — so a synthetic groupId is safe.

**Changes (all in `app/(app)/bills/page.tsx` + locales):**
- Added module-scope `SplitGroup` type + `groupSplits(list)` helper: groups by key `` `${billId || id}|${date}` `` (falls back to the split's own id when `billId` is blank so legacy rows never merge), preserving first-seen order (callers pre-sort by date). One-time multi-person events collapse (same billId + date); each recurring-bill monthly payment stays its own group; the `|date` keeps different occurrences of the same recurring bill separate.
- Added `pendingGroups`/`settledGroups` memos (= `groupSplits(pendingSplits)` / `groupSplits(settledSplits)`).
- Rewrote the tracker modal's pending + history lists to iterate **groups**: a group of 1 renders the **existing flat row** (so normal shared bills look unchanged); a group of >1 renders a **card** — header with `Users` icon, bill name, `{n} people · since {date}` (pending) / `{n} people · settled {date}` (history), and the group total — followed by one compact sub-row per person (settle checkbox + name + amount + delete). Per-person settle/delete is unchanged; history still capped at 10 groups.
- `locales/en.json` + `vi.json` — added `bills.groupOwedSince` ({n},{date}) and `bills.groupTransferredOn` ({n},{date}).

**Verification:** `tsc --noEmit` clean; both locale JSONs valid; eslint 0 new errors (only the 2 pre-existing warnings, now at lines 447 & 803); 289 tests pass.

### Follow-up — move one-time Split Bills to Transactions; accordion groups; shared lib (same branch)

**Request + clarifications:** Move the one-time "Split Expense" feature off the Bills page onto the **Transactions** page (it's a one-time expense, unrelated to recurring Bills). Group view = **inline accordion** (collapsed group row: description + date + total → click expands down to reveal each person + amount + settle/delete). Entry point = **separate button**, and **rename both buttons shorter** ("Split Bills"→ button "Splits"; "Loans/IOUs"→ "Loans").

**Interpretation (stated to user):** since the one-time split is unrelated to Bills, the WHOLE one-time feature moved — creator **and** its tracking. Bills keeps only recurring shared-bill splits. The two kinds share the same `Split` sheet/API; they're told apart by a `oneoff:` prefix on the one-time split's `billId`.

**New shared module `lib/splits.ts`** (extracted so both pages stay DRY):
- `ONEOFF_PREFIX = 'oneoff:'`, `newOneOffGroupId()`, `isOneOffSplit(s)` — the discriminator. Robust: never loads bills, survives bill deletion.
- `buildSplitTx(kind,…)` — moved out of bills page (the `transfer` builder for fronted/settle cash).
- `SplitGroup` type + `groupSplits(list)` — moved out of bills page (groups by `billId|date`, falls back to split id when billId blank).
- `lib/calculations.ts` `roundCents` is now exported (used by both pages); transactions page already had its own local `roundCents` (kept).

**`app/(app)/bills/page.tsx` — removed the one-time feature:**
- Dropped the "Split Expense" header button (back to a single "Add Bill" button), the whole Split-Expense modal, its state (`splitExpenseOpen/Form`, `splitParticipants`, `savingSplitExpense`), all its handlers (`openSplitExpense`, participant CRUD, `handleAddParticipantContact`, `splitEqually`, `handleSaveSplitExpense`), the `EMPTY_SPLIT_EXPENSE`/`SplitParticipant`/`emptyParticipant` consts, the local `buildSplitTx`/`groupSplits`/`SplitGroup` (now imported from `lib/splits`), and the `seTotal/seOthersSum/seMyShare/seOver` preview vars.
- Imports `buildSplitTx, groupSplits, isOneOffSplit` from `lib/splits`; dropped now-unused `roundCents`, `X`, `Split as SplitIcon` imports.
- The "Owed to You" tracker now filters to `!isOneOffSplit` (new `billSplits` memo feeds `pendingSplits`/`settledSplits`); the summary button is gated on `billSplits.length > 0`. The grouped-card rendering I added earlier stays (recurring splits are single-person → render as flat rows).

**`app/(app)/transactions/page.tsx` — added the feature (mirrors the existing Loans/IOUs pattern):**
- Imports `Check`, `Split as SplitIcon`; `Split` type; `buildSplitTx, groupSplits, isOneOffSplit, newOneOffGroupId` from `lib/splits`. Added `EMPTY_SPLIT_EXPENSE`/`SplitParticipant`/`emptyParticipant` consts.
- State: `splits`, `splitsOpen`, `showSplitExpense` (inner add view), `splitExpenseForm`, `splitParticipants`, `savingSplitExpense`, `settlingSplitId`, `expandedSplitGroups` (Set<string> for the accordion), `showSplitHistory`. `load()` now also fetches `/api/splits`.
- Derived: `oneOffSplits = splits.filter(isOneOffSplit)` → `pendingSplits`/`settledSplits` → `pendingSplitGroups`/`settledSplitGroups` (`groupSplits`), `totalOwedSplits`. Plus `seTotal/seOthersSum/seMyShare/seOver` form preview.
- Handlers ported: `openSplitExpense`, participant CRUD, `handleAddParticipantContact` (reuses `addingContact`/`NEW_CONTACT`), `splitEqually`, `handleSaveSplitExpense` (billId = `newOneOffGroupId()`; sequential split POSTs; calls `load()` when an account was involved so balances/ledger refresh), `handleSplitToggle`, `handleDeleteSplit`, `toggleSplitGroup`. Reuses `t('bills.*')` strings for the create form + per-person labels.
- UI: a "Splits" header button (with pending-count badge) next to "Loans"; a Split-Bills summary card (shown when pending>0); and the **Split Bills modal** — inner "Split an expense" add view (toggled like loans' `showAddLoan`), total-owed card, then **collapsed group rows** (chevron + description + `{contactName|N people} · since {date}` + group total) that expand in-place to per-person settle/delete rows; settled **History** is collapsible (last 10 groups). For 1-person groups the subtitle shows the contact name instead of "1 people".
- Renames: `loans.title` "Loans & IOUs"→"Loans" (en) / "Vay & Nợ"→"Khoản vay" (vi); new `splits` namespace (`tab`="Splits"/"Chia", `title`="Split Bills"/"Chia hóa đơn"). Removed the now-dead `bills.splitExpense` key from both locales.

**Verification:** `tsc --noEmit` clean; both locale JSONs valid; eslint 0 errors (only pre-existing setState-in-effect / impure-Date warnings); 289 tests pass.

### Follow-up — Split Bills: blank amount = auto-divide remainder (same branch)

**Request:** In the split form, allow typing individual amounts AND leaving a person's amount box blank → blank boxes auto-split the remaining balance (total − typed amounts) equally. Examples ($200): typed 50/70/35 + 1 blank → blank=45; typed 50/70 + 2 blank → each=40. Plus a button to auto-divide (clear all → even split).

**New pure helper `computeSplitShares(total, amounts, includeMe)` in `lib/splits.ts`** (`amounts[i] = number | null`, null = blank/auto): returns `{ shares[], myShare, over }`. Blank entries evenly divide `total − explicitSum`; `includeMe` adds you as one extra auto share; rounding leftover lands on the last auto party (you when included, else the last blank person) so shares sum exactly to total. `myShare` = what you actually pay (the real expense); `over` = typed amounts already exceed total. Imports `roundCents` from `lib/calculations` (no cycle). Fully unit-tested in new `lib/__tests__/splits.test.ts` (10 cases incl. the user's 45 / 40 / rounding examples + isOneOffSplit + groupSplits).

**`app/(app)/transactions/page.tsx`:**
- `EMPTY_SPLIT_EXPENSE.includeMe` default flipped to **false** — matches the user's examples where the listed people fully cover the bill (your share 0). Toggle still lets you join the even split.
- Live preview + save both compute via `computeSplitShares` over only rows that name a contact (`seNamedRows` / `namedRows`); blank rows resolve to their auto share. `seShareByKey` maps each row → its computed share for the input placeholder.
- Each participant amount box: when its row has a contact and the box is blank, the label switches to `bills.shareAuto` ("Their share (auto)") and the placeholder shows the live auto amount. Added a `bills.splitAutoHint` line under the list.
- `splitEqually()` now just clears every amount (→ all auto → even split incl. you when toggled) instead of filling numbers.
- New locale keys `bills.shareAuto`, `bills.splitAutoHint` (en + vi).

**Verification:** `tsc` clean; eslint 0 errors; 299 tests pass (was 289).

**PENDING (asked user to clarify):** request to add multi-person GROUP loans in the Loans/IOUs form using the same auto-divide calc — awaiting answers on per-person-records vs combined, and total-vs-per-person amount.

### Follow-up — Group loans (multi-person) with auto-divide (same branch)

**Request + clarifications:** In Loans/IOUs, allow selecting multiple people in one go. Answers: (1) create **separate per-person loan records** (each paid back/settled independently), (2) entered amount is the **TOTAL, divided with the same auto-divide** (type a person's amount or leave blank to split the remainder), (3) **single-person loans unchanged** — the group UI only appears once a 2nd person is added.

**`app/(app)/transactions/page.tsx`:**
- New state `loanParticipants: SplitParticipant[]` (reuses the split `SplitParticipant`/`emptyParticipant`). Used only for NEW loans; **editing stays single-contact** via `loanForm`.
- Handlers: `updateLoanParticipant`/`addLoanParticipantRow`/`removeLoanParticipantRow`, `loanSplitEqually` (clears all amounts → even split), `handleAddLoanParticipantContact` (inline new contact per row).
- `handleAddLoan` rewritten: total = `loanForm.amount`; per-person principal = `computeSplitShares(total, amounts, /*includeMe*/ false).shares[i]` (blank rows auto-divide the remainder). Creates one `Loan` per resolved participant, posted **sequentially** to `/api/loans` (balance races), each with its own `buildLoanTx` principal transfer when an account is set. Shares the direction/date/note/account. Partial-failure path calls `load()` to reconcile. Toasts `loans.toastAddedGroup` ({n}) for >1, else `loans.toastAdded`.
- Derived preview: `loanTotal`, `loanNamedRows`, `loanComputed`, `loanShareByKey` (per-row auto placeholder), `loanOver`, `loanUnassigned` (= `myShare`, the leftover when typed amounts underfill the total), `loanIsGroup` (≥2 rows), `loanCanSave` (edit → contact+amount; add → amount + ≥1 named row + !over).
- Form JSX: `editingLoanId ? <single contact Select (unchanged)> : <participants list>`. In add mode, each row is a contact Select; the per-person **amount box, remove (X), "Split equally", auto-hint, and per-row remove only render when `loanIsGroup`** (≥2 people) — so 1 person looks exactly like before. The amount field label switches to `bills.totalAmount` when group. Shows `loans.unassigned` (amber) when leftover >0 and `bills.splitExpenseOverTotal` (rose) when typed > total. Save button label → `loans.addLoans` when group. Open/cancel reset `loanParticipants` to one empty row.
- Reuses split i18n (`bills.splitEqually/shareAuto/theirShareShort/splitAutoHint/totalAmount/splitExpenseOverTotal/newContactName/addContact/selectContact/addNewContact`). New `loans.*` keys: `addLoans`, `people`, `addPerson`, `unassigned` ({amount}), `toastAddedGroup` ({n}) — en + vi.

**Verification:** `tsc` clean; both locale JSONs valid; eslint 0 errors (2 pre-existing warnings); 299 tests pass.

### NovaFi enhancement batch — reports fixes, loan categories, category archive (branch `claude/novafi-enhancement-discussion-C6KKf`)

User raised a multi-part enhancement discussion (split bills/loans, reports, custom categories, notifications). After a Q&A round the decisions were: splits/loans → self-sentinel + `participants[]` (already largely built for one-off splits & group loans); **best savings month → keep net (income − expense)** (no change); **category delete → Archive/Delete/Cancel**; **notifications → skipped**. This batch implements the contained, high-confidence pieces.

**1. Spending pace ignored budget rollover (Reports bug).**
- `lib/calculations.ts` `calcSpendingPace` now takes an optional 5th arg `rolloverDeficit: Record<string, number> = {}`. The deficit is added as a FLAT carryover to both the effective `spent` (via `calcEffectiveSpent`) and the `projected` total, but NOT to the daily `pace`/rate-projection (which stay derived from the actual month spend). Previously a rolled-over category already over budget reported `onTrack` because the carried deficit was dropped entirely.
- `app/(app)/reports/page.tsx`: `load()` now also fetches `/api/settings` → new `budgetRollover` state. The pace `useMemo` computes prev-month category spend and, when `budgetRollover` is on, builds a `rolloverDeficit` map per budget via `calcRolloverDeficit(normalizeMonthlyBudget(...), prevSpend)` and passes it to `calcSpendingPace`. Imports `calcRolloverDeficit, normalizeMonthlyBudget`.
- Tests: new `describe('calcSpendingPace')` block in `lib/__tests__/calculations.test.ts` (4 cases: over via actual spend; onTrack w/o rollover; carryover flips to over; carryover is flat not part of pace).

**2. Monthly cash-flow chart dropped month labels (Jan/Mar/May/Sep…).**
- Not a data bug — Recharts auto-thinned the X axis. `app/(app)/reports/page.tsx` cash-flow `<XAxis>` now has `interval={0} minTickGap={0}` and `fontSize: 10` so all 12 labels render.

**3. Categories on Loans (history lookup).**
- `types/index.ts` `Loan` gains `category: string` ('' = uncategorized; stays out of spending since loans are `transfer`s).
- `lib/sheets.ts`: `LOANS_HEADER` appends `category` (col N); `getLoans` range `A2:M1000`→`A2:N1000` and reads `r[13]` (legacy rows → ''); `upsertLoan` writes `loan.category ?? ''`. `deleteRowById`'s `_lastCol` is unused so no other change. Backward compatible (additive column).
- `app/(app)/transactions/page.tsx`: `EMPTY_LOAN_FORM.category=''`; group-loan create (`handleAddLoan`), `openEditLoan`, and `handleEditLoan` all carry `category`; payback handler already spreads `...loan`. New category `<Select>` (options = `common.none` + `expenseCategories`) added to the loan form after the account select. (Splits already stored a category.)
- `app/api/loans/route.ts` passes the `Loan` through verbatim — no change needed.

**4. Custom-category Archive vs Delete (Archive/Delete/Cancel).**
- Model: the existing `hidden{Expense,Income}Categories` set is reused as the **archive** set for BOTH built-in and custom categories. Archived = excluded from entry dropdowns but still returned for history filters.
- `app/api/categories/route.ts` GET: builds `allExp/allInc = [...builtins, ...custom]`, returns `expense/incomeCategories` = not-hidden and new `archived{Expense,Income}Categories` = hidden. (Previously customs were never filtered by hidden.)
- `hooks/useCategories.ts`: bumped cache key to `nf_categories_v2`; now also returns `archived{Expense,Income}Categories`. Shared `apply()` sets all four.
- `app/(app)/transactions/page.tsx`: destructures the archived lists; the history category **filter** renders archived chips after active ones (muted, dashed border, `Archive` icon, `categories.archivedHint` tooltip) so past transactions stay filterable. Imported `Archive` from lucide.
- `app/(app)/settings/page.tsx`: new state `catToRemove` ({cat, kind:'exp'|'inc'}) and `catUsage` (per-category transaction counts fetched from `/api/transactions` on mount). Custom-category chips now filter out archived ones and their X opens a **dialog** (`Archive` / `Delete` / `Cancel`). Archive → `hide{Exp,Inc}Cat`; Delete → `remove{Exp,Inc}Cat` but **disabled when `catUsage[cat] > 0`** (shows `categories.deleteBlocked` with the count, steering to Archive). The former "Hidden — click to restore" sections are re-themed amber and relabelled `categories.archivedSection` + `restoreHint`. Built-in chip X still archives directly (can't delete a built-in). Imported `Archive`.
- i18n: new `categories.*` keys (en + vi): `archivedHint, archiveTitle, archivePrompt {name}, archiveAction, archiveDesc, deleteAction, deleteDesc, deleteBlocked {count}, archivedSection, restoreHint`.

**Not done this batch (discussed):** recurring-Bills multi-person + "me" participants (one-off splits & group loans already support it; recurring `Bill` is still single `splitContactId`/`splitAmount` — flagged as the larger, schema-touching follow-up). Best-savings-month left as net income−expense per user's choice. Notifications/Vercel Cron skipped per user.

**Verification:** `tsc --noEmit` clean; eslint 0 errors (only pre-existing setState-in-effect / `_lastCol` warnings); 309 tests pass (was 299).

### Follow-up — multi-person bills, loan grouping, per-person split mode (same branch)

User feedback after the first batch led to three more changes (decisions captured via AskUserQuestion).

**Multi-person recurring bills (participants model).** Bills can now be split across many people, not just one.
- `types`: `BillSplitParticipant {contactId, amount}`; `Bill.splitParticipants?` (legacy `splitContactId`/`splitAmount` kept for back-compat read).
- `lib/calculations.ts`: `billParticipants(bill)` normalizer (multi → legacy single → []), `billOthersShare(bill)` (clamped sum), `myBillShare` rewritten = amount − billOthersShare (works for unsplit / legacy / multi).
- `lib/sheets.ts`: additive Bills column **K** (`split_participants` JSON via `parseBillParticipants`), all four `Bills!A2:J200` ranges widened to `:K200`; `upsertBill` writes the JSON, deleteRowById col J→K.
- `app/(app)/bills/page.tsx`: split form replaced single contact+share with a participant-row list (`billParticipantRows` state, `SplitParticipant`/`emptyParticipant`/`roundCents` locals). Add/remove rows, per-row inline new-contact (`handleAddParticipantContact`), `billSplitEqually`. Badge + pay-note handle 1 vs N (`splitBadgeGroup`/`splitPayNoteGroup`/`peopleCount`). Pay flow loops `billParticipants(payBill)` → one fronted transfer + Split per person (sequential). Removed dead `newContactName`/`handleAddContact`/`formShares`/`calcSplitShares` usage.

**Group loans expandable (point 2).** Loans created together now collapse into one expandable card.
- `types`: `Loan.groupId?`. `lib/sheets.ts`: additive Loans column **O** (`group_id`), range `:N`→`:O`, read `r[14]`/write `loan.groupId`.
- `app/(app)/transactions/page.tsx`: `handleAddLoan` assigns a shared `groupId` when >1 person. `openLoanGroups` memo groups open loans by groupId; `renderOpenLoanCard(loan, nested?)` extracted; `renderOpenLoanGroup` = collapsed header (people count + total remaining + names) expanding to per-person cards (settle/edit/delete each). `expandedLoanGroups` Set state. New `loans.peopleCount`.

**Per-person split mode (point 1) — toggle on all three split forms.** Inverse of the divide model: type each person's amount, total auto-sums.
- `lib/splits.ts`: new pure `sumPerPersonShares(amounts, myAmount, includeMe)` → `{shares,total,myShare,over:false}` (blanks=0, no auto-divide; your typed share adds to total when included). 3 unit tests in `splits.test.ts`.
- Each form got a `'divide' | 'perPerson'` segmented toggle; in perPerson the total field is read-only/computed (`bills.computedTotal`) and a "Your share" input (`bills.yourShareInput`) appears where a self-share applies:
  - **One-off split** (`splitExpenseForm.myShare` + `seSplitMode`): your-share input shows only when `includeMe`.
  - **Group loans** (`loanSplitMode`): no self share; total = sum of people.
  - **Recurring bills** (`billSplitMode` + `billMyShare`): your-share always applies; `billPerPerson` gated on `splitEnabled`.
- Save handlers + live previews branch between `computeSplitShares` (divide) and `sumPerPersonShares` (perPerson); "Split equally" + auto placeholders hidden in perPerson; over-total can't happen in perPerson. New i18n: `bills.splitModeDivide/splitModePerPerson/splitModePerPersonHint/computedTotal/yourShareInput` (en + vi).

**Verification:** `tsc` clean; both locales valid; eslint 0 errors (pre-existing purity/setState-in-effect warnings only); **312 tests pass** (was 309; +3 sumPerPersonShares). Committed in stages: multi-person bills, loan grouping, then per-person mode.
