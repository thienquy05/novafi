# NovaFi — Your Personal Finance Hub

**NovaFi** is a modern, privacy-first personal finance dashboard built on top of **Google Sheets**. Instead of handing your most sensitive data to a third-party server, NovaFi stores everything in a spreadsheet *you* own — visible, editable, and exportable at any time. Sign in with Google and your finance workspace is ready in seconds.

> Your data lives in your Google Drive — not on someone else's servers.

---

## Why NovaFi

| | NovaFi | Most finance apps |
|---|--------|-------------------|
| **Data ownership** | You own it (your Google Drive) | Stored on vendor servers |
| **Setup time** | Under 2 minutes | Varies |
| **Cost** | Free to self-host | Often subscription-based |
| **Direct access** | Open the Sheet and edit by hand | Not possible |
| **Export / backup** | Always available (it's a spreadsheet) | Usually paywalled |
| **Languages** | English + Tiếng Việt | Usually one |

---

## Features

### Dashboard
Your command center — a single screen that answers "how am I doing?"

- **Net Worth** — full net worth (assets − liabilities), with an optional **Liquid Net Worth** view that excludes loan balances (toggle in Settings).
- **Monthly snapshot** — income, spending, and month-over-month change.
- **Safe-to-Spend** — what's left this month after your remaining bills (your share only, for shared bills).
- **Savings rate**, **spending breakdown** pie, and **budget progress** bars (with rollover when enabled).
- **Bill forecast** — what you still owe before month-end.
- **Net Worth trend** chart with a forward projection, an **emergency-fund** gauge, and a **Financial Health Score** — a 0–100 composite (letter grade A–F) from six pillars:

  | Pillar | Weight |
  |--------|:-----:|
  | Savings rate | 25 |
  | Emergency fund coverage | 20 |
  | Debt-to-income ratio | 20 |
  | Budget adherence | 15 |
  | Net-worth trend momentum | 10 |
  | Spending consistency | 10 |

- **Quick Add** — log income or an expense without leaving the page.

### Accounts
Checking, savings, credit, investment, and loan accounts in one place. Color-coded cards with institution and last-4. Balances are **transaction-driven**: every add / edit / delete reverses or re-applies its exact balance effect, so the numbers always reconcile.

### Transactions
The full ledger of income, expenses, and transfers. Search and filter by type, category, account, or keyword; date-grouped; swipe-to-delete on mobile; inline edit. Lists page in batches (newest first) with a **Show more** button so large ledgers stay fast.

### Loans & IOUs
Track money you've **lent** or **borrowed**. The cash movement is recorded as a transfer (so it shifts the account balance without counting as income or expense), partial paybacks accrue toward settlement, and a loan can be **fully edited** — changing the amount or account rebuilds its cash transaction atomically so balances never drift. Deleting a loan reverses every linked transfer.

### Bills (with shared/split support)
Recurring bills with frequency, due date, account, and category — color-coded by urgency (red within 3 days or overdue, amber within a week). A bill can be **split with a contact**: paying it charges the **full** amount to your account but only logs **your share** as an expense; the other person's share becomes an **"Owed to You"** receivable. When they pay you back, marking it settled returns their share to the account as a logged transfer — never counted as income. (Modeled just like Loans.)

### Paychecks & Tax
Log gross pay and NovaFi computes the tax to set aside using **2026 IRS brackets** + standard deduction (or a flat rate), plus state/local and FICA (Social Security + Medicare), with optional pre-tax 401(k)/HSA/IRA and non-taxable gratuity. Deleting a paycheck reverses its deposit.

### Planning — Budgets & Goals
Per-category budgets (monthly / weekly / yearly, normalized to a monthly view) with optional **rollover** of last month's overspend, drag-to-reorder, and savings **goals** that can link to a savings account to track real-time progress.

### Savings
A focused view of savings accounts and their goals. Deposit / withdraw inline (each creates a transaction), edit account details, and a paged transaction history.

### Reports
Year-in-review analytics — monthly income-vs-expense bars, category breakdowns, and a spending-pace projection, with a year selector.

### Settings
Organized into in-page tabs — **General · Taxes & Payroll · Categories · About & Data**:

- **General** — display name, language (English / Tiếng Việt), dark mode, liquid-net-worth and budget-rollover toggles.
- **Taxes & Payroll** — filing status, pay periods, 401(k)/HSA/IRA, federal (flat or 2026 brackets), state/local, FICA.
- **Categories** — add or hide custom expense/income categories.
- **About & Data** — force a fresh sync, and a link to the spreadsheet in your Drive.

---

## Notifications

Live **badge counters** in the sidebar surface overdue bills and over-budget categories (cached server-side, refreshed periodically). Data pages **auto-refresh** in the background and re-sync when you return to the tab.

---

## Internationalization

Every user-facing string is keyed through a `t()` helper with locale files in `lib/i18n/` and `locales/`. NovaFi ships full **English** (`en`) and **Vietnamese** (`vi`) translations; the choice is saved to `localStorage` and to your Settings sheet so it follows you across devices.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, React Server Components) |
| UI | React 19, Tailwind CSS v4, Radix UI primitives |
| Charts | Recharts |
| Animation | Framer Motion |
| Auth | NextAuth (Google OAuth 2.0) |
| Storage | Google Sheets API v4 (your own spreadsheet) |
| Caching | Server-side in-memory cache (short TTL) |
| Testing | Vitest (comprehensive unit suite over the calculation/ledger logic) |
| Language | TypeScript (strict) |

---

## How It Works

1. **Sign in with Google** — NovaFi requests OAuth scopes for Google Sheets + Drive.
2. **Spreadsheet bootstrap** — on first login it creates **"NovaFi Finance Data"** in your Drive and provisions the tabs it needs (older sheets are upgraded on the fly when a new feature's tab is missing).
3. **API routes** — every read/write/delete goes through a Next.js route that calls the Google Sheets API with your access token. No third-party database is involved.
4. **Balance integrity** — account balances are derived from the transaction ledger; the shared `applyTransactionToBalances` helper applies and reverses effects so add/edit/delete always round-trips.
5. **Pure calculation library** — all financial formulas live in `lib/calculations.ts` as pure, separately-tested functions, independent of the UI.

### Spreadsheet tabs

| Tab | Contents |
|-----|----------|
| `Settings` | Tax config, language, categories, toggles |
| `Accounts` | Name, type, institution, last-4, balance, color |
| `Transactions` | Date, description, amount, type, category, account(s) |
| `Paychecks` | Gross, withholdings to set aside, gratuity, deposit |
| `Budgets` | Category, amount, period |
| `Bills` | Name, amount, frequency, due date, account, split info |
| `Contacts` | People you split bills or settle loans with |
| `Splits` | "Owed to you" records for shared bills |
| `Loans` | Lent/borrowed IOUs and their cash transfers |
| `Goals` | Name, icon, target, deadline, linked account |
| `NetWorthHistory` | Monthly net-worth snapshots (appended automatically) |

You can open this spreadsheet any time to view, hand-edit, or export your data.

---

## Quick Start (local development)

```bash
# 1. Clone and install
git clone <your-repo-url>
cd NovaFi
npm install

# 2. Configure environment
cp .env.local.example .env.local
# Fill in your Google OAuth credentials — see SETUP.md

# 3. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in — your spreadsheet is created automatically.

### Useful scripts

```bash
npm run dev        # start the dev server
npm run build      # production build
npm test           # run the Vitest suite
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

---

## Deployment

NovaFi deploys cleanly to **Vercel**. See **[SETUP.md](./SETUP.md)** for the full walkthrough: creating a Google Cloud project, enabling the Sheets + Drive APIs, setting up OAuth 2.0 credentials, and configuring `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.

---

*Keep your `.env.local` private — it holds the OAuth credentials that authorize access to your Google Sheet.*
