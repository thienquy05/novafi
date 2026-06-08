# Project Memory

A running log of changes made to the NovaFi codebase.

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

## 2026-06-08 — Chart data correctness: adaptive currency axis formatter

**Goal:** Chart Y-axes were hardcoded to divide by 1000 (`$${(v/1000).toFixed(0)}k`), so any dataset under $1,000 collapsed every tick to "$0k" — the axis looked broken/static rather than scaling to the actual amounts. Fix all chart axis formatters so they reflect real values across magnitudes (cents-free), including negatives for net-worth charts that cross zero.

**Changes:**
- `lib/utils.ts` — Added `formatAxisCurrency(value)`: `>=1M` → `$1.2M`, `>=1k` → `$1.5k` (trailing `.0` trimmed, e.g. `$1k`/`$12k`), `<1000` → rounded `$250` (no cents). Handles negatives (`-$5k`). Distinct from `formatCompact` (which keeps cents below $1k and is used by the transactions summary cards — left untouched).
- `app/(app)/dashboard/DashboardCharts.tsx` — Imported `formatAxisCurrency`; replaced both hardcoded `tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}` (MonthlyBarChart YAxis line ~376, NetWorthTrendChart YAxis line ~590).
- `app/(app)/reports/page.tsx` — Removed the local `fmt()` helper (same `÷1000` blind spot, also never handled millions) and its `tickFormatter={fmt}`; now imports and uses `formatAxisCurrency` on the monthly cash-flow YAxis.
- `lib/__tests__/utils.test.ts` — New file: 5 tests covering small amounts (no `$0k`), no-cents rounding, thousands with `.0` trim, millions, and negatives.

**Notes:**
- Recharts is only used in those two files (`grep -rln recharts app components`), so all chart axes are now consistent.
- Recharts auto-scales the Y domain to the data already; the bug was purely the tick *label* formatter, not the domain.
- Tooltips still use full-precision `formatCurrency` (cents shown on hover) — only axis ticks use the compact form.
- Pre-existing lint warnings in DashboardCharts (unused `BarChart`/`AreaChart`/`Legend` imports, `set-state-in-effect`) are untouched and unrelated.

**Verification:** `npx tsc --noEmit` clean; `npm test` 6179/6179 passing (was 6174 + 5 new).

## 2026-06-08 — Dashboard/reports chart enhancements + chart accessibility (Groups A/B/C)

**Goal:** Follow-up batch after the axis-formatter fix. Three groups: (A) wire up the missing cash-flow chart + add a budget-vs-actual chart; (B) visual polish (pie center total, animated health ring, animated report bars); (C) accessibility (prefers-reduced-motion + aria-labels on all charts).

**Group A — chart data:**
- `app/(app)/dashboard/page.tsx` — Built `cashFlowData` (last 6 months income/expenses/net from the existing `monthlyTotals` map, reusing `MONTH_SHORT`); rendered a new "Cash Flow" Card (uses existing `dashboard.cashFlow`/`cashFlowSubtitle` locale keys + `BarChart3` icon) after the Net Worth Trend card. `MonthlyBarChart` was previously defined but never rendered. Also rendered `BudgetVsActualChart` above `BudgetBars` in the budget card. Imported both from `./DashboardCharts`.
- `app/(app)/dashboard/DashboardCharts.tsx` — New exported `BudgetVsActualChart`: horizontal grouped recharts BarChart (budget = grey track, spent = indigo, rose Cell when over budget), sorted by spend, height scales with category count, `return null` when `< 2` budgets (avoids a pointless single-bar chart). Complements (does not replace) the detailed `BudgetBars`.

**Group B — polish (all in DashboardCharts.tsx / reports/page.tsx):**
- `SpendingPieChart` — Added a center overlay showing `charts.total` + `formatCurrency(categoryTotal)` for the non-empty state (donut hole was empty before).
- `FinancialHealthScore` — Replaced the static `conic-gradient` ring with an animated framer-motion SVG ring (strokeDashoffset, same technique as `SavingsRateGauge`); `ringTrack` reused for the track circle.
- `reports/page.tsx` — Category breakdown bars now use `motion.div` animating width 0→pct (were static divs with a `transition-all` that never triggered).

**Group C — accessibility:**
- `components/MotionProvider.tsx` (new) — `'use client'` wrapper rendering `<MotionConfig reducedMotion="user">`; added around the app tree in `app/(app)/layout.tsx`. Makes ALL framer-motion animations honor the OS Reduce-Motion setting globally (sidebar, cards, gauges, progress bars).
- Recharts has its own animation system (not governed by MotionConfig), so each chart component now reads `useReducedMotion()` and passes `isAnimationActive={!reduced}` to Pie/Bar/Line/Area (DashboardCharts: SpendingPieChart, MonthlyBarChart, NetWorthTrendChart, BudgetVsActualChart; reports monthly cash-flow Bars). The animated SVG health ring and report bars also gate their `transition.duration` on `reduced`.
- aria-labels: every chart container changed to `<figure role="img" aria-label=...>` with a meaningful summary (pie → total, cash flow → income vs expenses, net worth → latest value, health → score/grade, reports cash flow → title).
- Removed the genuinely-unused `AreaChart` recharts import (was dead before); `BarChart`/`Legend` are now used by `BudgetVsActualChart`.

**Locales:** Added `charts.total`/`charts.budget`/`charts.spent` to `locales/en.json` & `vi.json`. (`dashboard.cashFlow`/`cashFlowSubtitle` already existed.)

**Notes:**
- `BudgetVsActualChart` intentionally duplicates the budget data shown by `BudgetBars` (one gives cross-category comparison, the other per-category detail). Flagged to the user in case they prefer only one.
- Recharts auto-scales chart domains to data already; combined with the earlier `formatAxisCurrency`, small datasets now render correctly.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors (only pre-existing `set-state-in-effect` + unused-import warnings unrelated to this work); `npm test` 6179/6179 passing; `npm run build` compiled successfully (27/27 pages).

## 2026-06-08 — Quick Add transfers + Top Merchants bar chart (Group D #6, #7)

**Goal:** (#6) Let users log transfers from the dashboard Quick Add (previously expense/income only); (#7) replace the reports Top Merchants text list with a horizontal bar chart. (Group D #9 sidebar work was explicitly descoped by the user.)

**#6 — Transfer in Quick Add (`app/(app)/dashboard/QuickAddTransaction.tsx`):**
- Mirrors the existing transactions-page transfer model (no API/type changes — `Transaction.toAccount` + `type:'transfer'` already supported; the POST is identical to what the transactions page already does).
- `EMPTY_FORM` gains `toAccount: ''`.
- Toggle expanded to 3-way (expense/income/**transfer**), transfer styled blue to match the transactions page.
- `handleTypeChange('transfer')` sets `category: 'Transfer'`.
- Fields are now transfer-aware: category hidden for transfers; account select relabeled "From Account" (`transactions.fromAccount`); a "To Account" select (`transactions.toAccount`) appears, its options excluding the chosen from-account.
- `handleSave` builds the transfer tx (`category:'Transfer'`, `account`=from, `toAccount`=to) and requires both accounts; Save button disabled until amount + both accounts set.
- Used existing `common.transfer` label (the stale `quickAdd.transferLabel` key still literally reads "None" — left untouched, not used).

**#7 — Top Merchants horizontal bar chart (`app/(app)/reports/page.tsx`):**
- Replaced the ranked text list with a vertical-layout recharts `BarChart` (merchant on Y, spend on X via `formatAxisCurrency`, indigo bars). Sorted descending so rank is implicit.
- Custom `Tooltip content` shows merchant name + `formatCurrency(total)` + `count` (`reports.transactions`) — the per-merchant count that the list used to show inline now lives in the tooltip (chosen option A).
- YAxis `tickFormatter` capitalizes + truncates long names to 14 chars. Height scales with merchant count. Inherits Group C treatment: `<figure role="img" aria-label>` + `isAnimationActive={!reduced}` + `!ready` skeleton.

**Notes:**
- No locale keys added — all needed keys (`transactions.fromAccount/toAccount`, `common.transfer/selectPlaceholder`, `reports.topMerchants/transactions`) already existed.
- Group D #9 (sidebar user info + collapse) intentionally NOT implemented per user.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors (pre-existing warnings only); `npm test` 6179/6179 passing; `npm run build` compiled successfully (27/27 pages).

## 2026-06-08 — Sidebar/nav redesign: section groups + persistent Quick Add (desktop + mobile)

**Goal:** Make the nav scannable and give quick-add a persistent home on every page (was dashboard-only). Mobile-first app, so both the desktop sidebar and the mobile bottom bar were redesigned together. (Decision: static group labels, NOT collapsible accordions — only 9 items, 1 click to anything.)

**`app/(app)/dashboard/QuickAddTransaction.tsx`:**
- Replaced `isFab?: boolean` prop with `variant?: 'header' | 'fab' | 'sidebar' | 'navFab'` (default 'header'). New triggers: `sidebar` = full-width filled indigo "+ Quick Add" button; `navFab` = raised circular center "+" for the mobile bottom bar (`-mt-7`, shadow).
- `accounts` prop is now optional. When omitted (sidebar / bottom-bar usage) it lazily fetches `/api/accounts` the first time the modal opens (nav stays mounted across routes, so ~once per session). When provided it stays in sync via effect. Account dropdowns only render `a.name`, so no stale-balance concern.

**`components/Sidebar.tsx` (rewritten):**
- Desktop `Sidebar`: logo → full-width `<QuickAddTransaction variant="sidebar" />` → grouped nav (OVERVIEW: Dashboard, Reports · MONEY: Accounts, Transactions, Paychecks · PLAN: Savings, Bills, Planning) with subtle uppercase labels → Settings + Sign out pinned at the bottom (border-top). `aside` is now `h-screen sticky top-0` with the nav region `flex-1 overflow-y-auto` so the footer pins and only the list scrolls on short viewports. Kept the `layoutId="sidebar-active"` animated pill (extracted to a `renderLink` helper). Settings moved out of the groups to the pinned footer.
- Mobile `MobileNav`: bottom bar is now **2 nav · raised center "+" (navFab) · 1 nav · More** (`primaryNav = slice(0,3)`, was 4). The "More" slide-up sheet groups its overflow items by section using `NAV_GROUP_OF` + `MORE_GROUPS` (Overview/Money/Plan/System labels, `grid-cols-4`). Customize sheet divider moved from index 4→3 and hint switched to `nav.firstThreeItems`. Extracted `renderBottomItem` / `renderMoreItem` helpers.
- Typed the nav data: `NavItem` type, `NAV_GROUPS`, `SETTINGS_ITEM`, `ALL_MOBILE_NAV: NavItem[]`. Imports `QuickAddTransaction` from `@/app/(app)/dashboard/QuickAddTransaction` and `type LucideIcon`.

**`app/(app)/dashboard/page.tsx`:** Removed the now-duplicate dashboard quick-add — the desktop header `<QuickAddTransaction>` button and the mobile floating FAB (plus the import). Quick-add is global in the nav now. `accounts` is still used by the dashboard calculations.

**Locales:** Added `nav.groupOverview/groupMoney/groupPlan/groupSystem` and `nav.firstThreeItems` to en/vi. (`nav.firstFourItems` left in place, now unused.)

**Notes:**
- Descoped per user: sidebar user-info block + desktop collapse (old item #9).
- Modal is a `fixed z-[200]` overlay, so embedding the trigger inside the nav flex doesn't affect layout.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors (pre-existing warnings only); `npm test` 6179/6179 passing; `npm run build` compiled successfully (27/27 pages).
