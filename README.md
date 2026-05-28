# NoviFi — Your Personal Finance Hub

**NoviFi** is a modern, privacy-first personal finance dashboard built on top of **Google Sheets**. Instead of handing your most sensitive data to a third-party server, NoviFi stores everything in a spreadsheet you own — visible, editable, and exportable at any time. Sign in with Google and your personal finance workspace is ready in seconds.

> "Your data lives in your Google Drive — not on our servers."

---

## What Makes NoviFi Different

| Feature | NoviFi | Most Finance Apps |
|---------|--------|-------------------|
| Data ownership | You own it (Google Drive) | Stored on vendor servers |
| Setup time | < 2 minutes | Varies |
| Cost | Free to self-host | Often subscription-based |
| Offline editing | Open the Sheet directly | Not possible |
| Export / backup | Always available as CSV | Usually paywalled |

---

## Feature Overview

### Dashboard
The main command center, loaded fresh on every visit with a 45-second server-side cache for performance.

- **Net Worth** — Traditional net worth (all assets minus all liabilities) and **Liquid Net Worth** (excludes illiquid investments and loans, togglable in Settings).
- **Monthly Snapshot** — Income vs. expenses for the current month, with percentage change vs. the previous month.
- **Safe-to-Spend** — How much you can still spend this month after accounting for remaining bills.
- **Spending Pace** — Are you on track to stay under budget? A pro-rated projection shows your expected month-end spend.
- **Savings Rate** — Calculated as `(income − expenses) / income`, displayed as a KPI with trend direction.
- **Spending Breakdown** — Interactive pie chart of this month's expenses by category.
- **Budget Progress Bars** — Visual bars for every active budget, color-coded by over/under status.
- **Upcoming Bills** — Rest-of-month bill forecast with total remaining amount.
- **Savings Goals Summary** — Quick progress view across all your goals.
- **Net Worth Trend Chart** — Historical net worth snapshots plotted over time with a forward **Net Worth Projection** line based on your average monthly savings rate.
- **Emergency Fund Widget** — Months of runway from liquid savings, benchmarked against the 3–6 month standard.
- **Financial Health Score** — A composite letter grade (A–F) and numeric score (0–100) calculated from six pillars:
  - Savings Rate (25 pts)
  - Emergency Fund coverage (20 pts)
  - Budget adherence (20 pts)
  - Debt-to-Income ratio (15 pts)
  - Net Worth trend momentum (10 pts)
  - Spending volatility / consistency (10 pts)
- **Quick Add Transaction** — One-tap modal to log income or expenses without leaving the dashboard.

---

### Accounts
Track every financial account in one place.

- Add checking, savings, credit cards, investments, or any custom account type.
- Color-coded cards with institution name and last-4 digits.
- **Deposit / Withdraw** — Transactions flow through the standard transaction log and automatically update the account balance.
- Balances are live-synced; creating or deleting a transaction reverses the balance effect precisely.

---

### Transactions
A complete record of every money movement.

- Log income, expenses, and transfers with amount, date, category, account, and notes.
- **Inline Edit & Delete** — Edit/delete buttons are always visible (no hover required) for full mobile usability.
- **Swipe-to-Delete** gesture support on mobile.
- **Date Grouping** — Transactions are grouped by date for easy scanning.
- **Smart Search & Filter** — Filter by type, category, account, or keyword; filter sheet slides up from the bottom on mobile.
- **Category Icons** — Each category has a distinct icon rendered consistently across all pages.
- Deleting a transaction **reverses its balance effect** on the associated account automatically.

---

### Paychecks & Tax
Purpose-built paycheck logger with US tax math built in.

- Log gross pay, and NoviFi calculates:
  - **Federal income tax** using 2026 IRS brackets and standard deduction.
  - **State income tax** (flat rate, configurable in Settings).
  - **FICA** — Social Security (6.2 %) and Medicare (1.45 %).
  - **Retirement contributions** — 401(k) / 403(b) percentage (pre-tax).
  - **Gratuity** — Optional non-taxable tip/gratuity field; excluded from taxable income calculations.
- Effective tax rate displayed on each paycheck card.
- All paycheck rows stored in the **Paychecks** sheet tab; viewable and editable in Google Sheets any time.

---

### Planning (Budgets & Goals)
One page covering both monthly budgets and long-term savings goals.

- **Budgets** — Set per-category limits on a monthly, weekly, or yearly cadence; NoviFi normalizes to a monthly equivalent for comparisons.
- **Budget Rollover** — Optionally carry unspent budget from the previous month forward. The effective budget updates automatically.
- **Drag-to-Reorder** — Budgets can be reordered via drag handles (powered by Framer Motion).
- **Savings Goals** — Give each goal a name, emoji icon, target amount, target date, and optionally link it to a savings account.
- Linked goals automatically reflect the live balance of the linked account instead of a static number.
- Goal progress ring and percentage shown on each goal card.

---

### Bills
Never miss a recurring payment.

- Add bills with name, amount, due day, and category.
- **Bill Forecast** — The Dashboard shows every bill due before month-end and the total remaining.
- **Mark Paid** — Opens a "Record Payment" modal that creates an expense transaction and saves a template for next time (stored in `localStorage`).
- **Skip** — Advances the due date by one cycle without creating a transaction.
- Overdue bills surface as a **badge counter** on the Bills nav item.

---

### Savings
A focused view of savings accounts and their linked goals.

- Separate list of accounts tagged as savings-type.
- Deposit and withdraw directly; each action creates a corresponding transaction entry.
- **Edit Account** — Inline pencil modal to update name, institution, balance, or color.
- Goal cards show linked account balance progress in real time.

---

### Reports
Year-in-review analytics beyond the dashboard.

- **Monthly Bar Chart** — Income vs. expenses side-by-side for every month of the selected year.
- **Category Breakdown** — Stacked or per-category bars showing where money went each month.
- **Spending Pace Widget** — Reused from the Dashboard; shows the current month's projected overage or savings.
- Year selector to review any prior year's data.
- Color-coded by category using a consistent palette.

---

### Settings
Global configuration for your NoviFi instance.

- **Tax Settings** — Filing status, state tax rate, retirement contribution %, retirement limit, FICA toggle.
- **Custom Categories** — Add or hide expense and income categories beyond the built-in set.
- **Dark Mode** — Toggle between light and dark themes; preference saved to `localStorage`.
- **Language** — Switch the entire UI between **English** and **Vietnamese (Tiếng Việt)**; preference synced to your Settings sheet.
- **Liquid Net Worth Toggle** — Exclude loans from net worth calculation for a "liquid" view.
- **Manual Refresh** — Force a fresh sync from your Google Sheet from within the settings page.

---

## Notification & Automation

- **Badge Counters** — The sidebar shows live badge numbers for overdue bills and over-budget categories (refreshed every 60 seconds, cached server-side).
- **Daily Push Notifications** — A cron endpoint (`/api/cron/daily-push`) dispatches Web Push notifications each morning summarizing bills due today and any over-budget categories. Subscribe from Settings (requires HTTPS / a deployed environment).
- **Auto-Refresh** — All data pages silently poll for updates every 30 seconds and refresh immediately when you return to the browser tab.

---

## Internationalization (i18n)

NoviFi ships with full translations for:

| Language | Code |
|----------|------|
| English | `en` |
| Vietnamese | `vi` |

All user-visible strings are keyed through the `t()` helper, with locale files under `lib/i18n/`. Switch languages in **Settings → Language** — the choice is persisted both in `localStorage` and in your Google Sheet so it survives across devices.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router, React Server Components) |
| Styling | Tailwind CSS + CSS variables for theming |
| Charts | Recharts |
| Animations | Framer Motion (drag-to-reorder, transitions) |
| Auth | NextAuth.js (Google OAuth 2.0) |
| Database | Google Sheets API v4 |
| Caching | Server-side in-memory cache (45 s TTL) |
| Notifications | Web Push API + Vercel Cron |
| Testing | Vitest (147 tests covering all formula logic) |
| Type checking | TypeScript strict mode |

---

## How It Works (Under the Hood)

1. **Sign in with Google** — NoviFi requests OAuth scopes for Google Sheets and Drive.
2. **Spreadsheet creation** — On first login, the app creates a new spreadsheet called **"NoviFi Finance Data"** in your Google Drive and sets up 8 tabs automatically.
3. **API routes** — Every data operation (read / write / delete) calls a Next.js API route, which in turn calls the Google Sheets API using your OAuth access token. No third-party database is ever involved.
4. **Server-side cache** — API responses are cached in memory for 45 seconds to avoid redundant Sheets API calls during rapid navigation.
5. **Calculations library** — All financial formulas live in `lib/calculations.ts` as pure functions, separately tested with Vitest, so the logic is independent of the UI.

---

## Your Google Sheet Structure

NoviFi manages 8 tabs in your spreadsheet:

| Tab | Contents |
|-----|----------|
| `Settings` | Tax rates, retirement %, language preference, categories, toggles |
| `Accounts` | Account name, type, institution, last-4, balance, color |
| `Transactions` | Date, description, amount, type, category, account ID, notes |
| `Paychecks` | Gross pay, deductions, net pay, gratuity, effective tax rate |
| `Budgets` | Category, amount, period, rollover flag |
| `Bills` | Name, amount, due day, category, last-paid date |
| `Goals` | Name, icon, target amount, target date, linked account |
| `NetWorthHistory` | Date + net worth snapshot (appended automatically) |

You can open this spreadsheet in Google Sheets at any time to view, manually edit, or export your data.

---

## Quick Setup (Local Development)

```bash
# 1. Clone and install
git clone <your-repo-url>
cd NoviFi
npm install

# 2. Configure environment variables
cp .env.local.example .env.local
# Fill in Google OAuth credentials (see SETUP.md)

# 3. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in. Your spreadsheet is created automatically.

To run the test suite:

```bash
npm test
```

---

## Deployment

NoviFi deploys to **Vercel** in minutes. See **[SETUP.md](./SETUP.md)** for a complete walk-through covering:

- Creating a Google Cloud project and enabling the Sheets + Drive APIs.
- Setting up OAuth 2.0 credentials.
- Configuring `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` on Vercel.
- Enabling Vercel Cron for daily push notifications.

---

## Running Tests

```bash
npm test            # run all 147 Vitest tests
npm test -- --watch # watch mode
```

All formula logic in `lib/calculations.ts` is covered by unit tests. Run them before submitting changes to financial calculations.

---

*Keep your `.env.local` file private — it contains the OAuth credentials that authorize access to your Google Sheet.*
