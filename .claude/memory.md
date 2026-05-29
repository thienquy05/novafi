# NovaFi App — Build Memory

Tracks completed work at each step so any session can resume without losing context.

---

## Current Version — NovaFi Web App (Next.js + Google Sheets)

**Last Updated:** May 29, 2026

---

## 2026-05-29 — Ledger consolidation, balance reconciliation, cache hardening, pagination, undo, aggregation (branch claude/xenodochial-lalande-9ce7eb)

Hardened the money-math and scaled the read path. All new functions are pure and unit-tested. Decisions confirmed with user: tests in `lib/__tests__`; Vercel hosting → cache fix with **no new dependency** (bounded staleness); **CSV import skipped** (export kept); recurring transactions skipped; reconcile basis = new `openingBalance` column.

### `lib/calculations.ts` (new pure functions — single source of truth for balance math)
- `nextBalanceForAccount(account, tx, mode)` — resulting balance for ONE account after a tx is applied/reversed; unrelated accounts unchanged. Wraps the existing `apply*/reverse*Balance` fns (incl. the `applyTransferToBalance` debt clamp `Math.max(0, …)`).
- `applyTransactionToBalances(accounts, tx, mode)` — maps `nextBalanceForAccount` across all accounts, returning a NEW array; untouched accounts keep the same reference (identity check drives `persistChanged`). Replaces the 8 duplicated balance-mutation blocks formerly inline in the transactions route's POST/PUT/DELETE.
- `reconcileAccountBalance(account, transactions)` — replays the account's ledger chronologically (`date`, then `createdAt`) from `openingBalance`; returns the balance it SHOULD have. Returns stored balance untouched when `openingBalance == null` (not yet baselined → avoids double-count).
- `deriveOpeningBalance(account, transactions)` — reverse-replays from current balance to backfill `openingBalance` for legacy rows; round-trips with reconcile. Unclamped (accurate unless a historical debt-overpayment clamp fired — rare/ambiguous, documented).
- `detectBalanceDrift(accounts, transactions, tolerance=0.01)` → `BalanceDrift[]` ({accountId,name,stored,expected,diff}); skips accounts without `openingBalance`.
- `filterTransactions(txns, TxFilter)` — pure search/type/category/account/monthKey/date-range filter. `paginate(items, page, pageSize)` — generic, clamps out-of-range/non-positive pages. `aggregateMonthlyTotals(txns)` (ignores transfers) and `aggregateCategoryTotals(txns, monthKey?)` — pre-aggregation so dashboards/reports skip full rescans.

### `types/index.ts`
- `Account.openingBalance?: number` — balance before any transactions; reconciliation basis. Optional/backward-compatible; backfilled for legacy rows.

### `lib/sheets.ts`
- `getAccounts` range `A2:H200` → `A2:I200`; parses column I as `openingBalance` (blank/undefined → `undefined`, NOT 0).
- `upsertAccount` writes `account.openingBalance ?? ''` to column I; `deleteRowById` last-col `'H'` → `'I'` (arg is unused `_lastCol`, cosmetic).

### `app/api/transactions/route.ts` (rewritten)
- POST/PUT/DELETE now go through `applyTransactionToBalances` + `persistChanged` helper (writes only accounts whose balance changed, via reference identity). Ledger row is written FIRST, balances second, so a partial balance-write failure self-heals on reconcile (transactions are source of truth). Centralized `invalidateTxCaches`. Transactions GET TTL `60_000` → `CACHE_TTL.SHORT`.

### `app/api/accounts/route.ts`
- POST self-maintains `openingBalance`: when client omits it, new accounts get `openingBalance = balance`; edits preserve the stored value (reads accounts once to distinguish). Accounts GET TTL → `CACHE_TTL.SHORT`.

### `app/api/accounts/reconcile/route.ts` (NEW endpoint, POST)
- Backfills missing `openingBalance` via `deriveOpeningBalance`, then repairs drift (writes reconciled balance when `|diff| > 0.01`). Never touches history. Returns `{backfilledCount, repairedCount, repaired[]}`. Invalidates accounts/dashboard/badges caches when anything changed.

### `lib/cache.ts`
- Added `CACHE_TTL = { SHORT: 15_000, MEDIUM: 30_000, LONG: 60_000 }` (default for `setCache` now MEDIUM) + `clearCache()` (test isolation). Documented Vercel per-instance behavior: cache is a short-lived read throttle; balance-critical data uses SHORT to bound the cross-instance stale window after a mutation.

### `lib/csv.ts` (NEW)
- `transactionsToCsv(transactions, accountName?)` — pure RFC-4180 serializer (extracted from the inline `exportCSV` in the transactions page); adds a "To Account" column for transfers. Page's `exportCSV` now calls it for the Blob download.

### `lib/toast.tsx`
- Toasts now accept an optional `action: {label, onClick}` (3rd arg, backward-compatible). Action toasts stay up 6s (vs 3.5s) and render a `<Toast.Action>` button that fires then dismisses.

### `app/(app)/transactions/page.tsx`
- **Undo on delete:** `handleDelete` captures the removed tx and shows an "Undo" toast → `restoreTransaction` re-POSTs (re-creating the row also re-applies balance effects).
- **Pagination:** `PAGE_SIZE = 50`; list view renders `filtered.slice(0, visibleCount)` with a "Show more (N)" button. Paging resets when filters change via the render-time "adjust state" pattern (`prevFilterKey`) — no effect, avoids the `set-state-in-effect` lint warning.

### i18n
- `locales/en.json` + `vi.json`: added `common.undo`, `transactions.toastRestored`, `transactions.toastFailedRestore`, `transactions.showMore` (`{count}` param).

### Tests (all in `lib/__tests__`, run by CI)
- `ledger.test.ts` — nextBalanceForAccount (incl. debt clamp + reverse inverse), applyTransactionToBalances (reference preservation), reconcile/derive round-trip, drift detection, filter/paginate, monthly/category aggregation.
- `csv.test.ts` — header, name mapping, transfer destination, quote escaping, 2-decimal amounts.
- `cache.test.ts` — TTL hit/expiry (fake timers), prefix invalidation, clearCache, TTL tier ordering.
- Suite: **270 passing**, typecheck clean, lint 0 errors (26 pre-existing warnings, none new).

### Reconcile UI — Settings "Balance Check" (safe dry-run flow)
- `lib/calculations.ts`: added pure `planReconcile(accounts, transactions, tolerance=0.01)` → `{ toBackfill: ReconcileBackfill[], toRepair: BalanceDrift[] }`. Single source of truth so the dry-run PREVIEW and the APPLY can never diverge.
- `app/api/accounts/reconcile/route.ts`: rewritten to use `planReconcile`. Body `{ dryRun: true }` returns the plan WITHOUT writing (powers preview). Apply path writes only touched accounts (backfill openingBalance and/or repair balance to `expected`). Still never touches transaction history.
- `app/(app)/settings/page.tsx`: new Card at the very bottom ("Balance Check"). Flow: **Check balances** (dry-run) → shows `stored → expected` per drifted account (or "all balances match", or "establishing baseline for N accounts") → **Fix balances** applies, **Cancel** dismisses. Nothing is written until the user confirms after seeing before/after. State: `reconcilePlan/reconcileBusy/reconcileError/reconcileDone`. Icons: `Scale/CheckCircle2/AlertTriangle`. Uses `formatCurrency`.
- i18n: `settings.reconcile*` keys (Title, Desc, Check, Checking, AllGood, BaselineOnly `{count}`, Apply, Applying, Applied, Error) in en + vi.
- Tests: `planReconcile` block added to `ledger.test.ts` (backfill-only consistent legacy acct; repair on drifted baselined acct; no-op when matching). Suite now **273 passing**.
- Build verified: `npm run build` registers `ƒ /api/accounts/reconcile` and compiles clean.

### Scaling readiness — Sheets retry/backoff + sheet-ID caching (resilience + cheap wins)
Confirmed architecture insight: **each user has their OWN spreadsheet** in their OWN Drive (`auth.ts findOrCreateSpreadsheet`), accessed with their OWN OAuth token. Google Sheets quotas are ~60 read + 60 write per minute **per user**, so the app already scales by user count (no shared contention). Real risks were (1) no retry on transient errors, (2) call-heavy writes. Chosen scope: "resilience + cheap wins" (no values.update refactor).

- `lib/retry.ts` (NEW): `isRetryableError(err, allow5xx=false)`, `backoffDelay(attempt, base=300, max=8000)`, `withRetry(fn, opts)`, `withRetryProxy(client)`.
  - **Finance-safe policy:** retry 429 + pre-response network errors (ECONNRESET/ETIMEDOUT/etc.) ALWAYS (request never processed → safe); retry 5xx ONLY for idempotent reads (`get`/`batchGet`) — NOT for `append` (avoids duplicate transactions on a retried write that may have succeeded).
  - `withRetryProxy` recursively wraps a googleapis client (preserves `this`), so every call auto-retries with zero call-site edits. 5xx allowed only when method name ∈ {get, batchGet}.
  - Exponential backoff + 25% jitter; `sleep` injectable for tests.
- `lib/sheets.ts`: `getSheetsClient` now returns `withRetryProxy(google.sheets(...))`. Added module-level `sheetIdCache` + `getSheetId(sheets, spreadsheetId, title)` (one metadata fetch populates all tab ids) + `invalidateSheetIdCache`. Replaced 3 `spreadsheets.get` metadata lookups (`deleteRowById`, `ensureNetWorthHistorySheet`, net-worth pruning) with cached `getSheetId` → row-delete writes drop ~3 calls → ~2 after warmup. `ensureNetWorthHistorySheet` invalidates the cache after adding the tab.
- `lib/auth.ts`: wrapped sign-in `drive`/`sheets` clients with `withRetryProxy` (resilient first-login provisioning). Added `opening_balance` header to new Accounts sheet seeding (col I, self-documenting).
- Tests: `retry.test.ts` (13 cases) — retryable classification (429/5xx/4xx/network/shapes), exponential+cap backoff, withRetry success/retry/exhaust/non-retryable/custom-predicate. Suite now **286 passing**; typecheck clean; build OK.
- Deferred (not needed at 10-20 users): values.update in-place write refactor, shared cross-instance cache (Upstash), server-side month-scoped transaction reads.

### Sheets scale note (answer to "will it overwhelm after a year?")
Google caps at 10M cells (~1.1M tx rows) — not the bottleneck. The real cost is the full-`A2:I` fetch + full-ledger recompute per navigation. Chosen mitigation (no spreadsheet structure change): UI pagination + pure aggregation/filter helpers, history fully preserved. Rollup/archive tabs deferred as future options if row counts get very large.

---

## 2026-05-28 — Fix budget "doubling" + redefine rollover as deficit-only on usage (branch claude/budget-amount-doubling-6Q4Dy)

**Bug:** With rollover enabled, a $100 monthly budget displayed as $200 with a "+$100 rollover" badge. Root cause was the rollover math: `carryover = baseBudget − prevMonthSpend` and `effectiveBudget = baseBudget + carryover` (= `2*baseBudget − prevMonthSpend`). When last month's spend was 0 — including a brand-new budget or any category with no prior-month transactions (`prevSpentForCategory` returns 0 in all those cases) — carryover equalled the full base, so the cap doubled.

**New model (per user spec):** the budget cap stays **fixed**; only last month's **overspend** rolls forward, and it adds to this month's **usage** (not the cap). Surplus/underspending does NOT roll over. New budgets carry nothing (since `prevSpend ≤ base ⇒ deficit 0`), which removes the phantom doubling.

### `lib/calculations.ts`
- Removed `calcRolloverCarryover` and `calcEffectiveBudget`.
- Added `calcRolloverDeficit(baseBudget, prevMonthSpend) = Math.max(0, prevMonthSpend − baseBudget)` (≥ 0, the carried-over overage).
- Added `calcEffectiveSpent(spent, rolledOverDeficit) = spent + rolledOverDeficit` (cap unchanged; only the "used" side grows).

### `app/(app)/planning/page.tsx`
- Import updated to the two new fns.
- Replaced `effectiveMonthlyAmount`/`carryoverAmount` helpers with a single `rolledOverDeficit(budget)` (returns 0 when rollover disabled).
- Derived stats: `totalBudgeted` now sums fixed `monthlyAmount(b)`; `overBudgetCount` compares `calcEffectiveSpent(spent, rolledOver)` against the fixed `monthlyAmount(b)`.
- Per-budget map now computes `monthly` (fixed cap), `rolledOver`, actual `spent`, and `usage = calcEffectiveSpent(spent, rolledOver)`. `pct`/`over`/`remaining` use `usage`; `projected` = pace-of-actual-spend + `rolledOver`. `momDiff`/`categoryPct` still use actual `spent`.
- `BudgetItem` props: `carryover` → `rolledOver`, added `usage`. Header numerator now shows `usage` / `monthly`. Meta badge: when `rolledOver > 0`, renders rose `+{amount} {t('planning.rolledOver')}` note (no more green/red two-way "rollover" badge). 3mo-avg comparison still uses actual `spent`.

### Locales — added `planning.rolledOver`
- `en.json`: "from last month"; `vi.json`: "từ tháng trước".

### Tests — `lib/__tests__/calculations.test.ts`
- Replaced the `calcRolloverCarryover`/`calcEffectiveBudget` suites with `calcRolloverDeficit` (surplus→0, overspend→overage, new budget→0) and `calcEffectiveSpent` (usage = spend + rolled deficit) suites, covering the $100/$20 deficit and $70 surplus scenarios.

Verified: `tsc --noEmit` clean, eslint 0 errors (pre-existing line-88 setState-in-effect warning only), 213 tests pass.

---

## 2026-05-28 — UI enhancements: flexible banner, savings gauge, multi-category filter, shared swipe-to-delete, budget card alignment (branch claude/dashboard-transactions-ui-updates-cOJAZ)

Five enhancement requests; current functions/formulas preserved (only optimized/enhanced). tsc clean, eslint 0 errors (pre-existing warnings only), 234 tests pass, `next build` clean.

### 1 — Flexible dashboard health prompt (`app/(app)/dashboard/DashboardCharts.tsx` `HealthBanner` + `locales/en.json`,`vi.json`)
- The danger title was always the fixed "already over". Now a situation-aware `title` is computed from `overByPct = (monthSpending - monthIncome) / monthIncome`:
  - `< 0.10` → `charts.overSlight` ("A bit over this month")
  - `< 0.30` → `charts.overModerate` ("Past your income")
  - else → `charts.overHeavy` ("Time to regroup")
- `great` status also varies: `savingsRate >= 30` → `charts.thriving` ("Thriving"), else existing "Great shape".
- Renders `{title}` instead of `{cfg.title}`. Old `charts.overBudget` key kept (unused by banner now, still referenced elsewhere). Added 4 keys to both en/vi locale files under `charts`.

### 2 — Savings Rate visualization (`DashboardCharts.tsx` new `SavingsRateGauge` + `app/(app)/dashboard/page.tsx`)
- New exported client component `SavingsRateGauge`: a compact SVG radial ring (animated `strokeDashoffset` via framer-motion, reuses `useChartReady`) with the % in the center and the note beside it. Tier color: ≥20 emerald, ≥10 indigo, ≥1 amber, else rose.
- Dashboard `stats` array: added a `viz: number | null` field to every stat (only the Savings Rate stat sets `viz: savingsRate`). In the stats grid map, when `viz !== null` the card renders `<SavingsRateGauge value note={annotation} />` instead of the `FitText` number/delta/annotation block. `calcSavingsRate` formula untouched.

### 3 — Multi-select transaction category filter (`app/(app)/transactions/page.tsx`)
- `categoryFilter: string` → `categoryFilters: string[]`. Filter match: `categoryFilters.length === 0 || categoryFilters.includes(tx.category)`. Added `toggleCategory(c)` (add/remove). `activeFilterCount = (filter!=='all'?1:0) + categoryFilters.length`.
- Filter sheet: category buttons (kept the separate **Expenses** / **Income** labeled groups so duplicate names across income/expense are still surfaced) now toggle membership; "All" clears the array; added a header **Clear (n)** button to clear all category choices. Active-filter chip row renders one removable chip per selected category + a combined "Clear filters" chip when >1 filter active. Empty-state + bottom reset use `setCategoryFilters([])`.

### 4 — Shared swipe-to-delete (`components/ui/SwipeToDelete.tsx` NEW) applied to transactions, bills, planning budget cards
- New reusable `SwipeToDelete` wrapper: reveal width reduced 76px→64px (smaller padding); animated reveal (gradient `from-rose-600 via-rose-500 to-rose-400`, trash icon scales+fades in with drag via `useTransform`). Mouse drag works too. Child must paint its own opaque bg.
- **Transactions** `SwipeableRow`: refactored to use the shared component; removed the inline trash `Button` (delete is now swipe-only); kept edit. Dropped now-unused `Trash2`, `useMotionValue`, `animate` imports.
- **Bills** active + inactive cards: wrapped in `SwipeToDelete`, removed the trash `<button>` (kept edit / mark-paid / pause / resume). Action buttons got `e.stopPropagation()`. Dropped unused `Trash2` import.
- **Planning** `BudgetItem`: wrapped the `Card` in `SwipeToDelete` (inside `Reorder.Item`), removed the trash `Button`. Grip `onPointerDown` now calls `e.stopPropagation()` before `controls.start(e)` so vertical reorder-drag and horizontal swipe-drag don't both fire. `Trash2` import kept (still used by `GoalItem`).

### 5 — Budget card font alignment (`app/(app)/planning/page.tsx` `BudgetItem`)
- Header restructured: row 1 = `[grip] [category truncate flex-1] [spent / limit tabular-nums] [edit]`; the budget-per-period + rollover info moved to a dedicated full-width meta line (`pl-6`, flex-wrap) below so it no longer collides with the title/amount.
- The rollover formula (loved) is now a highlighted pill: `+$X rollover` on `bg-emerald-50 text-emerald-700` (positive) / `bg-rose-50 text-rose-600` (negative), `tabular-nums`. `calcRolloverCarryover` value unchanged. Progress bar + footer rows untouched.

---

## 2026-05-28 — Bills: remove month comparison; Health Score UI: color-coded factor bars

### Bills page (`app/(app)/bills/page.tsx`)
- Removed the per-bill "Paid this month: $X (±$Y vs expected)" line on active bill cards.
- Deleted the now-unused `thisMonthKey` and `thisMonthCategorySpend` memos, plus the `paidThisMonth`/`paidDiff` locals in the bill map.

### Financial Health Score — 6-factor verification
- Verified the composite is correct: Savings Rate (25) + Emergency Fund (20) + Budget Adherence (15) + Debt-to-Income (20) + Net Worth Trend (10) + Spending Volatility (10) = 100 max. 55 score-related Vitest tests pass.
- Computation lives in `app/(app)/dashboard/page.tsx` (lines ~254-260); pure scoring fns in `lib/calculations.ts`.

### Health Score UI fix (`app/(app)/dashboard/DashboardCharts.tsx`, `FinancialHealthScore`)
- Factor progress bars previously always indigo with no points shown — bar width didn't visually convey the assessment.
- Now: bar width = `round(score/max * 100)%`; bar color reflects ratio (≥0.8 emerald, ≥0.6 indigo, ≥0.4 amber, ≥0.2 orange, else rose).
- Added a `score/max` points label (tabular-nums) next to each factor's metric detail so the bar matches the assessment score.

---

## 2026-05-28 — UI sprint: 4 changes (branch claude/flamboyant-meninsky-5522b8, 4 commits)

Four independent UI requests, one commit each on the same branch. tsc clean, eslint clean (pre-existing warnings only), 234 tests pass.

### PR1 — Dashboard stat card orphan blank space
- **`app/(app)/dashboard/page.tsx`**: stats grid is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` with 5 cards, so on a 2-col mobile layout the last card (Savings Rate) sat alone with blank to its right. Added `idx` to the `stats.map` and, when count is odd, the final card gets `col-span-2 sm:col-span-1` so it stretches full-width on mobile only. Decision: user chose "stretch full-width" over adding a 6th KPI.

### PR2 — Move Spending Pace to Reports, remove Cash Flow from dashboard
- **`app/(app)/dashboard/page.tsx`**: removed the "Cash Flow" `MonthlyBarChart` card (already in Reports) and made the spending pie a full-width card (was a 2-col `grid` with the bar chart). Removed the Spending Pace section. Deleted now-unused `monthlyData` computation, `spendingPaceData`, and imports `MonthlyBarChart`, `SpendingPaceWidget`, `calcSpendingPace`. `monthlyTotals` kept (still feeds emergency fund / health arrays).
- **`app/(app)/reports/page.tsx`**: now also fetches `/api/budgets` (parallel with transactions). Added a `useMemo` computing current-month `categorySpend` + `calcSpendingPace(budgets, …)` — always current month regardless of `selectedYear`. Renders a "Spending Pace" card (imports `SpendingPaceWidget` from `../dashboard/DashboardCharts`, `calcSpendingPace` from `@/lib/calculations`, `Budget` type). Uses client `t('dashboard.spendingPace')` keys.

### PR3 — Planning budget card title/number overlap
- **`app/(app)/planning/page.tsx`** `BudgetItem`: long category names (e.g. "Transportation") overflowed and collided with the right-side spent/limit amount. Added `truncate` to the category `<p>` (parent already `flex-1 min-w-0`).

### PR4 — Transaction filter missing income categories
- **`app/(app)/transactions/page.tsx`** filter sheet: previously only `expenseCategories` were listed. Now renders two labeled groups — "Expenses" (rose label) and "Income" (emerald label) — each mapping its own list; the "All" reset button sits above both. `incomeCategories` already came from `useCategories()`. Keys prefixed `exp-`/`inc-` to avoid collisions when a name exists in both groups. No new functions added (so no new test file needed).

---

## 2026-05-12 — Fix: billing & transaction dates show 1 day early (PR #11: claude/fix-billing-date-offset)

Root cause: `new Date("YYYY-MM-DD")` treats date-only strings as UTC midnight. In UTC-negative timezones, `.toLocaleDateString()` and `.getDate()` return the previous calendar day. Server components (dashboard) were unaffected because Node.js server runs in UTC. Client components (bills page, transactions) showed 1 day early.

### Files
- **`lib/utils.ts`**
  - `formatDate(dateStr)`: changed from `new Date(dateStr).toLocaleDateString(...)` to `new Date(y, m-1, d).toLocaleDateString(...)` (local midnight, no UTC shift)
  - `today()`: changed from `new Date().toISOString().split('T')[0]` (UTC date) to `getFullYear/getMonth/getDate` (local calendar date)
- **`app/(app)/bills/page.tsx`**
  - Added `parseLocalDate(dateStr)` helper: `new Date(y, m-1, d)` — used everywhere a YYYY-MM-DD string was previously passed to `new Date()`
  - `nextDueAfter()`: uses `parseLocalDate()` + local date parts for output (no more `toISOString()` return)
  - `CashflowCalendar`: bill/paycheck day mapping uses `parseLocalDate()`
  - `BillsTimeline`: same
  - `overdueBills` filter: `parseLocalDate(nextDue) < todayMidnight` (local midnight comparison)
  - `upcomingCount` filter: same local-midnight comparison
  - `daysUntil` per bill: `parseLocalDate(nextDue) - todayMidnight`
  - `todayMidnight` memoized via `useMemo`

---

## 2026-05-12 — Feat: same-day transaction sort by creation time (PR #12: claude/fix-transaction-time-sort)

Added `createdAt?: string` (ISO timestamp) as a secondary sort key so transactions added on the same calendar date appear newest-first (stacking). Time is internal only — never displayed.

### Schema change
- Google Sheets Transactions column I: `createdAt` (ISO string, optional). Existing rows without this column fall back to id-based ordering (`id` is `${Date.now()}_${random}`, so it also sorts by creation time).

### Files
- **`types/index.ts`**: added `createdAt?: string` to `Transaction`
- **`lib/sheets.ts`**:
  - `getTransactions` range: `A2:H1000` → `A2:I1000`
  - `rowToTransaction`: reads `r[8]` as `createdAt`
  - `addTransaction`, `updateTransaction`: write `createdAt` to col I
  - `deleteTransaction`, `updateTransaction` (delete step): last col changed `H` → `I`
  - `batchGetBadgesData`: range `H1000` → `I1000`; mapper adds `createdAt: r[8]`
  - `batchGetDashboardData`: same range + mapper update
- **`app/(app)/transactions/page.tsx`**: sort uses `(date desc, createdAt desc)`; new transactions include `createdAt: new Date().toISOString()`; edits preserve original `createdAt`
- **`app/(app)/dashboard/QuickAddTransaction.tsx`**: includes `createdAt` on submit
- **`app/(app)/bills/page.tsx`**: payment transactions include `createdAt`
- **`app/(app)/dashboard/page.tsx`**: `recentTx` sort uses same two-key sort

---

**Last Updated:** May 11, 2026

---

## 2026-05-12 — Feat: same-day transaction ordering by creation time (PR: claude/fix-transaction-time-sort)

Added `createdAt?: string` (ISO timestamp) to `Transaction` stored in Google Sheets column I. New transactions include `createdAt: new Date().toISOString()`. Sort key is `(date desc, createdAt/id desc)` — existing rows without `createdAt` fall back to `id` (which is `${Date.now()}_${random}`, naturally sortable by time).

### Files
- `types/index.ts` — added `createdAt?: string` to `Transaction`
- `lib/sheets.ts` — extended ranges to `I1000`; `rowToTransaction` reads `r[8]`; `addTransaction`/`updateTransaction` write `tx.createdAt ?? ''`
- `app/(app)/transactions/page.tsx` — two-key sort; new transactions set `createdAt: new Date().toISOString()`; edits preserve original `createdAt`
- `app/(app)/dashboard/QuickAddTransaction.tsx` — new transactions set `createdAt: new Date().toISOString()`

---

## 2026-05-12 — Perf: server-side optimizations (PR: claude/perf-optimizations)

- `app/(app)/dashboard/page.tsx` — single-pass `monthlyTotals` map (eliminated 18+ array scans); `budgetData` O(1) lookups; `last3MonthsExpenses`/`income` from precomputed map
- `app/(app)/reports/page.tsx` — single `useMemo` with one `for` loop (replaced 36+ passes per render)
- `app/(app)/dashboard/DashboardCharts.tsx` — `categoryTotal` computed once before `.map()` in `SpendingPieChart` (was O(n²))
- `app/(app)/planning/page.tsx` — `useMemo` for `monthExpenses`/`prevMonthExpenses`; precomputed spend maps; O(1) `spentForCategory`; Set-based `unbudgetedWithSpending`
- `app/api/transactions/route.ts` — eliminated second `getAccounts()` Sheets call in PUT handler using in-memory `accountMap`

---

## 2026-05-12 — Perf: client-page redundant array passes and O(n) lookups (branch: claude/fix-transactions-billing-Tbt4h)

Eliminated repeated array scans and linear account lookups across five client pages.

### Changes

**`app/(app)/transactions/page.tsx`**
- Added `useMemo` import
- `filtered` list is now memoized (deps: `transactions`, `search`, `filter`, `categoryFilter`) — was recomputed on every render
- `totalIncome`/`totalExpense` now computed in single `useMemo` pass over `filtered` (was 2× `filter().reduce()`)
- `accountMap` `useMemo` (O(1) `Record<id, name>`) replaces `accounts.find()` inline function — called on every row and in CSV export
- `merchantRows` now `useMemo(() => buildMerchantRows(filtered), [filtered])` — skips rebuild when filtered hasn't changed

**`app/(app)/accounts/page.tsx`**
- `netWorth`, `totalAssets`, `totalDebt` computed in one `useMemo` pass (was 3 separate `reduce`/`filter` chains = 3× full array scan)
- `grouped` object built in one `useMemo` pass with a single `for` loop (was 5× `accounts.filter()` = 5× full array scan)

**`app/(app)/paychecks/page.tsx`**
- Added `useMemo` import
- `ytdPaychecks` memoized (deps: `paychecks`, `currentYear`)
- `ytdNet`, `ytdGross`, `ytdGratuity` computed in single `useMemo` pass (was 3× `reduce`)
- `accountMap` O(1) map replaces `accounts.find()` per rendered paycheck row
- `checkingAccounts` memoized (was `accounts.filter()` on every render)

**`app/(app)/savings/page.tsx`**
- Added `useMemo` import
- `savingsAccountIds` memoized
- `accountMap` O(1) map replaces 2× `accounts.find()` per transaction in the history list

**`app/(app)/bills/page.tsx` — `CashflowCalendar`**
- `totalBillsAmt` and `totalPaychecksAmt` now accumulated inside existing `forEach` loops (eliminated `Object.values().flat().filter().reduce()` chain)
- Deduplicated `Object.entries().sort()` comparator and `toLocaleString` month label (both called twice in legend)

---

## 2026-05-12 — Fix: billing dates and transaction dates off by 1 day (PR: claude/fix-billing-date-offset)

Root cause: `new Date("YYYY-MM-DD")` parses date-only strings as UTC midnight. In UTC-negative timezones, calling `.toLocaleDateString()` or `.getDate()` on the client returns the previous calendar day. Server components running in UTC are unaffected — which is why dashboard (server) showed correct dates but billing page (client) showed 1 day early.

### Fix
- `lib/utils.ts` — `formatDate()` now parses with `new Date(y, m-1, d)` (local midnight) instead of `new Date(dateStr)` (UTC midnight); `today()` now uses local calendar date (`getFullYear/getMonth/getDate`) instead of `toISOString().slice(0,10)` which is UTC
- `app/(app)/bills/page.tsx` — added `parseLocalDate()` helper replacing all `new Date("YYYY-MM-DD")` calls; fixed `nextDueAfter()` output to use local date string; fixed `CashflowCalendar` and `BillsTimeline` day mapping; fixed `overdueBills` filter and `daysUntil` per-bill calculation using `todayMidnight` (local midnight via `setHours(0,0,0,0)`)

---

## 2026-05-12 — Fix: first checking account balance saved as $0.00

User report: on a brand-new spreadsheet, the very first account added (checking, by default) showed $0.00 after save even when a balance was typed. Later savings/credit accounts saved correctly.

Root-cause analysis (no single smoking gun, so the fix hardens three layers that could each produce the symptom):

1. **Input was `<input type="number" step="0.01">`** — strict browser validation. On some mobile keyboards and non-US locales, typing "1000" or "1,000" can leave `e.target.value === ''`, which then runs through `parseFloat('') || 0 = 0`. Switched to `type="text" inputMode="decimal"` so the numeric keypad still appears on mobile but the value is never silently rejected. Input still strips non-numeric chars via `e.target.value.replace(/[^0-9.,\-]/g, '')`.

2. **`parseFloat` is locale-fragile** — `parseFloat('1,000')` returns `1`, `parseFloat('1.000,50')` returns `1`. Replaced the inline `parseFloat(form.balance) || 0` with a `parseBalance(input)` helper at the top of `app/(app)/accounts/page.tsx` that:
   - strips currency symbols / letters / spaces,
   - treats the last `.` or `,` as the decimal separator (rest are thousands),
   - preserves a leading minus,
   - returns `0` on `NaN`/`Infinity`.

3. **Sheets reads used `FORMATTED_VALUE` (the default)** — if Google Sheets auto-formats a column as currency, `r[4]` comes back as `"$100.00"`, and `Number("$100.00") === NaN`. Added `valueRenderOption: 'UNFORMATTED_VALUE'` to both `getAccounts()` and the two `batchGet*` helpers so numbers stay numeric. Also switched the parse from `Number(r[4] ?? 0)` to `Number(r[4]) || 0` so NaN falls back to 0 instead of propagating into the UI. Sibling string fields wrapped in `String(...)` for the same robustness.

### Files
- `app/(app)/accounts/page.tsx` — new `parseBalance()` helper above `EMPTY_FORM`; balance Input switched from `type="number"` to `type="text" inputMode="decimal"` with input sanitization; `handleSave` now calls `parseBalance(form.balance)` instead of inline `parseFloat`.
- `lib/sheets.ts` — `getAccounts()`, `batchGetBillsBudgetsTransactions()`, and `batchGetDashboardData()` now request `valueRenderOption: 'UNFORMATTED_VALUE'`; account row parsing uses `Number(r[4]) || 0` and wraps string fields with `String(...)`.

### Why not just one of these
We can't deterministically prove which layer was failing from the report alone, but each is an independently-known footgun in this stack. Hardening all three eliminates the symptom regardless of which one triggered it in the user's environment. None of the changes alter persisted data or affect other entities adversely.

---

## 2026-05-12 — Vietnamese language support (PR: claude/add-vietnamese-language-b0FQq)

Full i18n implementation with no new npm dependencies. Lightweight React Context + JSON dictionaries approach.

### Architecture
- **`/locales/en.json`** + **`/locales/vi.json`** — all UI strings as nested JSON (namespaces: nav, common, login, apiError, dashboard, charts, quickAdd, transactions, paychecks, bills, accounts, savings, planning, reports, settings, categories)
- **`/lib/i18n/index.ts`** — server-side `t(key, lang, params?)` function with `{placeholder}` interpolation; used in server components
- **`/lib/i18n/context.tsx`** — `LanguageProvider` + `useTranslation()` hook; client components use `const { t, lang, setLang } = useTranslation()`
- **Persistence**: cookie `nf_lang` (server-readable, 1-year max-age) + localStorage `nf_lang` (instant client paint) + `TaxSettings.language` in Google Sheets (cross-device sync)
- **SSR**: `app/layout.tsx` reads `nf_lang` cookie → sets `<html lang="...">` + passes `initialLang` to `SessionProvider`
- **Category display**: stored values stay English; display uses `t(\`categories.${category}\`)`
- **Number/date formatting**: kept as en-US throughout

### Files changed
- **`types/index.ts`** — Added `Language = 'en' | 'vi'` type; added `language: Language` to `TaxSettings`
- **`lib/utils.ts`** — Added `language: 'en' as const` to `DEFAULT_TAX_SETTINGS`
- **`lib/sheets.ts`** — `getSettings()` reads `language` key (fallback `'en'`); `saveSettings()` writes `['language', settings.language]`
- **`lib/i18n/index.ts`** — NEW: server-side translation helper
- **`lib/i18n/context.tsx`** — NEW: LanguageProvider + useTranslation hook with cookie/localStorage sync
- **`locales/en.json`** — NEW: all English strings
- **`locales/vi.json`** — NEW: all Vietnamese strings with proper diacritics; finance terms translated literally; untranslatable terms (401k, HSA, IRA, FICA, SS) kept in English
- **`app/layout.tsx`** — async, reads `nf_lang` cookie, sets `html lang`, passes `initialLang` to SessionProvider
- **`components/SessionProvider.tsx`** — wraps with `LanguageProvider` accepting `initialLang`
- **`app/page.tsx`** — login page translated (server component, reads cookie)
- **`app/(app)/layout.tsx`** — API error screen translated (server component)
- **`components/Sidebar.tsx`** — desktop + mobile nav + customize sheet translated
- **`app/(app)/dashboard/QuickAddTransaction.tsx`** — translated
- **`app/(app)/settings/page.tsx`** — added "Language & Region" card at top with EN/VI switcher; all settings strings translated; `setLang()` called on switch (immediate cookie+localStorage update); language synced from server settings on load
- **`app/(app)/dashboard/page.tsx`** — translated (server component)
- **`app/(app)/dashboard/DashboardCharts.tsx`** — translated (client component)
- **`app/(app)/transactions/page.tsx`** — translated
- **`app/(app)/paychecks/page.tsx`** — translated
- **`app/(app)/bills/page.tsx`** — translated
- **`app/(app)/accounts/page.tsx`** — translated
- **`app/(app)/savings/page.tsx`** — translated
- **`app/(app)/planning/page.tsx`** — translated
- **`app/(app)/reports/page.tsx`** — translated

### Language switching flow
1. User picks EN/VI in Settings → `setLang()` sets cookie + localStorage immediately
2. Settings save → `language` written to Google Sheets
3. Next visit → `app/layout.tsx` reads cookie → correct `html lang` + `initialLang` for LanguageProvider
4. On settings load → if `s.language !== lang`, reconcile (cross-device sync)

---

## 2026-05-11 — Financial Health Score rebuild (PR: claude/health-score-rebuild)

Replaced 4-factor (savings 25 / emergency 25 / budget 25 / debt-to-asset 25) composite with **6-factor weighted** model so a single distorted ratio (e.g. debt/asset 2672% when assets ≈ 0) can no longer sink the entire score.

New weights (total 100):

| Factor | Max | Replaces |
|---|---|---|
| Savings Rate | 25 | re-bucketed (8 tiers: 0/4/9/14/18/22/25) |
| Emergency Fund | 20 | re-bucketed (7 tiers: 0/3/6/9/13/16/20) |
| Budget Adherence | 15 | now adherence-ratio based, neutral 7 when no budgets |
| **Debt-to-Income** | 20 | replaces debt-to-asset (totalDebt ÷ avgMonthlyIncome×12) |
| **Net Worth Trend** | 10 | NEW — avg MoM % across up-to-4 latest snapshots |
| **Spending Stability** | 10 | NEW — coefficient of variation of last 3-mo expenses |

### Files
- `lib/calculations.ts`:
  - Re-bucketed `calcSavingsRateScore`, `calcEmergencyScore`, `calcBudgetScore`
  - **Added** `calcDebtToIncomeScore`, `calcDebtToIncomeRatio`
  - **Added** `calcNetWorthTrendScore`, `calcAvgMomPct` (null when <2 snapshots; skips zero-base points)
  - **Added** `calcSpendingVolatilityScore`, `calcCoefficientOfVariation` (population stddev / mean; null when mean ≤ 0)
  - Kept legacy `calcDebtScore` (debt-to-asset) marked legacy for back-compat
  - `calcHealthGrade` thresholds unchanged (85/70/55/40)
- `app/(app)/dashboard/page.tsx`:
  - Compute `avgMonthlyIncome` (3-mo mean), `dti`, `netWorthTrendPct` (slices last 4 of `netWorthPoints`), `spendingCv`
  - Sum 6 component scores into `healthScore`
  - Pass `dti`, `netWorthTrendPct`, `spendingCv`, `breakdown {...}` to `FinancialHealthScore`
- `app/(app)/dashboard/DashboardCharts.tsx`:
  - `HealthScoreData` — removed `debtRatio`; added `dti`, `netWorthTrendPct`, `spendingCv`, `breakdown`
  - `FinancialHealthScore` — 6 rows; new formatters: `fmtDti` (None/%/×), `fmtTrend` (+/-X%/mo), `fmtCv` (±X%)
  - Subtitle: "4-factor" → "6-factor composite score"
- `lib/__tests__/calculations.test.ts` — updated existing score tests for new tier values; added 60+ new tests for the 6 new helpers
- All 182 tests pass; tsc clean.

---

## 2026-05-11 — Budget overshoot help tooltip (PR: claude/budget-overshoot-help)

Adds a reusable inline help tooltip (`HelpHint`) explaining what each budget badge means. The overshoot math itself was already correct — users were just confused by the terminology.

### Files
- **NEW** `components/ui/HelpHint.tsx` — click-toggle popover with outside-click and Escape dismissal; framer-motion fade; right/left align; accessible (`aria-label`, `aria-expanded`, role="tooltip")
- `app/(app)/dashboard/page.tsx` — `<HelpHint>` next to "Budget Progress" CardTitle (align="left")
- `app/(app)/planning/page.tsx` — same `<HelpHint>` next to "Budgets" section header

### Tooltip contents
Explains the four badge variants (`~$X overshoot`, `On pace`, `$X over`, `+$X vs last mo`) plus the projection formula: `projection = (spent ÷ days elapsed) × days in month`.

---

## 2026-05-11 — Paid-off credit card celebration (PR: claude/credit-card-paid-off)

Replaces the unflattering `-$0.00` red display on credit/loan cards with a celebratory paid-off badge.

### Behavior
- `balance < 0` — still shows green `+$X (credit)` (unchanged)
- `balance === 0` — **NEW** `<PaidOffBadge>`: emerald `$0.00` in `font-black` with checkmark, brief one-shot confetti burst (14 particles, deterministic trajectories), session-storage gated per-account so it doesn't replay on every list refresh
- `balance > 0` — still shows red `-$X owed` (unchanged)

### Files
- `app/(app)/accounts/page.tsx`
  - new branch in display logic (line ~226): `balance === 0` → `<PaidOffBadge accountId={...} />`
  - imports: `useRef`, `useMemo`, `motion`, `AnimatePresence`
  - **new local component `PaidOffBadge`** at bottom of file:
    - spring-scale entry on the `$0.00` text
    - confetti particles use deterministic `(i*7)%14` jitter + `(i%4)*0.08` duration variance (pure during render — passes `react-hooks/purity` lint)
    - `sessionStorage` key `paidoff-confetti:${accountId}` ensures one burst per account per browser session

---

## 2026-05-11 — Negative sign wrapping fix (PR: claude/negative-sign-flex)

The `-` of a `-$X.XX` amount was wrapping onto its own line when summary cards / table cells became too narrow (the user's screenshots show this on the transactions Net card and on the reports monthly Saved column). Fix uses **`FitText`** + `min-w-0` + `whitespace-nowrap` so the amount stays on one line and auto-shrinks within the container.

### Strategy
- **Cards (transactions, reports, bills summary)** — swap fixed `text-xl`/`text-2xl` `<p>` for `<FitText>` which sets `whitespace-nowrap` + `overflow-hidden` and binary-shrinks font down to `minSize` to fit. Adds `min-w-0` on parent so flex/grid items can shrink below content width.
- **Tables (reports monthly breakdown)** — add `whitespace-nowrap` to each numeric `<td>`; the outer `overflow-x-auto` already provides horizontal scroll fallback.

### Files
- `app/(app)/transactions/page.tsx` — Income/Spending/Net summary cards now use `FitText`; imported `FitText`
- `app/(app)/reports/page.tsx` — 4-card year summary uses `FitText`; monthly breakdown table cells get `whitespace-nowrap`; imported `FitText`
- `app/(app)/bills/page.tsx` — 3-card Monthly/Active/Overdue summary uses `FitText`; imported `FitText`

---

## 2026-05-11 — Inverted red fill for negative savings goal bars (PR: claude/savings-negative-bar)

Savings goals linked to an overdrawn account previously showed a fully-empty (or zero-width) bar — visually identical to a 0% goal — even though the underlying balance was deeply negative. Fix: when `current < 0`, render an **inverted right-anchored rose-500 bar** with width proportional to the deficit (`min(100, |current/target|*100)%`).

### Visual logic
- `current >= target` (achieved) — full emerald bar, left-to-right (unchanged)
- `0 ≤ current < target` — partial indigo bar, left-to-right (unchanged)
- `current < 0` — **NEW** rose bar anchored to RIGHT, width `min(100, |pct|)`, deficit label
- Percentage badge becomes `bg-rose-50 text-rose-700` when negative
- Current-amount text becomes `text-rose-600` when negative

### Files
- `app/(app)/planning/page.tsx`
  - `goal.map(...)` block: replaced `Math.min(100, ...)` with `Math.max(-100, Math.min(100, ...))` so `pct` keeps its sign
  - `GoalItem` bar: conditional render, absolute right-anchored rose div for the negative branch
- `app/(app)/dashboard/DashboardCharts.tsx` — same treatment in `GoalsSummary`; uses framer-motion `motion.div` for animated entry
- `app/(app)/savings/page.tsx` — same treatment in inline goals grid

---

## 2026-05-11 — Paycheck tips: total-first input flow (PR: claude/paycheck-tips-flow)

Flips the paycheck input semantics so users enter the **total amount they received** (which includes tips), then list the tips separately. Tips are subtracted to derive the taxable wage base — the underlying tax math is unchanged.

### Old flow (deprecated)
1. User enters `grossAmount` (taxable only)
2. User enters `gratuityAmount` (non-taxable, added on top)
3. Display: Net = `(gross - taxes) + tips`

### New flow
1. User enters `totalAmount` (full check, including tips)
2. User enters `gratuityAmount` (optional)
3. `taxableGross = max(0, total - tips)` — fed into `calcPaycheckTax`
4. Display: Net = `(taxableGross - taxes) + tips` = `total - taxes`

### Data model
- **No schema changes.** `PaycheckEntry.grossAmount` still stores the taxable portion. Existing YTD wage-base lookups (`paychecks[].grossAmount`) keep working identically.
- The income transaction amount remains `preview.netPaycheck + gratuity` (mathematically equivalent to `total - taxes`).

### Files
- `app/(app)/paychecks/page.tsx`
  - Form field renamed: `grossAmount` → `totalAmount`
  - `useEffect` preview now computes `taxableGross = max(0, total - tips)` and passes to `calcPaycheckTax`
  - Input labels: "Gross Amount (taxable)" → "Total Amount (incl. tips)"; "Gratuity" → "Tips / Gratuity"
  - Added helper text under the tips field
  - Preview header now shows: Total → less Tips → Taxable Wages → deductions → Net of wages → add Tips → Total Take-Home
  - List row column "Gross" → "Wages", "Gratuity" → "Tips"
  - YTD summary card labels: "YTD Gross" → "YTD Taxable Wages", "YTD Gratuity" → "YTD Tips"; "YTD Net (take-home)" now includes tips so the user sees actual cash received

---

## 2026-05-11 — Menu Order: mobile-only customization (PR: claude/menu-order-mobile)

The desktop version doesn't need menu reordering. The Settings page "Menu Order" card was specifically wired to the desktop sidebar (via `novafi_nav_order` localStorage key); mobile already had its own separate customize sheet inside `MobileNav` (via `novafi_mobile_nav_order`). This PR removes the now-unused desktop machinery so customization is **mobile-only**, accessed via the existing `Customize` sheet at the bottom of the mobile nav.

### Changes
- **`components/Sidebar.tsx` (desktop `Sidebar`)**
  - Reads from fixed `NAV` array instead of `getSortedNav()`
  - Removed `getSortedNav()`, `NAV_ORDER_KEY`, `useState`/`useEffect` for sortedNav
- **`app/(app)/settings/page.tsx`**
  - Removed the entire "Menu Order" Card from the rendered settings page
  - Removed `NAV_ITEMS`, `NAV_ORDER_KEY`, `getStoredNavOrder()`, `NavReorderItem`, `NavReorderRow` helpers
  - Removed `navOrder` state and its persistence on save
  - Dropped now-unused imports: `GripVertical`, `LayoutDashboard`, `Landmark`, `DollarSign`, `ArrowLeftRight`, `PiggyBank`, `Calendar`, `BarChart3`, `FileText`, `Settings as SettingsIcon`, `Reorder`, `useDragControls`

### What's preserved
- **`MobileNav`** in `components/Sidebar.tsx` keeps its `MOBILE_NAV_ORDER_KEY = 'novafi_mobile_nav_order'`, customize sheet, up/down move arrows, and reset button — fully intact.

---

## (Legacy) Last Updated: May 6, 2026

### Stack
| Package | Purpose |
|---------|---------|
| `next@16` | Web framework with App Router |
| `next-auth@5 beta` | Google OAuth (requests Sheets + Drive scopes) |
| `googleapis` | Google Sheets API v4 + Drive API v3 |
| `tailwindcss@4` | Styling |
| `lucide-react` | Icons |
| `recharts` | Charts (pie, bar) |
| `@radix-ui/*` | UI primitives (tabs, dialog, select, etc.) |

### How to run
```bash
cp .env.local.example .env.local   # fill in Google OAuth credentials
npm run dev                         # → http://localhost:3000
```

---

## Routes & Pages

| Route | Type | Description |
|-------|------|-------------|
| `/` | page | Login/landing with Google sign-in |
| `/dashboard` | page | Net worth, charts, spending alerts, budget+goal progress, upcoming bills |
| `/accounts` | page | Add/edit/delete checking, savings, credit cards, investments |
| `/paychecks` | page | Log paychecks with auto tax calc → deposits to checking account |
| `/transactions` | page | All transactions with search, type filter, category filter, account dropdown |
| `/savings` | page | Savings accounts with deposit/withdraw + full history + goal progress |
| `/bills` | page | Recurring bills: add, mark paid (auto-advance date), pause |
| `/planning` | page | Combined Budgets + Goals tabs with shared summary |
| `/budgets` | redirect | Redirects to /planning |
| `/settings` | page | Tax rates (flat %), 401k%, HSA, pay periods |
| `/api/settings` | GET/PUT | Read/write settings sheet |
| `/api/paychecks` | GET/POST/DELETE | Paycheck CRUD |
| `/api/transactions` | GET/POST/DELETE | Transaction CRUD |
| `/api/accounts` | GET/POST/DELETE | Account CRUD |
| `/api/bills` | GET/POST/DELETE | Bills CRUD |
| `/api/budgets` | GET/POST/DELETE | Budgets CRUD |
| `/api/goals` | GET/POST/DELETE | Goals CRUD |

---

## Google Sheets Structure (8 tabs)

`Settings`, `Accounts`, `Transactions`, `Paychecks`, `Budgets`, `Bills`, `Goals`, `NetWorthHistory`

---

## Data Models

### TaxSettings
- **Simplified flat-rate** (no bracket tables)
- `federalRate`, `stateRate`, `cityRate` (all flat %)
- `k401Pct`, `hsaAnnual`, `iraAnnual`
- `ficaSsRate`, `ficaSsWageBase`, `ficaMedicareRate`
- `filingStatus`, `payPeriodsPerYear`

### Transaction
- `id`, `date`, `description`, `amount`, `type` (income|expense|transfer), `category`, `account`, `toAccount`
- **No `notes` field** (removed for simplicity — use description)

### Account types: `checking | savings | credit | investment | loan`

### Expense Categories (simplified)
`Food`, `Grocery`, `Entertainment`, `Bills`, `Shopping`, `Transportation`, `Health`, `Transfer`, `Other`

### Income Categories
`Paycheck`, `Freelance`, `Investment`, `Transfer`, `Other Income`

---

## Key Features & Rules

### Paycheck Flow
1. Log paycheck → auto tax breakdown (federal, state, city, FICA, 401k, HSA)
2. Net pay auto-creates income transaction in selected checking account
3. Checking account balance auto-updates

### Tax Calculation (simplified)
- Flat % rates: federal, state, city — no bracket tables
- FICA: SS (6.2%, wage base capped) + Medicare (1.45%)
- Settings page has 3 rate inputs + FICA section

### Accounts
- Multiple accounts: checking (primary), savings, credit cards, investments
- Net worth = assets − credit/loan balances
- Credit card "balance" = amount owed (shown as negative)

### Savings
- Dedicated savings page shows all savings accounts
- Deposit/Withdraw buttons → creates transaction + updates account balance
- Full transaction history filtered to savings accounts
- Goal progress bars (from Goals sheet)

### Bills
- Recurring bills with frequency: weekly/biweekly/monthly/quarterly/yearly
- Mark as paid → auto-advances nextDue date
- Pause/resume toggle
- Dashboard shows bills due in next 14 days

### Budgets
- Per-category monthly budgets
- Progress bars with color coding (green/yellow/red)
- Dashboard shows all budgets inline
- Unbudgeted categories with spending are surfaced

### Dashboard Charts
- Spending by category (donut pie chart, recharts)
- Income vs Spending past 6 months (bar chart, recharts)
- Budget progress bars
- Savings rate % shown in welcome line

---

## Removed Features
- **Tax calculator page** (`/tax`) — removed; paychecks auto-calculate
- **Ohio state tax brackets** — replaced with single flat state rate %
- **Notes field on transactions** — removed; description is sufficient
- **Free-text account input** — replaced with account dropdown (from added accounts)

---

## Finance Advisor Additions (May 6, 2026 update)
- Savings rate percentage shown on dashboard
- Budget vs actual tracking with visual bars
- Transfer transaction type (between accounts)
- Credit card balance tracking (owed amount)
- Bill mark-as-paid auto-advances due date
- Unbudgeted category spending alerts in budget page

---

## Planning Page (Goals + Budgets combined)
- Two columns side by side (stacked on mobile): Budgets on the left, Goals on the right
- Each section has its own inline Add button in the section header
- No tab navigation — both sections are always visible simultaneously
- Goals have optional `linkedAccountId` — if linked, balance from account is used as progress
- Goals show monthly savings needed to hit target by deadline
- Budgets show unbudgeted categories that have spending (with quick "Set limit" link)

## Transactions — Smart Transfer
- Account field is always a dropdown bound to your actual accounts (shows balance)
- Transfer type: auto-updates both fromAccount and toAccount balances on save
- Credit card payoff: paying to a credit/loan account reduces what you owe
- Transfer preview shows balance-after in modal

## Dashboard Alerts
- Red banner: any category over 100% budget
- Yellow banner: any category 80–99% budget
- Goals summary widget (top 3 goals with progress bars) — always visible; shows empty state with link to /planning when no goals exist

## Dashboard Quick Add
- "Quick Add" button (⚡ icon) in the dashboard header
- Client component: `app/(app)/dashboard/QuickAddTransaction.tsx`
- Modal with type toggle (Expense/Income), amount + date, description, category, account
- POSTs to `/api/transactions` then reloads the page

## UI Overhaul (May 6, 2026 update)
- **Soft Light Theme:** Replaced the dark navy background with a soft, premium light gray (`bg-slate-50`) across all pages.
- **High-Contrast Typography:** Updated text colors to `text-slate-900` for primary text and `text-slate-500` for secondary text to ensure readability and an eye-safe experience.
- **Premium Components:** All cards, inputs, and modals now use clean white backgrounds (`bg-white`), soft borders (`border-slate-100`), and subtle shadows (`shadow-sm`) for a high-end "$10000 web page" feel.
- **"Zero State" Data Handling:** All pages correctly display `$0.00` or `0` when no data is present, utilizing clean empty states with helpful prompts to add data.
- **Mobile-First Design:** Implemented a Floating Action Button (FAB) for `QuickAddTransaction` on mobile, bottom-sheet style modals, and increased touch target sizes for inputs and buttons.
- **Animations:** Integrated `framer-motion` for smooth active state indicators in the sidebar, modal transitions, and chart entry animations.

---

---

## Net Worth Trend Chart (May 6, 2026)

### New files / changes
- `types/index.ts` — added `NetWorthSnapshot` interface (`id`, `date` YYYY-MM-DD, `month` YYYY-MM, `netWorth`)
- `lib/sheets.ts` — added `getNetWorthHistory`, `appendNetWorthSnapshot`, `ensureNetWorthHistorySheet` (lazy-creates the sheet if missing)
- `app/api/net-worth-history/route.ts` — GET (list history) + POST (append snapshot)
- `app/(app)/dashboard/DashboardCharts.tsx` — added `NetWorthTrendChart` (recharts `AreaChart`); exports `NetWorthPoint` type; imports `AreaChart`, `Area`, `ReferenceLine`
- `app/(app)/dashboard/page.tsx` — fetches history in parallel with other data, fire-and-forgets a snapshot write once per calendar month (deduped by `YYYY-MM` key), passes `netWorthPoints` to `NetWorthTrendChart`
- `lib/auth.ts` — new spreadsheet creation now includes `NetWorthHistory` tab with header row

### Behavior
- First dashboard visit each month → one new row appended to `NetWorthHistory` sheet (no duplicate writes)
- Existing users: `ensureNetWorthHistorySheet` auto-creates the tab on first access (lazy init)
- Chart shows `AreaChart` line with green fill (trend up) or red fill (trend down)
- Delta badge shows change since oldest snapshot
- Shows "not enough data" empty state until 2+ months of data exist

---

## Credit Card Negative Balance / Credit (May 6, 2026)
- Credit/loan accounts can now have negative balances (bank owes you — refund, reward redemption after payoff)
- Input `min="0"` removed for credit/loan; label updated to "Balance Owed ($) — enter negative if bank owes you"
- Display: negative credit balance shows green `+$X` with "credit (bank owes you)" label instead of red "-$X owed"
- Total Debt on accounts page only counts positive balances (actual debt); negative credit balances are excluded
- Net worth math already correct: `-(-50) = +50` so credit balance naturally boosts net worth

---

## Savings Negative Balance (May 6, 2026)
- Savings accounts can go negative (no withdrawal guard by design)
- Net worth calculation already correctly handles negative savings: `sum + balance` means -$100 savings reduces net worth by $100
- Dashboard "Total Savings" stat card: color switches to rose/red when negative
- Savings page "Total Saved" card: color switches to rose/red when negative
- Savings page per-account balance: switches to `text-rose-600` when negative

---

## Documentation (May 6, 2026)
- `README.md` — rewritten with full feature list, tech stack table, quick start, Vercel deploy section, and Google Sheets structure overview
- `SETUP.md` — rewritten as a complete step-by-step guide covering:
  - Google Cloud Console setup (APIs, OAuth consent screen, credentials)
  - Local dev environment variables
  - Vercel deployment (GitHub push → Vercel import → 4 env vars → redirect URI update)
  - Troubleshooting section
  - Summary table of what needs manual setup vs. what is auto-created
- Key note: Google Sheet and all 8 tabs are auto-created on first login — no manual column creation needed
- 4 env vars required for Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_URL`

---

## Icon Fix (May 6, 2026)
- Root cause: `<img src="/icon.svg">` doesn't render SVG filters/gradients reliably; metadata `icons` override doesn't work with App Router file convention
- Fix 1: Copied `public/icon.svg` → `app/icon.svg` — Next.js App Router automatically serves any `icon.svg` in app/ as the browser tab favicon (no metadata needed)
- Fix 2: Created `components/LogoMark.tsx` — inline SVG component with camelCase React props (`stopColor`, `strokeOpacity`, etc.) so gradients + glow filters render correctly in all browsers
- Fix 3: Replaced both `<img>` usages in `Sidebar.tsx` with `<LogoMark>` component
- Removed manual `metadata.icons` from `app/layout.tsx` (redundant with file convention)

## NovaFi Icon Design (May 6, 2026)
- Designed a custom premium SVG icon: `/public/icon.svg`
- Mark: upward chevron (two thick white arms with rounded caps) + 4-pointed star sparkle (✦) at the peak with a layered radial glow
- Background: deep indigo-to-violet gradient (#3730A3 → #4F46E5 → #6D28D9) with a celestial radial highlight behind the star
- Wired into `app/layout.tsx` metadata (`icons.icon`, `icons.apple`, `icons.shortcut`) for favicon + PWA
- `Sidebar.tsx`: replaced `<Sparkles>` icon with `<img src="/icon.svg">` in both desktop sidebar and mobile header; removed unused `Sparkles` import

## QuickAdd + Modal — Mobile Fix (May 6, 2026)
- Root cause: bottom sheet was flush with screen bottom, hidden behind the fixed mobile nav bar; Cancel/Save were unreachable
- `Modal.tsx`:
  - z-index raised to `z-[200]` (above nav's `z-50`)
  - Container uses `pb-[4.5rem] sm:pb-0` — lifts the sheet above the ~4rem mobile nav bar
  - Body scroll lock (`document.body.style.overflow`) prevents background scroll while open
  - `max-h-[80dvh]` on mobile keeps the panel compact
  - Header is a fixed `shrink-0` strip; body is `overflow-y-auto flex-1`
- `QuickAddTransaction.tsx`:
  - Action buttons moved into a **sticky footer** (`sticky bottom-0 bg-white border-t`) pinned to the visible bottom of the sheet regardless of content length
  - Form always uses `grid-cols-2` for Date+Description and Category+Account — keeps the form compact and avoids needing to scroll
  - Amount stays as the prominent `$` hero field with `inputMode="decimal"`

## QuickAdd Transaction — Mobile Modal (May 6, 2026)
- `Modal.tsx`: split into sticky header + scrollable body (`overflow-y-auto`, `max-h-[92dvh]`) so form is never clipped behind the soft keyboard
- `QuickAddTransaction.tsx`:
  - Amount input is now a full-width hero field with `$` prefix, `text-2xl` weight, and `inputMode="decimal"` for the numeric keypad
  - Removed `autoFocus` — prevents keyboard firing before the bottom sheet finishes sliding up
  - All two-column grids changed to `grid-cols-1 sm:grid-cols-2` — single column on phones, two columns on tablet/desktop
  - Date + Description now share a row on sm+; Category + Account share a row on sm+

## Bills Edit (May 6, 2026)
- Added edit (pencil) button to each bill row (both active and paused sections)
- Clicking pencil opens the Add/Edit modal pre-filled with that bill's data
- `editingId` state distinguishes add vs edit mode
- Modal title changes to "Edit Bill"; save button reads "Save Changes"
- `handleSave` reuses existing POST `/api/bills` (upsert by ID) — no API changes needed
- `isActive` is preserved when editing; new bills default to `isActive: true`

## Account Balance Auto-Sync (May 6, 2026)
- `app/api/transactions/route.ts` POST now reads accounts after saving the transaction and updates the relevant account balance(s):
  - **Expense** → subtracts amount from `account`
  - **Income** → adds amount to `account`
  - **Transfer** → subtracts from `account`, adds to `toAccount`; credit/loan payoff reduces balance owed (`Math.max(0, balance - amount)`)
- Removed duplicate client-side balance updates from `app/(app)/transactions/page.tsx` (was only doing transfers) and `app/(app)/savings/page.tsx` and `app/(app)/paychecks/page.tsx` — all now rely on the single server-side handler

---

## RocketMoney UX Overhaul (May 6, 2026)

### New Files
- `components/CategoryIcon.tsx` — `CATEGORY_ICONS` map (category → Lucide icon + color tokens) + `CategoryIconBadge` client component; used on transactions page and dashboard recent feed
- `app/api/badges/route.ts` — GET returns `{ overdueBills: number, overBudget: number }` for sidebar badge dots; fetches bills + budgets + transactions server-side, non-blocking

### Modified Files

**`lib/sheets.ts`**
- Added `updateTransaction(accessToken, spreadsheetId, tx)` — deletes old row by ID, re-appends with new data (used by PUT endpoint)

**`app/api/transactions/route.ts`**
- Added `PUT` handler: receives `{ original: Transaction, updated: Transaction }`, reverses original balance effects, applies new balance effects, then calls `updateTransaction`. Preserves the core formula: every balance change is calculated server-side

**`components/Sidebar.tsx`**
- Added `useBadges()` hook — fetches `/api/badges` once on mount, returns `{ overdueBills, overBudget }`
- `NavBadge` component renders a small red/amber count pill next to Bills and Planning nav items
- Both desktop sidebar and mobile bottom nav show badges with matching color coding (red = overdue, amber = over-budget)

**`app/(app)/dashboard/DashboardCharts.tsx`**
- Added `HealthBanner` component — full-width status card showing: on-track/warning/danger status, savings rate pill, over-budget count, net cash flow + safe-to-spend subtitle, days-left progress bar
- Updated `BudgetBars` — added `daysLeft` and `daysElapsed` props; shows "X left · Yd" per category and "~$X overshoot" projection when daily spend pace will exceed budget
- Updated `GoalsSummary` — shows monthly amount needed to hit deadline target

**`app/(app)/dashboard/page.tsx`**
- Added previous month calculations (`prevMonthIncome`, `prevMonthSpending`, `prevNetWorth`)
- Added `daysInMonth`, `daysElapsed`, `daysLeft`, `totalAssets`, `totalDebt`, `billsThisMonth`, `safeToSpend`, `overBudgetCount`
- MoM delta percentages computed (`spendingDelta`, `incomeDelta`, `netWorthDelta`)
- Stats grid now shows delta badge per card (up/down arrow + %) with direction-aware coloring
- Replaced "Total Savings" stat card with "Safe to Spend" (income − spent − bills due this month)
- Replaced "Last Paycheck" stat card with "Month Income"
- Added Assets / Liabilities / Savings 3-col strip below stats
- `HealthBanner` renders above stats; `SpendingAlerts` removed from dashboard (integrated into HealthBanner)
- Recent transactions now use `CategoryIconBadge` instead of generic arrow icons
- Passes `daysLeft` / `daysElapsed` to `BudgetBars`

**`app/(app)/bills/page.tsx`**
- Added `BillsTimeline` component — horizontal scrollable strip of all days in the current month; days with bills show rose dots + bill name legend below; auto-scrolls to today on mount
- Added overdue banner at top when any active bill is past due
- Summary card color-codes based on overdue count vs upcoming count

**`app/(app)/planning/page.tsx`**
- Added `daysInMonth`, `daysElapsed`, `daysLeft` calculations
- Per budget: shows "X left · Yd" below progress bar; projected end-of-month overshoot warning; "On pace" green indicator when within budget
- Per goal: shows on-track/behind/done status badge (compared to progress % vs time elapsed); monthly amount needed displayed

**`app/(app)/transactions/page.tsx`**
- Uses `CategoryIconBadge` in place of generic income/expense arrows — each transaction shows a category-specific colored icon
- Added `editTarget` state and `openEdit(tx)` function
- Edit button (pencil icon) appears on hover per transaction row
- Modal now has dual add/edit mode: title + save button text change; on save calls PUT (edit) or POST (add)
- Edit correctly reverses and re-applies balance effects via the PUT endpoint

**`app/globals.css`**
- Added `pt-safe` utility for top safe area
- Added `overscroll-behavior: none` on `html` to prevent iOS bounce layout jank
- Added `tap-highlight-none` and `scroll-smooth-ios` utilities

---

## Google Sheets Quota Fix — May 6, 2026

**Problem:** Google Sheets API returning 429 "Quota exceeded" on `getAccounts` because the app was firing 7+ individual read requests per page load plus 3 more from the `/api/badges` sidebar hook on every navigation, hitting the 300 reads/minute/user quota.

**Solution — batchGet (primary fix):**
- Added `batchGetDashboardData()` to `lib/sheets.ts`: reads Paychecks, Transactions, Accounts, Bills, Budgets, Goals in **1** batchGet API call instead of 6 separate ones. NetWorthHistory fetched separately (may not exist, needs creation fallback).
- Added `batchGetBadgesData()` to `lib/sheets.ts`: reads Bills, Budgets, Transactions in **1** batchGet instead of 3 separate calls.
- `app/(app)/dashboard/page.tsx`: replaced 7-call `Promise.all` with `batchGetDashboardData` + `getNetWorthHistory` — **7 reads → 2 reads** per dashboard load.
- `app/api/badges/route.ts`: replaced 3-call `Promise.all` with `batchGetBadgesData` — **3 reads → 1 read** per badge fetch.

**Solution — session-storage cache (secondary fix):**
- `components/Sidebar.tsx` `useBadges` hook: added 2-minute TTL cache in `sessionStorage`. Badge data is now served from cache for all page navigations within the same session; only fetches Sheets once every 2 minutes — eliminates the repeated Sheets hit on every route change.

**Net result:** Dashboard page: 7 → 2 Sheets reads. Badge fetches: 3 → 1 and only once per 2 min per session. Overall quota usage reduced ~80% under normal navigation patterns.

---

## UX Polish + Features — May 6, 2026 (second pass)

### New files
- `lib/toast.tsx` — `ToastProvider` (context) + `useToast()` hook; uses `@radix-ui/react-toast`; shows success/error/info toasts above mobile nav (`bottom-[5.5rem]`); TTL 3.5 s; close button
- `lib/cache.ts` — In-process TTL Map cache for API routes; `getCache / setCache / invalidateCache(prefix)` — prevents repeated Sheets reads on client navigations
- `components/ui/Skeleton.tsx` — `Skeleton`, `AccountsSkeleton`, `TransactionsSkeleton`, `BillsSkeleton`, `PlanningSkeleton` — animated gray placeholder layouts matching each page's real layout
- `hooks/usePullToRefresh.ts` — Touch-based pull-to-refresh; 72 px threshold; returns `{ pullY, refreshing }`; fires async `onRefresh` callback; noop on desktop
- `public/manifest.json` — PWA manifest (standalone display, portrait, indigo theme, svg icon)

### Modified files

**`components/SessionProvider.tsx`** — wraps children with `<ToastProvider>` so `useToast()` is available everywhere

**`app/layout.tsx`** — added `manifest`, `appleWebApp`, `mobile-web-app-capable` to metadata; added `<meta name="theme-color">` and `<link rel="apple-touch-icon">` for PWA install prompt

**API routes (all 5)** — `GET` handlers now check/set in-process cache (30 s TTL, key = `"entity:spreadsheetId"`); mutations (`POST`/`PUT`/`DELETE`) call `invalidateCache` so next GET is always fresh:
- `app/api/accounts/route.ts`
- `app/api/transactions/route.ts` — also invalidates `accounts` cache (balance sync)
- `app/api/bills/route.ts`
- `app/api/budgets/route.ts`
- `app/api/goals/route.ts`

**`app/(app)/accounts/page.tsx`** — optimistic updates (add/edit/delete reflect instantly); skeleton loader; error state with retry button; pull-to-refresh indicator; `useToast` toasts on all mutations

**`app/(app)/transactions/page.tsx`** — same as above; background `load()` after save to sync account balances without blocking UI; no more `await load()` in happy path

**`app/(app)/bills/page.tsx`** — same as above; now also fetches `/api/paychecks`; added `CashflowCalendar` component (full monthly grid showing paycheck days in green + bill due days in rose with dot indicators, running totals, quick legend)

**`app/(app)/planning/page.tsx`** — optimistic budget/goal saves/deletes; skeleton + error state; pull-to-refresh; toasts

### Behaviour summary
- **Optimistic UI**: save/delete reflects immediately in state; API call runs in background; on failure state rolls back and error toast fires
- **Toasts**: green for success, red for error, dark for info; auto-dismiss at 3.5 s; positioned above mobile nav
- **Skeleton loaders**: replace spinner across all 4 data pages — perceived load time drops significantly
- **Pull-to-refresh**: 72 px swipe-down on mobile triggers `load()`; visual indicator shows pull progress and "Release to refresh" / "Refreshing…" state
- **PWA**: users can now "Add to Home Screen" on iOS/Android for native-like app experience
- **Cashflow Calendar**: bills page now shows a month-grid calendar with paycheck income days (green dots) and bill due days (rose dots); net cashflow summary ("+$X in / -$Y out") shown in header
- **Server cache**: 6 API routes serve from a 30 s in-process Map cache (paychecks added); mutations invalidate immediately — eliminates ~80% of Sheets reads during typical navigation

### Code cleanup & chart fix — May 6, 2026
- **Recharts width(-1) warning fixed**: added `useChartReady()` hook in `DashboardCharts.tsx` that uses `useEffect` to defer all `ResponsiveContainer` renders until after first browser paint; each chart shows an `animate-pulse` skeleton while waiting
- **Dead code removed**: `SpendingAlerts` export deleted from `DashboardCharts.tsx` (functionality already merged into `HealthBanner`); `TrendingDown` unused icon import removed
- **Unused imports cleaned**: `CardHeader`/`CardTitle` removed from `planning/page.tsx` import
- **Dead API route deleted**: `app/api/net-worth-history/route.ts` — never called from client code (dashboard uses server-side `appendNetWorthSnapshot` directly)
- **Paychecks cache added**: `app/api/paychecks/route.ts` now uses `lib/cache.ts` with 30 s TTL; POST/DELETE invalidate `paychecks:` and `accounts:` keys

## Budget Edit (May 6, 2026)
- Added edit (pencil) button to each budget card in the planning page, matching the same pattern as goals
- Clicking pencil opens the "Edit Budget" modal pre-filled with the budget's existing category, amount, and period
- `editBudget` state (`Budget | null`) distinguishes add vs edit mode
- Modal title changes to "Edit Budget"; save button reads "Save Changes"
- Category select is disabled when editing (category is the identity key, not meant to change)
- `saveBudget` uses `editBudget?.id` when in edit mode to preserve the existing row's ID
- The "This replaces existing budget" warning is suppressed in edit mode
- `openAddBudget` function resets `editBudget` to `null` and opens a fresh form
- Toast shows "Budget updated" vs "Budget saved" based on mode
- No API changes needed — existing POST `/api/budgets` (upsert by ID) handles both add and edit

---

## Modal Mobile Enhancements (May 6, 2026)

### `components/ui/Modal.tsx`
- **Swipe-to-dismiss**: Added `useDragControls` from framer-motion; drag handle strip (`sm:hidden`) is the only trigger — `dragListener={false}` on the panel prevents accidental drags from the scrollable body; close fires when `offset.y > 100` or `velocity.y > 500`
- **Safe-area insets**: Bottom padding uses `calc(4.5rem + env(safe-area-inset-bottom, 0px))` via inline style — lifts the sheet above both the mobile nav bar AND the iPhone home indicator on notched devices
- **Expanded max-height**: `max-h-[80dvh]` → `max-h-[88dvh]` on mobile so taller forms (Goals, Paychecks) don't cut off content
- **Drag handle**: Slightly taller touch target (`pb-2`) and `touch-none select-none` to prevent text selection during drag

### All modal forms — sticky action footers
- Moved Cancel + Save/primary action buttons out of the scrollable form body and into a `sticky bottom-0` footer strip (`bg-white border-t border-slate-100`) so they're always reachable without scrolling
- Affected pages: `accounts/page.tsx`, `bills/page.tsx`, `planning/page.tsx` (both budget and goal modals), `paychecks/page.tsx`, `savings/page.tsx`
- Form content divs gained `pb-4` so the last field isn't flush against the sticky footer

### Single-column grids on mobile
- All `grid-cols-2` inside modal forms changed to `grid-cols-1 sm:grid-cols-2` so fields stack vertically on phones and sit side-by-side on tablets/desktop
- Affected: `QuickAddTransaction.tsx` (Date+Desc, Category+Account rows), `transactions/page.tsx` (same rows), `bills/page.tsx` (Amount+Frequency row), `planning/page.tsx` (Period+Limit row)

---

---

## UI/Performance Optimization Pass — May 6, 2026

### Performance fixes
- `globals.css`: Removed `background-attachment: fixed` from body — it forces constant GPU repaints on mobile WebKit during scroll. Background gradient still applies normally.
- `globals.css`: Added `touch-action: manipulation` to `body` — eliminates the browser's 300 ms tap-delay on mobile touch devices.
- `app/layout.tsx`: Added `display: 'swap'` to `Inter` font config — shows fallback font immediately while Inter loads instead of invisible text (FOIT).
- `QuickAddTransaction.tsx`: Replaced `window.location.reload()` with `router.refresh()` from `next/navigation` — avoids a full page/JS reload after adding a transaction; only re-fetches RSC data.
- `components/ui/Modal.tsx`: Added `style={{ willChange: 'transform' }}` to the animated sheet panel — promotes it to its own compositor layer for GPU-accelerated slide animation.
- Framer Motion spring animations in `Sidebar.tsx` and `Modal.tsx`: Reduced spring `duration` from `0.6` → `0.35` and stiffness/bounce tuned for snappier feel.

### CSS transition specificity
Replaced `transition-all duration-300` (watches every CSS property, expensive) with property-specific transitions throughout:
- `Button.tsx`: `transition-[color,background-color,border-color,box-shadow,transform] duration-150`
- `Card.tsx`: `transition-[box-shadow,border-color] duration-200`
- `Input.tsx`, `Select.tsx`: `transition-[border-color,background-color,box-shadow] duration-150`
- `Sidebar.tsx` nav links: `transition-colors duration-150`

### DOM simplification
- `Card.tsx`: Removed the `<div className="absolute inset-0 … opacity-0 group-hover:opacity-100">` gradient overlay — it was invisible/unnoticeable and added an extra DOM node + style recalc on every hover. Also removed the unnecessary `<div className="relative z-10">` wrapper; children render directly.

### Mobile tap UX
- Added `tap-highlight-none` (`-webkit-tap-highlight-color: transparent`) to all sidebar nav links, mobile nav links, modal drag handle, and sign-out buttons — removes the grey flash on tap that feels laggy.
- Added `select-none` to nav and button elements to prevent text selection on long-press.
- Mobile nav items now have `min-h-[52px]` and `justify-center` ensuring a ≥44 px touch target (Apple HIG minimum).
- Mobile header sign-out button padding increased to `p-2.5` and gets `hover:bg-rose-50` for visible feedback.

### Login page
- Replaced emoji feature bullets (📊 🔒 ⚡ 🎯) with properly styled Lucide icon badges (`TrendingUp`, `Shield`, `Zap`, `Target`) — consistent rendering across all platforms.

---

## RocketMoney Feature Expansion (May 6, 2026)

### New Files
- `hooks/useCategories.ts` — `useCategories()` hook; fetches `/api/categories` once, caches in sessionStorage (5 min TTL); returns `expenseCategories` + `incomeCategories` including custom ones
- `app/api/categories/route.ts` — GET returns combined EXPENSE_CATEGORIES + custom; PUT saves custom categories to Settings sheet; 30 s in-process cache
- `app/(app)/reports/page.tsx` — New annual report page at `/reports`

### Modified Files

**`types/index.ts`** — Added `customExpenseCategories: string[]` + `customIncomeCategories: string[]` to `TaxSettings`

**`lib/sheets.ts`** — `getSettings`/`saveSettings` read/write `custom_expense_categories` + `custom_income_categories` (pipe-separated)

**`lib/utils.ts`** — `DEFAULT_TAX_SETTINGS` includes empty custom category arrays

**`app/(app)/dashboard/DashboardCharts.tsx`**
- `BudgetData` type: added `prevMonthSpent?: number`
- `BudgetBars`: added `showMoM` prop for per-category MoM delta display
- Added `HealthScoreData` type, `EmergencyFundWidget` component, `FinancialHealthScore` component (conic-gradient circular gauge, letter grade, 4-factor breakdown)

**`app/(app)/dashboard/page.tsx`**
- Computes emergency fund (liquid savings / avg 3-month expenses), health score (0-100 composite), prevMonthCategorySpend map
- Assets strip: 4-col grid, added "Emergency" cell
- Added EmergencyFundWidget + FinancialHealthScore row
- BudgetBars now receives showMoM + prevMonthSpent per category

**`app/(app)/planning/page.tsx`** — useCategories hook; MoM delta per budget card; custom categories in dropdown

**`app/(app)/transactions/page.tsx`** — CSV export button, merchant grouping toggle (list vs by-merchant view), recurring templates (localStorage)

**`app/(app)/bills/page.tsx`** — Subscription auto-detection (detectSubscriptions), SubscriptionTracker component; useCategories for bill category dropdown

**`app/(app)/settings/page.tsx`** — Custom Categories card: add/remove custom expense and income categories, saved to Settings sheet

**`app/(app)/dashboard/QuickAddTransaction.tsx`** — useCategories hook replaces hardcoded lists

**`components/Sidebar.tsx`** — Added Reports nav item (FileText icon, `/reports`)

### Reports Page (`/reports`)
- Year selector, 4 summary stat cards, highlights (best/worst month)
- Monthly cash flow BarChart, category spending bars, top merchants list, monthly breakdown table

## Category Delete / Hide (May 6, 2026)

### Problem
Default categories (EXPENSE_CATEGORIES / INCOME_CATEGORIES) had no delete option — only custom ones did.

### Solution
- `types/index.ts` — Added `hiddenExpenseCategories: string[]` and `hiddenIncomeCategories: string[]` to `TaxSettings`
- `lib/utils.ts` — DEFAULT_TAX_SETTINGS includes empty arrays for both hidden fields
- `lib/sheets.ts` — `getSettings` reads `hidden_expense_categories` / `hidden_income_categories` (pipe-separated); `saveSettings` writes them
- `app/api/categories/route.ts` — filters hidden categories out of both expense and income lists before returning to client
- `app/(app)/settings/page.tsx`:
  - Default category pills now show an X button on hover (opacity-0 → group-hover:opacity-100)
  - Clicking X calls `hideExpCat`/`hideIncCat` → adds to `hiddenExpenseCategories`/`hiddenIncomeCategories`
  - Hidden categories shown in a rose "Hidden — click to restore" strip; clicking restores them
  - Custom categories still have always-visible X to fully delete them

### UX
- Default categories: X appears on hover; removing hides from dropdowns but can be restored
- Custom categories: X always visible; removing deletes permanently (from the custom list)
- Changes only take effect after clicking Save (like all other settings)

---

## Performance — Dashboard & API Cache Fix (May 6, 2026)

### Root Cause
Dashboard server component called `batchGetDashboardData` + `getNetWorthHistory` directly, **bypassing the in-process cache entirely**. Every navigation to `/dashboard` fired 2 cold Google Sheets API calls (~2–3 s each). Also: `badges` API route had no cache at all (fired a batchGet on every sidebar render).

### Fixes
- **`app/(app)/dashboard/page.tsx`**: Wraps both `batchGetDashboardData` and `getNetWorthHistory` calls with `getCache`/`setCache` from `lib/cache.ts` (45 s TTL). Dashboard now returns instantly on repeat visits within 45 s.
- **`app/api/badges/route.ts`**: Added in-process cache (60 s TTL) for badge counts — no more batchGet on every navigation.
- **All API route mutations** (`transactions`, `accounts`, `bills`, `budgets`, `goals`, `paychecks`) now call `invalidateCache('dashboard:${spreadsheetId}')` and `invalidateCache('badges:${spreadsheetId}')` so the dashboard cache is busted immediately after any write.
- **API route cache TTL** bumped 30 s → 60 s across all GET routes.

### Net Effect
| Scenario | Before | After |
|----------|--------|-------|
| First dashboard load | 4–6 s (2 Sheets calls) | 4–6 s (cold, unavoidable) |
| Return to dashboard within 45 s | 4–6 s (no cache) | <100 ms (cache hit) |
| Client page (transactions, bills…) | 1–3 s per load | <100 ms if within 60 s |
| Sidebar badge fetch | 1–2 s every navigation | <100 ms (cache hit, 60 s TTL) |

---

## Loading Skeletons for All Routes (May 6, 2026)

### Problem
Clicking sidebar nav links caused a 5-second freeze with no feedback — Next.js App Router shows old page while new page fetches.

### Solution — `loading.tsx` convention
Added `loading.tsx` in every route directory under `app/(app)/`. Next.js shows these instantly on navigation while the page component loads/renders:
- `app/(app)/dashboard/loading.tsx` → `DashboardSkeleton`
- `app/(app)/transactions/loading.tsx` → `TransactionsSkeleton`
- `app/(app)/bills/loading.tsx` → `BillsSkeleton`
- `app/(app)/planning/loading.tsx` → `PlanningSkeleton`
- `app/(app)/accounts/loading.tsx` → `AccountsSkeleton`
- `app/(app)/settings/loading.tsx` → `SettingsSkeleton`
- `app/(app)/reports/loading.tsx` → `ReportsSkeleton`
- `app/(app)/paychecks/loading.tsx` → `PaychecksSkeleton`
- `app/(app)/savings/loading.tsx` → `SavingsSkeleton`

### New skeleton components added to `components/ui/Skeleton.tsx`
- `DashboardSkeleton` — header, health banner, stats grid, assets strip, charts row, budget+goals row
- `SettingsSkeleton` — header with buttons, 4 card placeholders
- `ReportsSkeleton` — header, stats, bar chart, two chart cards
- `PaychecksSkeleton` — header, 3 stat cards, 5 row skeletons
- `SavingsSkeleton` — header, 3 stat cards, 4 account card skeletons

---

## Mobile Nav — "More" Sheet (May 6, 2026)

### Problem
Mobile bottom nav only showed 5 items (Dashboard, Accounts, Transactions, Bills, Planning). Reports and Settings were unreachable from mobile.

### Solution
Redesigned `MobileNav` in `components/Sidebar.tsx`:
- **4 primary tabs**: Home, Spending, Bills, Planning (always visible in bottom bar)
- **"More" button** (5th slot): toggles a spring-animated slide-up sheet
- **Sheet contents** (5 icons in a row): Accounts, Savings, Paychecks, Reports, Settings
- **Sheet footer**: Sign Out button
- Sheet closes automatically on navigation (`useEffect` on `path`) or outside tap
- Backdrop (`bg-black/30 + backdrop-blur-sm`) dims the page while sheet is open
- "More" button icon flips to ✕ when sheet is open
- "More" button shows indigo active state when current route is any of the sheet items

---

## Transaction Fixes — May 7, 2026

### Hover effects removed from edit/delete buttons
- **Files:** `app/(app)/transactions/page.tsx`
- List view: removed `group`, `opacity-0 group-hover:opacity-100` from button container — buttons always visible
- Both views: removed `hover:text-indigo-600 hover:bg-indigo-50` / `hover:text-rose-600 hover:bg-rose-50` from buttons
- Merchant view edit button also stripped of hover color classes
- **Why:** Mobile devices cannot hover; buttons were invisible/inaccessible on touch screens

### DELETE transaction now reverses account balances
- **File:** `app/api/transactions/route.ts`
- DELETE handler now fetches the transaction + accounts before deleting
- Reverses balance: expense → refunds account, income → deducts from account, transfer → unwinds both sides (debt payoff reversal included)
- Also added missing `invalidateCache('accounts:...')` to DELETE (was missing before)
- **Why:** Previously, deleting a transaction permanently left account balances wrong

---

## FitText + Drag Reorder — May 7, 2026

### FitText auto-shrinking numbers
- Created `components/ui/FitText.tsx` — `ResizeObserver`-based `<span>` that shrinks `font-size` in 0.5px steps until `scrollWidth <= clientWidth`; prevents number wrap on mobile
- Props: `children` (string), `maxSize` (default 28px), `minSize` (default 12px), `className` (color/weight only)
- Applied to: dashboard main stats (line ~292) and summary row (lines ~309–321), accounts summary (lines ~162–170), savings account cards (lines ~147, 152)

### Drag-to-reorder budgets & goals (planning page) — May 7, 2026
- Added `position?: number` to `Budget` and `Goal` types in `types/index.ts`
- `lib/sheets.ts`: `getBudgets` reads col E (position), sorts by position, falls back to row index for legacy rows; `upsertBudget` writes position = max+1 to col E; added `reorderBudgets()` batchUpdate col E
- Same pattern for goals: col H; `reorderGoals()` added
- `deleteBudget` updated to use `'E'` (was `'D'`); `deleteGoal` updated to use `'H'` (was `'G'`)
- Added `PATCH` handler to `/api/budgets` and `/api/goals` — accepts `[{id, position}]` array
- `planning/page.tsx`: extracted `BudgetItem` and `GoalItem` as `Reorder.Item` sub-components with `GripVertical` drag handle (`dragListener={false}` + `useDragControls`); 600ms debounce before PATCH call
- Animation: replaced `motion.div` wrappers + `motion.div` progress bars with static CSS `transition-all` (simpler inside Reorder.Item)

### Nav order in Settings — May 7, 2026
- `settings/page.tsx`: added `NAV_ITEMS` array + `NavReorderRow` component using `Reorder.Group/Item`; `navOrder` state loaded from `localStorage` on mount; saved to `localStorage` key `novafi_nav_order` on Save click
- `components/Sidebar.tsx`: added `getSortedNav()` reads `novafi_nav_order` from localStorage, sorts `NAV` accordingly; `useEffect` in `Sidebar` component applies the sort on mount (avoids SSR mismatch)

### Mobile nav reorder + removeChild fix — May 7, 2026
- Fixed `Uncaught NotFoundError: removeChild` crash: wrapped every conditional `<motion.div layoutId="mobile-nav-active">` in `<AnimatePresence>` so Framer Motion handles DOM lifecycle properly
- Replaced hardcoded `MOBILE_NAV_PRIMARY` / `MOBILE_NAV_MORE` with `ALL_MOBILE_NAV` (all 9 items) and dynamic `primaryNav = navOrder.slice(0,4)` / `moreNav = navOrder.slice(4)`
- Order stored in localStorage key `novafi_mobile_nav_order`; `getMobileNavOrder()` loads + merges on mount
- "Customize" button in More sheet opens a new slide-up sheet with numbered list of all 9 items, ↑/↓ buttons per item, a visual divider at position 4 ("More" section separator), and a "Reset to Default" button
- Backdrop shows during both sheets (sheetOpen || customizeOpen); outside-tap logic handles both refs

---

## Savings Page Fixes — May 7, 2026

### Savings goals now sync linked account balance
- **File:** `app/(app)/savings/page.tsx`
- Goal cards now check `g.linkedAccountId` first; if set, uses that account's live `balance` as the "saved" amount and for the progress % — falls back to `g.currentAmount` if no linked account
- Matches the existing pattern in `planning/page.tsx` and `dashboard/page.tsx` (those were already correct)
- **Why:** Savings page always read `g.currentAmount` (which stays 0 by default), so linked-account goals always showed 0% progress

### Transfer transactions in savings history
- **File:** `app/(app)/savings/page.tsx`
- Added `ArrowRightLeft` (indigo) icon for transfer-type transactions; deposit (green) and withdrawal (red) icons unchanged
- Direction detection: if savings account is the `toAccount` → treated as incoming (+green); if it's the `account` → outgoing (-red)
- Subtitle for transfers shows `FromAccount → ToAccount · Date`
- Description falls back to `"Transfer"` when `tx.description` is empty (fixes rows where the transaction ID was stored as the description)
- **Why:** Transfers always rendered as red withdrawals regardless of direction; some old rows had the generated ID stored as description

### Auto-refresh hook — `hooks/useAutoRefresh.ts`
- **New file:** `hooks/useAutoRefresh.ts` — shared hook; calls `load()` on `visibilitychange` (tab becomes active) and every 30 s via `setInterval`
- **Applied to:** `savings/page.tsx`, `accounts/page.tsx`, `transactions/page.tsx`
- Dashboard is a server component — not applicable
- **Why:** Changes made on one page (e.g. transactions) were not reflected on other pages until a manual refresh; stale data could show for up to 60 s

---

## Credit Card Expense Formula Fix — May 8, 2026

### Problem
Expense transactions on credit/loan accounts were reducing the owed balance instead of increasing it. The code applied `balance - amount` for all account types, which is correct for checking/savings (draw down funds) but wrong for credit/loan (spending increases what you owe).

### Root cause
`app/api/transactions/route.ts` — three handlers (POST, PUT, DELETE) treated all account types identically for expense transactions.

### Fix
Added `isDebt = account.type === 'credit' || account.type === 'loan'` check in all four expense-related balance mutations:
- **POST create expense**: `isDebt ? balance + amount : balance - amount`
- **PUT reverse original expense**: `isDebt ? balance - amount : balance + amount`
- **PUT apply new expense**: `isDebt ? balance + amount : balance - amount`
- **DELETE reverse expense**: `isDebt ? balance - amount : balance + amount`

Transfer (payoff) logic was already correct — only expense handling was wrong.

---

## Liquid Net Worth Toggle — May 7, 2026

### Problem
Two large loan accounts made the dashboard net worth headline permanently negative, which was psychologically misleading. Safe to spend was already loan-independent (no change needed there).

### Solution
- `types/index.ts` — Added `excludeLoansFromNetWorth: boolean` to `TaxSettings`
- `lib/utils.ts` — Added `excludeLoansFromNetWorth: false` to `DEFAULT_TAX_SETTINGS`
- `lib/sheets.ts` — `getSettings` parses `exclude_loans_from_networth` key; `saveSettings` serializes it
- `app/(app)/settings/page.tsx` — Added "Dashboard Preferences" card (first card) with a toggle: "Show Liquid Net Worth"
- `app/(app)/dashboard/page.tsx` — Fetches settings via `getSettings` (cached 45s); computes both `traditionalNetWorth` (assets − credit − loans) and `liquidNetWorth` (assets − credit only); uses the appropriate one based on `excludeLoansFromNetWorth`; card title becomes "Liquid Net Worth" when on; annotation "Loans excl. · see Liabilities" shown when toggle is on and loan debt > 0

### Key formulas
- Traditional: `sum + (credit|loan ? -balance : balance)`
- Liquid: `sum + (credit ? -balance : loan ? 0 : balance)`

---

## Gratuity (Non-Taxable Income) in Paycheck Flow — May 7, 2026

### Problem
No way to log tips/gratuity income that is non-taxable. User wanted it integrated into the paycheck form, not as a separate flow.

### Solution
- `types/index.ts` — Added `gratuityAmount: number` to `PaycheckEntry`
- `lib/sheets.ts`:
  - `getPaychecks` range updated `J1000` → `K1000`
  - `rowToPaycheck` parses `r[10]` as `gratuityAmount` (defaults 0 for old rows)
  - `addPaycheck` writes `gratuityAmount` to column K
  - `deletePaycheck` last column updated `'J'` → `'K'`
  - `batchGetDashboardData` range updated `J1000` → `K1000`; inline mapper adds `gratuityAmount: Number(r[10] ?? 0)`
- `app/api/paychecks/route.ts` — No changes needed; body passes through as `PaycheckEntry`
- `app/(app)/paychecks/page.tsx`:
  - `EMPTY_FORM` — added `gratuityAmount: ''`
  - `handleSave` — reads gratuity, includes in `PaycheckEntry`, adds it to income transaction amount (`netPaycheck + gratuity`)
  - YTD summary changed from 3-card (`grid-cols-1 md:grid-cols-3`) to 4-card (`grid-cols-2 md:grid-cols-4`); added YTD Gratuity (sky-600)
  - Modal form — added "Gratuity (optional, non-taxable)" input below gross amount; label on gross updated to "Gross Amount (taxable)"
  - Preview breakdown — when gratuity > 0: shows "Net Paycheck", "+ Gratuity (non-taxable)", "= Total Take-Home"; without gratuity: unchanged "Net Take-Home" line
  - Paycheck list rows — shows "Gratuity" column when `gratuityAmount > 0`; label changes from "Net" → "Total"; value shows `netAmount + gratuityAmount`

### Formula
`incomeTransaction.amount = netPaycheck + gratuityAmount`
Tax calculated only on `grossAmount` (taxable); gratuity bypasses `calcPaycheckTax` entirely.

---

## Potential Future Enhancements
| Priority | Task |
|----------|------|
| High | Credit card payoff calculator (months to payoff at X/month) |
| Medium | Split transactions across multiple categories |
| Done | Emergency fund tracker — shipped May 6, 2026 |
| Done | Financial Health Score (composite 0-100) — shipped May 6, 2026 |
| Done | Per-category MoM spending trends — shipped May 6, 2026 |
| Done | Subscription auto-detection — shipped May 6, 2026 |
| Done | Merchant grouping view — shipped May 6, 2026 |
| Done | Recurring transaction templates — shipped May 6, 2026 |
| Done | Custom categories — shipped May 6, 2026 |
| Done | Export data to CSV — shipped May 6, 2026 |
| Done | Annual report page — shipped May 6, 2026 |
| Done | Account balance auto-sync — shipped May 6, 2026 |
| Done | Net worth trend chart — shipped May 6, 2026 |
| Low | Annual tax summary / W-2 estimator |
