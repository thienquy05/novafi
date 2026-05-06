# NovaFi — Personal Finance Web App

A self-hosted personal finance tracker built with **Next.js 16**, **Google OAuth**, and **Google Sheets** as your personal database. All your data lives in a Google Sheet in your own Drive — no third-party database required.

## Features

- **Dashboard** — Net worth, spending charts, budget progress, upcoming bills
- **Accounts** — Checking, savings, credit cards, investments, loans
- **Transactions** — Full history with search, filters, and smart transfer support
- **Paychecks** — Log paychecks with automatic tax breakdown (federal, state, FICA, 401k, HSA)
- **Bills** — Recurring bills with auto-advancing due dates
- **Planning** — Monthly budgets + savings goals side by side
- **Settings** — Configure tax rates, filing status, pay periods

## Tech Stack

| Package | Purpose |
|---------|---------|
| `next@16` | Web framework (App Router) |
| `next-auth@5` | Google OAuth (requests Sheets + Drive scopes) |
| `googleapis` | Google Sheets API v4 + Drive API v3 |
| `tailwindcss@4` | Styling |
| `recharts` | Charts |
| `framer-motion` | Animations |
| `@radix-ui/*` | UI primitives |

## Quick Start (Local)

```bash
# 1. Clone and install
git clone <your-repo-url>
cd RocketMoney
npm install

# 2. Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your Google OAuth credentials (see SETUP.md)

# 3. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google. On first sign-in, a **"NovaFi Finance Data"** spreadsheet is automatically created in your Google Drive — no manual sheet setup needed.

## Deploy to Vercel

See **[SETUP.md](./SETUP.md)** for the complete step-by-step guide covering:
- Google Cloud Console setup
- Vercel deployment
- Environment variables
- What Google Sheet columns are created automatically

## Google Sheets Structure

The app automatically creates a spreadsheet with 8 tabs on your first login:

| Sheet Tab | What it stores |
|-----------|----------------|
| `Settings` | Tax rates, 401k %, HSA, pay periods |
| `Accounts` | Bank/investment accounts and balances |
| `Transactions` | All income, expenses, and transfers |
| `Paychecks` | Paycheck log with tax breakdowns |
| `Budgets` | Monthly budget limits per category |
| `Bills` | Recurring bills with due dates |
| `Goals` | Savings goals with target amounts |
| `NetWorthHistory` | Monthly net worth snapshots for trend chart |

> You can view and edit the spreadsheet directly in Google Sheets at any time.

## Security Note

Never commit `.env.local` — it contains your OAuth secrets. The `.gitignore` already excludes all `.env*` files.
