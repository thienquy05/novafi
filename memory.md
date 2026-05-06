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

## Potential Future Enhancements
| Priority | Task |
|----------|------|
| High | Emergency fund tracker (show months of expenses covered by savings) |
| High | Credit card payoff calculator (months to payoff at X/month) |
| Medium | Export data to CSV |
| Medium | Recurring transaction templates |
| Medium | Account balance auto-sync for regular expense/income transactions |
| Done | Net worth trend chart over time — shipped May 6, 2026 |
| Low | Annual tax summary / W-2 estimator |
