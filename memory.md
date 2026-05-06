# RocketMoney App — Build Memory

Tracks completed work at each step so any session can resume without losing context.

---

## Current Version — NovaFi Web App (Next.js + Google Sheets)

**Last Updated:** May 6, 2026

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

## Potential Future Enhancements
| Priority | Task |
|----------|------|
| High | Emergency fund tracker (show months of expenses covered by savings) |
| High | Credit card payoff calculator (months to payoff at X/month) |
| Medium | Export data to CSV |
| Medium | Recurring transaction templates |
| Done | Account balance auto-sync for regular expense/income transactions — shipped May 6, 2026 |
| Done | Net worth trend chart over time — shipped May 6, 2026 |
| Low | Annual tax summary / W-2 estimator |
