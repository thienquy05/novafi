-- Run this once in the Vercel Postgres dashboard (or via psql) to create all tables.
-- Vercel Postgres: Project → Storage → your DB → Query tab, then paste and run.

CREATE TABLE IF NOT EXISTS users (
  id   TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name  TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  user_id                    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  filing_status              TEXT    NOT NULL DEFAULT 'single',
  pay_periods_per_year       INT     NOT NULL DEFAULT 26,
  k401_pct                   NUMERIC NOT NULL DEFAULT 5,
  hsa_annual                 NUMERIC NOT NULL DEFAULT 1600,
  ira_annual                 NUMERIC NOT NULL DEFAULT 0,
  federal_rate               NUMERIC NOT NULL DEFAULT 22,
  state_rate                 NUMERIC NOT NULL DEFAULT 3.125,
  city_rate                  NUMERIC NOT NULL DEFAULT 1.5,
  fica_ss_rate               NUMERIC NOT NULL DEFAULT 6.2,
  fica_ss_wage_base          NUMERIC NOT NULL DEFAULT 176100,
  fica_medicare_rate         NUMERIC NOT NULL DEFAULT 1.45,
  use_federal_brackets       BOOLEAN NOT NULL DEFAULT FALSE,
  exclude_loans_from_networth BOOLEAN NOT NULL DEFAULT FALSE,
  custom_expense_categories  TEXT    NOT NULL DEFAULT '',
  custom_income_categories   TEXT    NOT NULL DEFAULT '',
  hidden_expense_categories  TEXT    NOT NULL DEFAULT '',
  hidden_income_categories   TEXT    NOT NULL DEFAULT '',
  language                   TEXT    NOT NULL DEFAULT 'en'
);

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT    NOT NULL,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL DEFAULT '',
  type        TEXT    NOT NULL DEFAULT 'checking',
  institution TEXT    NOT NULL DEFAULT '',
  balance     NUMERIC NOT NULL DEFAULT 0,
  last4       TEXT    NOT NULL DEFAULT '',
  color       TEXT    NOT NULL DEFAULT '#6366f1',
  created_at  TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT    NOT NULL,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  amount      NUMERIC NOT NULL DEFAULT 0,
  type        TEXT    NOT NULL DEFAULT 'expense',
  category    TEXT    NOT NULL DEFAULT '',
  account     TEXT    NOT NULL DEFAULT '',
  to_account  TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS paychecks (
  id               TEXT    NOT NULL,
  user_id          TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             TEXT    NOT NULL,
  gross_amount     NUMERIC NOT NULL DEFAULT 0,
  federal_withheld NUMERIC NOT NULL DEFAULT 0,
  state_withheld   NUMERIC NOT NULL DEFAULT 0,
  local_withheld   NUMERIC NOT NULL DEFAULT 0,
  k401             NUMERIC NOT NULL DEFAULT 0,
  hsa              NUMERIC NOT NULL DEFAULT 0,
  net_amount       NUMERIC NOT NULL DEFAULT 0,
  notes            TEXT    NOT NULL DEFAULT '',
  gratuity_amount  NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS budgets (
  id       TEXT    NOT NULL,
  user_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT    NOT NULL DEFAULT '',
  amount   NUMERIC NOT NULL DEFAULT 0,
  period   TEXT    NOT NULL DEFAULT 'monthly',
  position INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS bills (
  id        TEXT    NOT NULL,
  user_id   TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name      TEXT    NOT NULL DEFAULT '',
  amount    NUMERIC NOT NULL DEFAULT 0,
  frequency TEXT    NOT NULL DEFAULT 'monthly',
  next_due  TEXT    NOT NULL DEFAULT '',
  account   TEXT    NOT NULL DEFAULT '',
  category  TEXT    NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS goals (
  id                TEXT    NOT NULL,
  user_id           TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL DEFAULT '',
  target_amount     NUMERIC NOT NULL DEFAULT 0,
  current_amount    NUMERIC NOT NULL DEFAULT 0,
  deadline          TEXT    NOT NULL DEFAULT '',
  icon              TEXT    NOT NULL DEFAULT '🎯',
  linked_account_id TEXT    NOT NULL DEFAULT '',
  position          INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS net_worth_history (
  id        TEXT    NOT NULL,
  user_id   TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      TEXT    NOT NULL,
  month     TEXT    NOT NULL,
  net_worth NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (id, user_id)
);
