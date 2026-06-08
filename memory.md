# Project Memory

A running log of changes made to the NovaFi codebase.

## 2026-06-08 — Credit deepening: health-score factor, statement dates, util trend, banner notice + dashboard redesign (branch claude/relaxed-albattani-ffio8g)

Implemented all four follow-up ideas plus a dashboard reorganization.

### #1 Credit utilization as a 7th Financial Health Score factor
- **`lib/calculations.ts`**: `calcCreditUtilizationScore(util|null)` (max 15; null → neutral-good 12), `HEALTH_WEIGHTS` (savings 22 / emergency 18 / credit 15 / dti 15 / budget 12 / trend 9 / volatility 9 = 100), and `composeHealthScore(parts)` which rescales the six existing sub-scores (untouched, so their tests stand) to the new weights and returns a `breakdown` whose integers sum exactly to `score`.
- **`app/(app)/dashboard/page.tsx`**: replaced the manual 6-factor sum with `composeHealthScore({...subScores, creditUtil})`; passes `creditUtil` + the new breakdown to `FinancialHealthScore`.
- **`DashboardCharts.tsx`** `FinancialHealthScore`: `HealthScoreData` gains `creditUtil` + `breakdown.credit`; a new "Credit Use" factor row; all maxes now read from `HEALTH_WEIGHTS`.

### #2 Statement-date awareness
- **`types`/`lib/sheets.ts`**: `Account.statementDay` (1–31) persisted in **Accounts column K** (ranges widened J200→K200 everywhere; `rowToAccount` r[10]; upsert appends it).
- **`lib/calculations.ts`**: `daysUntilStatement(statementDay, today)` — days to next close (clamps 31 to short months; null when unset).
- **`/credit` page**: per-card editor now sets limit **and** statement day; shows a "Statement closes in Nd" chip and a statement-aware nudge ("statement closes in Nd — pay $X to report under 30%").
- **Dashboard credit container**: same statement-aware nudge for the worst card.

### #3 Utilization trend
- Extended the monthly **NetWorthHistory** snapshot with a `creditUtil` column (E): header, `NET_WORTH_RANGE` A2:D→A2:E, `parseNetWorthRows` r[4] (legacy → null), `appendNetWorthSnapshot` writes it, dashboard snapshot passes `creditReport.overallUtil`. `NetWorthSnapshot.creditUtil?` added.
- Dashboard builds `utilTrend` (last 6 monthly values + live current) → Sparkline in the credit container.

### #4 Health-banner credit notice
- **`DashboardCharts.tsx`** `HealthBanner`: new `creditAlerts` prop → an amber "{n} card(s) over 30%" pill beside the existing budget pill. Dashboard passes `creditReport.cardsOverTarget`.

### Dashboard redesign (cleaner, summary-first)
- Removed the **Month Income** and **Month Spending** KPI tiles (their numbers live in the calendar's month summary). KPI bento is now Net Worth hero (col-span-2, no more row-span-2) + Safe-to-Spend + Savings Rate.
- Moved the **calendar (big-picture "This Month")** up directly under the KPI bento, paired with the spending pie ("when" + "what"). Removed the old lower pie+calendar row.
- Replaced the small credit card with a **big-but-brief Credit Utilization container**: left = overall % + bar with 30% marker + utilization trend sparkline + one actionable nudge; right = top-3 per-card mini bars + "+N more on Manage". Renders only when a card has a limit.
- Removed now-unused vars (incomeDelta/spendingDelta/income+spendingTrend/prevMonth income+spending/ArrowUpRight import).

### Celebrations
- (from prior commit) unchanged; still fires on crossing below 30%/10%.

### i18n
- `charts.creditUtil`/`charts.noCards`/`charts.creditOverPill`; `credit.payBeforeStmt`/`trendLabel`/`viewMoreCards`/`statementDay`/`statementDayHint`/`statementCloses`/`statementToday`/`statementSetPrompt` (en + vi).

### Tests
- `calcCreditUtilizationScore`, `composeHealthScore` (caps at 100, breakdown sums to score, weights sum to 100, null→12), `daysUntilStatement` (this-month / today / roll-over / short-month clamp); updated `parseNetWorthRows` tests for the creditUtil column. Suite **391 passing**.

**Verification:** `npm run typecheck` clean; `npm test` 391/391; `npm run lint` 0 errors (27 pre-existing warnings); `npm run build` succeeds (29 routes). Visual check not run in-env (needs a Google session).

## 2026-06-08 — Surface credit utilization on the dashboard + celebrate paydowns (branch claude/relaxed-albattani-ffio8g)

Follow-up to the Smart Credit Report below. Brought the credit signal onto the main dashboard and added a delightful milestone, both reusing the existing pure helpers (no new calc logic).

- **`app/(app)/dashboard/page.tsx`** (Server Component):
  - Computes `creditReport = buildCreditReport(accounts)` and the single `worstCard` (highest-utilization card still over the 30% target, for an actionable nudge).
  - New **Credit Utilization card**, rendered only when `hasLimits` (no clutter for users without credit cards or limits). Placed right after the Assets/Liabilities/Savings/Emergency stat row. Shows the overall utilization %, a status chip, a bar with the dashed **30% target marker**, total balance/limit + available credit, a **Manage → /credit** link, and — when over target — *"Pay {amount} on {card} to get under 30%"*. Card tone flips rose↔emerald on whether you're over the cap. Module-scope literal-class maps `CREDIT_STATUS_BAR`/`CREDIT_STATUS_TEXT` (Tailwind v4). Added `CreditCard`/`Target` icons and `buildCreditReport`/`CREDIT_UTIL_TARGET` imports.
  - Passes `creditUtil={creditReport.overallUtil}` to `<Celebrations>`.
- **`app/(app)/dashboard/Celebrations.tsx`**: new `creditUtil: number | null` prop. `Stored` gains optional `creditUnderTarget`/`creditUnderIdeal`. Fires confetti + toast the first time overall utilization crosses below 30% (`celebrate.creditTarget`) or below 10% (`celebrate.creditIdeal`, supersedes the 30% message). Guarded so the first time credit becomes trackable (prev field `undefined`) baselines silently — no spurious pop for already-low or upgrading users. Added `creditUtil` to the effect deps.
- **i18n** (`en.json`/`vi.json`): `dashboard.creditUtil`, `credit.payToTargetCard` ("Pay {amount} on {card} to get under {pct}%"), and `celebrate.creditTarget`/`celebrate.creditIdeal`. The dashboard card otherwise reuses existing `credit.*` / `common.manage` keys via the server `t()`.

**Verification:** `npm run typecheck` clean; `npm test` 379/379; `npm run lint` 0 errors (27 pre-existing warnings); `npm run build` succeeds (29 routes). Visual check not run in-env (dashboard needs a Google session).

## 2026-06-08 — Smart Credit Report: credit-card utilization tracking + score guidance (branch claude/relaxed-albattani-ffio8g)

New feature. Credit cards now carry a **credit limit**, and a dedicated **Smart Credit Report** page tracks utilization (balance ÷ limit), guides the user toward the score-friendly targets (under 30%, ideally under 10%), and surfaces a **nav badge notice** when any card goes over the recommended cap. Built pure-function-first (tested) to match the codebase's conventions.

### Data model + storage
- **`types/index.ts`**: `Account` gains optional `creditLimit?: number` (credit cards only; absent/0 = not set, so utilization shows "unknown" rather than a fake 0%).
- **`lib/sheets.ts`**: persists `creditLimit` in **Accounts column J**.
  - Widened every Accounts read range `A2:I200` → `A2:J200` (`getAccounts`, `DASHBOARD_CORE_RANGES`, `BATCHABLE_SHEETS.accounts`, and the new badges range).
  - `rowToAccount` reads `r[9]` (empty/blank → undefined, not 0). Same parse added to the inline `parseDashboardCore` accounts mapper.
  - `upsertAccount` appends `account.creditLimit ?? ''` (10-column row) and bumped its `deleteRowById` last-col arg `'I'` → `'J'` (cosmetic; `deleteRowById` deletes the whole row regardless).
  - `batchGetBadgesData` now also fetches `Accounts!A2:J200` and returns `accounts` (for the credit-alert badge).

### Pure helpers + tests (`lib/calculations.ts`)
- `CREDIT_UTIL_TARGET = 30`, `CREDIT_UTIL_IDEAL = 10`.
- `creditUtilization(balance, limit)` → percent, or `null` when limit ≤ 0 (never invents a denominator); a negative/credit balance counts as 0% used; can exceed 100%.
- `creditUtilStatus(util)` → `'excellent'|'good'|'fair'|'high'|'maxed'|'over'` bands (≤10 / ≤30 / ≤50 / <90 / <100 / >100).
- `isOverCreditTarget(util)` (the >30% "notice" trigger), `availableCredit(balance, limit)`, `calcPaydownToTarget(balance, limit, targetPct)`.
- `buildCreditReport(accounts)` → per-card `CreditCardReport[]` + aggregate (`totalBalance/Limit/Available`, `overallUtil`/`overallStatus`, `cardsOverTarget`, `hasLimits`). Aggregate only counts cards with a KNOWN limit so an un-set card can't distort the denominator.
- `calcCreditAlerts(accounts)` = `buildCreditReport(...).cardsOverTarget` (thin badge wrapper).
- **`lib/__tests__/calculations.test.ts`**: +28 tests across all the above (boundaries, null-limit, over-limit, aggregate exclusion, alert counts). Suite now 379 passing.

### Badge ("notice when over")
- **`app/api/badges/route.ts`**: computes `creditAlerts` from accounts; response shape now `{ overdueBills, overBudget, creditAlerts }` (incl. the unauth/catch fallbacks).
- **`components/Sidebar.tsx`**: `BadgeCounts` gains `creditAlerts`; bumped the client cache key `nf_badges_cache` → `nf_badges_cache_v2` so older cached payloads don't suppress the new badge. Added a **Credit** nav item (CreditCard icon) to the desktop "Money" group and to `ALL_MOBILE_NAV` + `NAV_GROUP_OF`, both with `badgeKey: 'creditAlerts'` (amber tone via the existing non-overdue branch).

### Smart Credit Report page (`app/(app)/credit/page.tsx`, new + `loading.tsx`)
Client page (loads `/api/accounts`, builds the report client-side via `buildCreditReport`, `useAutoRefresh`):
- **Overall hero card**: big aggregate utilization %, status label, a utilization bar with a dashed **30% target marker**, and Balance / Limit / Available stats. Shows a "set your limits" prompt when no card has a limit.
- **Alert banner**: rose warning listing how many cards are above 30% (the notice), or an emerald all-clear when every card is under target.
- **Per-card rows**: util % + status chip, bar with target marker, available-to-spend, and **actionable paydown guidance** ("Pay $X to get under 30%", plus the path to the ideal 10%). Cards without a limit get an inline limit input; cards with one get inline edit — both POST the full account to `/api/accounts` (the route preserves `openingBalance`), optimistic with reconcile-on-failure.
- **"How to grow your credit score"** education card: 6 utilization-/history-focused tips.

### Accounts page integration (`app/(app)/accounts/page.tsx`)
- Add/Edit form shows a **"Credit limit ($)"** input only when type is `credit`; `handleSave` stores `creditLimit` (cleared when the type isn't credit). `EMPTY_FORM`/`openEdit` carry the field.
- Each credit-card row shows an inline utilization readout (color-coded by status) linking to `/credit`, or a "Set a limit to track utilization" link when unset.

### i18n
- **`locales/en.json` / `vi.json`**: added `nav.credit`; a full `credit.*` namespace (titles, overall card, statuses, alerts, paydown lines, 6 tips); and `accounts.creditLimit` / `accounts.utilization` / `accounts.setLimitHint`.

**Verification:** `npm run typecheck` clean; `npm test` 379/379 (+28); `npm run lint` 0 errors (only pre-existing `set-state-in-effect` warnings — the credit page's `load` effect is the same accepted pattern used by every data page); `npm run build` succeeds (29 routes incl. `/credit`). Visual check not run in-env (pages need a Google session).

## 2026-06-07 — Revert Safe-to-Spend to income basis; keep cash-basis "spent" (branch claude/safe-to-spend-calc-aZapf)

Follow-up to the checking-balance change below. User reconsidered and wants Safe-to-Spend driven by **income and upcoming bills, minus money already spent** — i.e. the ORIGINAL `income − spending − bills` formula — using **logged income this month** (accepting the early-month/pre-payday behavior), and **leaving budgets out** for now.

This fully reverts the prior commit's code: `lib/calculations.ts`, `app/(app)/dashboard/page.tsx`, and `lib/__tests__/calculations.test.ts` were restored to their pre-change state via `git checkout HEAD~1 -- …`. Net effect on code = none versus before this branch.

Final state (unchanged original design):
- `calcSafeToSpend(income, spending, bills) = roundCents(income − spending − bills)`, can go negative (surfaces the shortfall, no floor at 0).
- Dashboard: `spending` = `calcMonthCashSpending(transactions, accounts, thisMonth)` (cash-basis "money already spent": expenses from deposit accounts + payments toward debt; card charges excluded so a charge + its payoff aren't double-counted). `leftToSpend = calcSafeToSpend(monthIncome, monthCashSpending, upcomingBillsTotal)`, spread over `daysRemaining = daysLeft + 1` via `calcSafeToSpendDaily`.
- `calcCheckingBalance` (added below) is removed again; no longer referenced.

Known limitation the user accepted: because `monthIncome` is logged income only, the KPI can read a large negative ("overspent") early in the month before payday is recorded, and savings sweeps don't reduce it. Budget integration deferred.

**Verification:** `tsc --noEmit` clean; calc suite 234/234 pass.

## 2026-06-07 — Fix Safe-to-Spend basis: checking cash on hand, not month income flow (branch claude/safe-to-spend-calc-aZapf)

User asked to verify the Safe-to-Spend calculation ("I think we have something wrong"). The three pure functions were arithmetically correct and well-tested, but the **inputs** fed in at `app/(app)/dashboard/page.tsx` were on the wrong basis.

**Root cause:** `leftToSpend = monthIncome − monthCashSpending − upcomingBillsTotal` computes this month's *net cash flow*, not money actually available. It implicitly assumes you start each month with a $0 balance, so the error equals your real start-of-month checking balance. Concretely: before payday is logged, `monthIncome` is ~0 while bills are still due, so the KPI showed a large false "overspent" deficit even when the account was flush. Mirror bug: money already swept to savings still counted as spendable (a deposit→deposit transfer isn't subtracted by `calcMonthCashSpending`).

**Decision (user choice):** drive Safe-to-Spend from **checking-only balance − bills still due**. Savings is treated as set aside (not spendable).

Changes:
- `lib/calculations.ts` — new pure fn `calcCheckingBalance(accounts)`: sums `type === 'checking'` balances only (savings/credit/loan/investment excluded). Refactored `calcSafeToSpend` from `(income, spending, bills)` to `(availableCash, billsDue) => roundCents(availableCash − billsDue)`; rewrote its comment to explain the cash-on-hand basis and why the old income-flow basis showed a false early-month deficit. Still surfaces a negative shortfall (no floor at 0). `calcSafeToSpendDaily` unchanged.
- `app/(app)/dashboard/page.tsx` — import `calcCheckingBalance`, drop unused `calcMonthCashSpending` import. Compute `checkingBalance = calcCheckingBalance(accounts)` and `leftToSpend = calcSafeToSpend(checkingBalance, upcomingBillsTotal)`. Removed the `monthCashSpending` line. `daysRemaining`/`dailySafeToSpend`/`overspent` and the KPI card (lines ~344-360) consume the same vars, so no display plumbing changed. `overspent` now means "checking cash < bills still due."
- `lib/__tests__/calculations.test.ts` — new `calcCheckingBalance` suite (checking-only from MIXED_ACCOUNTS = 5000; multi-checking sum; zero when none). Rewrote the `calcSafeToSpend` suite to the 2-arg signature (cash − bills; negative shortfall; no-bills; cent rounding). Added `calcCheckingBalance` to imports.

Note: `calcMonthCashSpending` is now unused by the app but kept (with its 6-case test suite) as a valid cash-basis utility for possible future use.

**Verification:** `tsc --noEmit` clean; full suite 343/343 pass; eslint clean on the two touched source files.

## 2026-06-06 — Premium animation Phase 4: gamified micro-interactions (branch claude/premium-animation-design-JCTbK)

Final phase: juicy, tactile feedback on the key financial moments. Three pieces,
all reduced-motion-aware.

**1. Financial Health ring count-up + 'A' glow**
- **`app/(app)/dashboard/DashboardCharts.tsx`**: extracted the static conic-gradient
  gauge into a new `HealthRing` client sub-component. On mount it sweeps the arc
  from 0 → score (`animate(0, score, { duration: 1.4, ease: 'easeOut' })`) and
  counts the number up in lockstep, driven imperatively via refs (style.background
  + textContent) so the per-frame updates don't re-render. An 'A' grade gets a soft
  emerald `drop-shadow` glow. Reduced-motion paints the final state instantly.
  Added `animate` + `useRef` to the existing imports.

**2. Urgent-bill ambient pulse glow**
- **`app/globals.css`**: new `.pulse-glow` utility + `@keyframes pulse-glow` — a
  soft rose halo (`box-shadow`) that breathes ~2.4s; added to the reduced-motion
  media block (animation: none).
- **`app/(app)/bills/page.tsx`** (active bill row, `isUrgent` icon tile) and
  **`app/(app)/dashboard/page.tsx`** (bill-forecast `isUrgent` icon circle): append
  `pulse-glow` to the existing urgent (≤3 days) styling.

**3. Quick-Add receipt slide-in**
- **`app/(app)/dashboard/RecentTransactions.tsx` (new, `'use client'`)**: the
  dashboard "Recent" ledger, extracted from the server page. Tracks shown ids in
  `seen` state (lazy-seeded with the initial rows so they don't animate on load).
  After a Quick Add → `router.refresh()`, the new row is absent from `seen`, so it
  slides in from the top (`initial y:-18, scale:.96` → spring `stiffness 380,
  damping 30`) while `layout` springs the older rows down; `AnimatePresence`
  fades out rows that fall off the list. Honors reduced-motion.
- **`app/(app)/dashboard/page.tsx`**: replaced the inline recent-tx list with
  `<RecentTransactions items={…} emptyTitle/emptySub={t(…)} />`; swapped the now-unused
  `CategoryIconBadge` import for `RecentTransactions` (badge now lives in the new
  component).

**i18n:** none new (empty-state strings still translated server-side and passed in).

**Verification:** `npm run typecheck` clean; `npm run lint` 0 errors (29 warnings = 28
pre-existing + 1 same-class setState-in-effect in RecentTransactions); `npm test`
341/341; `npm run build` succeeds. Visual check not run in-env (no Google session).
Completes the 4-phase premium-animation pass.

## 2026-06-06 — Premium animation Phase 3: tuned Recharts glide (branch claude/premium-animation-design-JCTbK)

Phase 3: fluid data morphing. Recharts has no Framer-style spring physics (its
engine only supports ease/linear), so — per the agreed approach — charts use a
tuned native ease-out glide that also re-runs on dataset changes (year selector /
filters interpolate bar heights instead of snapping). All animation is gated on
`useReducedMotion()`.

**Changes:**
- **`app/(app)/dashboard/DashboardCharts.tsx`**: added a `useChartAnim(duration)`
  helper (next to `useChartReady`) returning
  `{ isAnimationActive: !reduce, animationDuration: reduce ? 0 : duration, animationEasing: 'ease-out' }`.
  Spread onto the `SpendingPieChart` `<Pie>` (700ms), `MonthlyBarChart` bars + net
  line (800ms; expenses bar gets `animationBegin={120}` for a subtle stagger), and
  `NetWorthTrendChart` `<Area>` + projection `<Line>` (900ms). Extended the
  framer-motion import with `useReducedMotion`.
- **`app/(app)/reports/MonthlyComparisonChart.tsx`**: same inline anim object
  (800ms, reduced-motion-aware) spread onto both bars; expenses staggered via
  `animationBegin={120}`. So switching the year selector glides the bars to the new
  dataset. Added `useReducedMotion` import.

**i18n:** none new.

**Verification:** `npm run typecheck` clean; `npm run lint` 0 errors (28 pre-existing
warnings, unchanged); `npm test` 341/341; `npm run build` succeeds. Visual check not
run in-env (no Google session). Phase 4 (gamified micro-interactions) deferred.

## 2026-06-06 — Premium animation Phase 2: gliding sidebar pill + odometer net worth (branch claude/premium-animation-design-JCTbK)

Phase 2 of the premium-animation pass: physical-weight layout morphs. Per the
product decision, the Net Worth card stays settings-driven (no new Full↔Liquid
toggle) — instead its hero number gets a slot-machine digit roll on load.

**Changes:**
- **`components/ui/RollingNumber.tsx` (new, `'use client'`)**: odometer-style
  currency display. Each digit is a vertical 0–9 reel masked to one glyph and
  sprung to its target (`stiffness 190, damping 24`), with a left→right stagger
  (`delay = digitIndex * 0.05`, capped 0.5s) so the number cascades into place.
  Non-digit chars (`$ , . -`) render statically at the same `1em` height. Reuses
  AnimatedNumber's container contract — `block`, `whitespace-nowrap`, shrink-to-fit
  via a `ResizeObserver` font-size loop (tabular figures keep width stable while
  rolling). Honors `useReducedMotion()` (renders the final string) and exposes the
  value to AT via an `sr-only` span (reels are `aria-hidden`).
- **`app/(app)/dashboard/page.tsx`**: hero Net Worth number swapped from
  `AnimatedNumber` → `RollingNumber` (same `maxSize/minSize/className`). All other
  KPIs keep `AnimatedNumber`.
- **`components/Sidebar.tsx`** (desktop `Sidebar`): added a gliding hover pill.
  New `hovered` state (set on `onMouseEnter`, cleared on the nav's `onMouseLeave`)
  drives a `motion.div layoutId="sidebar-hover"` (`bg-slate-100 dark:bg-slate-800/70`)
  that floats between non-active items (spring `bounce 0.2, duration 0.4`), sitting
  under the existing `sidebar-active` indigo pill. Replaced the static
  `hover:bg-slate-50 dark:hover:bg-slate-800` classes (kept the text-color hover).

**i18n:** none new.

**Verification:** `npm run typecheck` clean; `npm run lint` 0 errors (28 pre-existing
warnings, unchanged); `npm test` 341/341; `npm run build` succeeds (all routes).
Visual check not run in-env (no Google session). Phases 3–4 deferred.

## 2026-06-06 — Premium animation Phase 1: ambient shimmer + fluid entrance (branch claude/premium-animation-design-JCTbK)

First phase of a multi-phase premium-animation pass. Goal: mask Google Sheets API
latency so the app feels fast — replace the flat gray skeleton pulse with an
ambient sweeping shimmer, and make resolved content glide in instead of snapping.

**Note on scope:** the brief floated morphing skeleton shapes into real cards via
Framer `layoutId`. That can't cross Next.js's `loading.tsx` Suspense boundary (the
skeleton fallback unmounts as the real segment mounts, so the two never coexist for
a shared-element transition). Achieved the same *perceived* effect with a shimmer +
a staggered entrance reveal instead.

**Changes:**
- **`app/globals.css`** (`@layer utilities`): added a `.shimmer` utility (light +
  `.dark` tints matching the old `bg-slate-100 dark:bg-slate-700/50`) with a
  `@keyframes shimmer-sweep` that slides an oversized (`background-size: 200%`)
  translucent gradient highlight left→right (~1.8s, compositor-only via
  `background-position`). Gated behind `@media (prefers-reduced-motion: reduce)` →
  static tint, no sweep.
- **`components/ui/Skeleton.tsx`**: base `Skeleton` primitive now renders
  `shimmer rounded-2xl` instead of `animate-pulse bg-*`. All 9 layout-exact
  skeleton compositions (`DashboardSkeleton`, `AccountsSkeleton`, …) upgrade
  automatically — no other edits.
- **`components/ui/Reveal.tsx` (new, `'use client'`)**: `StaggerReveal` wraps a
  column of sections, cloning each direct child into a `motion.div` item that
  fades + rises (`opacity 0→1`, `y 12→0`, 0.4s `easeOut`) with parent
  `staggerChildren: 0.06`. Honors `useReducedMotion()` → renders children untouched
  (instant, no transform), matching the AnimatedNumber/Collapsible convention.
- **`app/(app)/dashboard/page.tsx`**: moved `space-y-5 sm:space-y-7` onto a
  `<StaggerReveal>` wrapping the stacked sections (Header → bills/recent rows);
  `<Celebrations>` watcher and the fixed mobile FAB stay outside it.

**i18n:** none new.

**Verification:** `npm ci` (deps were absent); `npm run typecheck` clean;
`npm run lint` 0 errors (28 pre-existing warnings only, none in changed files);
`npm test` 341/341 pass. Visual check not run in-env (dashboard returns null
without a Google session). Phases 2–4 (sidebar/number morphs, Recharts easing,
gamified micro-interactions) deferred per phase-by-phase delivery.

## 2026-06-06 — Redesign Nova: organic furry forest mascot (branch claude/novaifi-mascot-asset-RURcb)

Replaced the dashboard health-banner mascot's glossy "squishy blob" with a premium, fully organic furry creature, per request. No armor/metal/cyber themes (none existed; the new design is entirely botanical). Kept the component a lightweight pure-SVG + framer-motion asset (no raster, no new deps) and — critically — kept the exact `NovaAvatar({ status, size })` contract and all `status`-driven cues so the avatar stays in lock-step with `HealthBanner` and the rest of the dashboard. No chart/data/status-computation logic touched; `lib/colors.ts` untouched.

- **`app/(app)/dashboard/NovaAvatar.tsx`** (full rewrite): new creature anatomy, all inline SVG paths/gradients:
  - Soft fur body (warm cream→tan radial gradient `nova-body-${status}`), lighter belly patch, furry crown tufts, two rounded furry ears, status-tinted dapple markings + a forehead sprout-heart.
  - Multi-layered eyes: sclera → warm honey iris (`nova-iris-${status}`) → status-tinted iris ring → dark pupil → two-layer catchlights; delicate heart-nose + soft mouth.
  - Small paws cradling a carved **wooden seed-pod** (`nova-pod-${status}`) with a stylized **"N" worked into the grain** (`POD_GRAIN_N` strokes over faint horizontal `POD_GRAIN_H` arcs).
  - **Tail** = cluster of leaves (`LEAVES`, each almond + centre vein) and rounded buds with pink tips, sprouting from behind.
  - **Glow**: two blurred radial layers — warm nature-green base (`#a6d49a`) + a `STATUS_COLOR[status]`-tinted layer — so the warm glow still tracks health (user-confirmed).
- Data-driven moods via the kept `MOODS: Record<HealthStatus, Mood>` map. Per status: ear splay (`earTilt` 0→28°), mouth, brows, `pupilDy` (worried up-glance), tail `leafLift` (+10° thriving → −8° sagging), `blush`, `sweat`, `sparkle`. great = perky ears/open smile/blush/lifted leaves/sparkle; good = gentle smile/blush; neutral = soft flat; warning = lowered ears/worried mouth/sweat/sagging; danger = droopy ears/frown/furrowed brows/sweat.
- Animations, all `useReducedMotion`-gated (degrade to a calm static creature). Deliberately **de-synced for natural motion** — nothing moves in lock-step:
  - "Breathing": container float (period `breath`, status-keyed — livelier thriving, slow/heavy in danger) + body scale on `breath` **plus a slow body sway** (`rotate` on `breath*1.7`); the two glow layers shimmer on `breath` vs `breath*1.25`.
  - Eye-group **blink** retuned to a real cadence — quick close / softer open (`times [0,.92,.945,.99,1]`, ~5.2s).
  - **Per-leaf** sway: each `LEAVES` entry has its own `dur`/`amp`; `Leaf` rotates about its stem on that duration with an offset vertical `y` bob (`dur*1.35`), so the tail never moves in unison.
  - **Ear idle wiggle**: `Ear` is now a `motion.g` oscillating ±1.6° around its `earTilt` base (offset L/R) for subtle life.
  - Conditional sparkle (great) / sweat drip (warning·danger).
- **Welcome-back wave** (new): on mount and on `document` `visibilitychange`→visible, Nova lifts its right paw off the pod and waves. Driven by `useAnimationControls` (`wave`): lift-in → `rotate` oscillation (`WAVE_ARM` shoulder pivot 43,46) → lower-out; a `waving` state cross-fades the resting `PAW_R` out during the wave. Throttled to ≤1×/20s via a `lastGreet` ref; skipped entirely under reduced-motion. Client-only (`'use client'`, guarded effect).
- Sub-components `Ear` and `Leaf`. Added `SIDE_FUR` (wispy fur flicks on the lower silhouette) on top of `CROWN_FUR` for a softer, furrier edge. Unique `<defs>` ids per status to avoid cross-instance bleed. `role="img"` + `aria-label` preserved.
- **`DashboardCharts.tsx`** usage unchanged (`<NovaAvatar status={status} size={56} />`).

Frame review: generated a static preview SVG (all 5 states + a wave-pose panel) and shared it before committing; iterated on user feedback ("more natural" + "wave when they open back the website").

**Verification:** `npm run typecheck` clean; `npm run lint` 0 errors/0 warnings on the file; `npm run build` succeeds (all routes).

## 2026-06-05 — Fix sparkline gap: drop stroke-dash draw-in (branch claude/blank-space-lines-3FFJs)

The KPI sparkline (e.g. the Liquid Net Worth hero tile) showed a blank gap in the middle of the line. Root cause: the `.spark-line` CSS draw-in animated `stroke-dashoffset` with `stroke-dasharray: 1`, relying on `pathLength={1}` to normalize the single dash to the full line. But the SVG renders with `preserveAspectRatio="none"` (stretched ~11× horizontally) and `vectorEffect="non-scaling-stroke"`, which makes the browser measure the dash in post-transform screen space — ignoring the `pathLength` normalization. The single dash no longer covered the stretched line, leaving it partially unpainted. (The shaded area fill has no stroke/dash, so it stayed continuous — which is why only the line showed the gap.)

- **`components/ui/Sparkline.tsx`**: removed `className="spark-line"` and `pathLength={1}` from the line `<path>` so it always paints in full on render. Kept `vectorEffect="non-scaling-stroke"` (constant stroke width under the non-uniform stretch). Updated the header comment.
- **`app/globals.css`**: removed the now-unused `@keyframes spark-draw`, the `.spark-line` rule, and its `prefers-reduced-motion` override.

## 2026-06-05 — Expressive Nova mascot + section-wide header identity (branch claude/novaFi-banner-ui-design-W3TMR)

Two-part UI enhancement. (1) Redesigned the dashboard's Nova health-banner mascot from a simple color-changing face into a fully expressive, data-driven blob creature. (2) Brought the dashboard's premium header language to the remaining sections via a shared `PageHeader` primitive (icon emblem + `font-display` title). Verified: `npm run typecheck` clean, `npm run lint` 0 errors (pre-existing setState-in-effect warnings only, none in changed files), `npm run build` succeeds (all routes).

### Nova mascot redesign
- **`app/(app)/dashboard/NovaAvatar.tsx`** (full rewrite): every expression now reads off `HealthStatus` through a `MOODS` map. New behaviours, all reduced-motion-gated:
  - **Squishy blob body** (`BLOB` squircle path) replacing the plain circle, with a glossy top highlight and a radial body gradient.
  - **Blinking eyes** — eyes wrapped in a `motion.g` that periodically squashes `scaleY` (single keyframe via `times`, no JS state), plus catchlights and happy-pupil offset.
  - **Eyebrows** that arch up (great/good), angle outward (warning) or furrow into an angry V (danger), and **rosy cheeks** when happy (radial-gradient blush).
  - **Little arms** (`Arm` sub-component) that wave when thriving, rest at the sides, or droop when stressed; **bead of sweat** on warning/danger.
  - **Floating coins** (1–2, with `$` glyph) tossed around a prospering Nova; **sparkle crown** when great.
  - **Pulsing status aura** + breathing speed that varies by mood (livelier when great, slow/heavy when danger).
- **`app/(app)/dashboard/DashboardCharts.tsx`**: bumped the banner's `NovaAvatar` from `size={48}` → `size={56}` to give the richer character more presence. Banner layout otherwise unchanged.

### Section header consistency (`PageHeader`)
- **`components/ui/PageHeader.tsx` (new)**: shared section-page header — a tinted, rounded icon emblem (own `TONE_TILE` map mirroring `Card`'s tones) beside a `font-display` h1 + subtitle, with an optional right-aligned `action` slot (`flex … w-full md:w-auto`). Standardizes title sizing (`text-2xl md:text-4xl`) and adds the missing `font-display` that the dashboard header already had.
- Applied `PageHeader` to every remaining section, each with its own icon + accent `tone`, preserving existing action buttons/controls:
  - `accounts` → `Landmark` / indigo; `savings` → `PiggyBank` / purple (action only when accounts exist); `paychecks` → `DollarSign` / emerald; `bills` → `Calendar` / amber; `transactions` → `ArrowLeftRight` / indigo (toolbar buttons kept in a `flex-wrap` action); `reports` → `BarChart3` / indigo (year selector + refresh in action); `planning` → `Target` / purple (`mb-4 md:mb-6`, no action); `settings` → `SlidersHorizontal` / default (`mb-6`, reset/save in action).
  - Removed the per-page hand-rolled header `<div>`s and their inconsistent `text-3xl`/`text-base`/no-`font-display` styling. All icons used were already imported in each page.

## 2026-06-05 — Modern dashboard UI pass: playful + data-dense (bento, Nova mascot, heatmap, count-up, sparklines, celebrations, haptics)

A design-language upgrade of the dashboard toward a "playful & friendly + rich & data-dense" direction, building reusable primitives first so the same patterns aren't re-hand-rolled. Mobile-first throughout. Verified: `npm run typecheck` clean, `npm run lint` 0 errors (28 pre-existing warnings only, none in new files), `npm run build` succeeds (28 routes), `npm test` 341/341 pass.

### Foundation (design language)
- **`app/layout.tsx`**: added `Plus_Jakarta_Sans` via `next/font/google` as a display face exposed through the `--font-display` CSS variable (variable applied on `<body>`). Inter stays the default body font.
- **`app/globals.css`**:
  - Global `font-variant-numeric: tabular-nums` + `font-feature-settings: 'tnum'` on `body` — money columns/KPIs now line up (digit glyphs only; prose unaffected).
  - Semantic finance tokens in `@theme`: `--color-success/danger/warning/savings` (mirror the emerald/rose/amber/violet language).
  - New utilities: `.font-display` (opt-in display face + tight tracking), `.bento-hero` (soft mesh radial-gradient backdrop, light + dark), `.spark-line` (CSS `stroke-dashoffset` draw-in keyframe, reduced-motion aware).
- **`lib/colors.ts` (new)**: single JS source of palette for canvas/SVG that can't read CSS vars — `SEMANTIC`, `STATUS_COLOR` (+ `HealthStatus` type), `HEATMAP_SCALE`/`HEATMAP_SCALE_DARK`, `CONFETTI_COLORS`.

### Reusable primitives (new)
- **`components/ui/Card.tsx`**: added a `tone` prop (`default|emerald|rose|amber|purple|indigo`) driving accent border classes, and a **`CardIcon`** helper for the tinted rounded icon-tile pattern (lucide child inherits `currentColor`, so one `tone` styles tile + glyph). Full literal class strings per tone (Tailwind v4 needs literals).
- **`components/ui/AnimatedNumber.tsx`**: count-up number that also auto-fits font size like FitText. Writes the running value via `textContent` (no per-frame React re-render) and fits against the final/widest string once. Serializable props only (`kind: 'currency'|'percent'|'plain'`, `prefix`/`suffix`/`decimals`) so it can be used from the Server Component dashboard — **no function props across the RSC boundary**. Respects `prefers-reduced-motion`.
- **`components/ui/Sparkline.tsx`**: pure-SVG inline trend line (no recharts, no client JS → renders straight from the Server Component). Area fill + CSS draw-in via `.spark-line`/`pathLength=1`.
- **`lib/haptics.ts` (new)**: `haptic()` + `Haptics.{light,medium,success,warning}` over the Vibration API (no-ops where unsupported). Wired into `SwipeToDelete` (light tick on reveal, medium on delete confirm), `QuickAddTransaction` (success buzz on save, light on FAB tap).
- **`lib/confetti.ts` (new)**: dependency-free canvas confetti burst, self-removing after ~1.4s, no-op under reduced motion / SSR. Palette from `lib/colors`.

### Dashboard features
- **`app/(app)/dashboard/NovaAvatar.tsx` (new)**: animated SVG "Nova" mascot whose color + mouth expression track `HealthStatus` (great/good/warning/danger/neutral), gentle breathing/float (reduced-motion aware), sparkle when thriving. Replaces the static icon tile in `HealthBanner` (`DashboardCharts.tsx`; removed the now-unused `Icon` destructure).
- **`app/(app)/dashboard/SpendingHeatmap.tsx` (new)**: GitHub-style month grid, daily-spend intensity (sqrt-scaled, sky-blue ramp), localized weekday headers, today ring, future days faint/dashed, tap-to-select day detail + month total + no-spend-day count + Less→More legend. Light haptic on tap.
- **`app/(app)/dashboard/Celebrations.tsx` (new)**: renders null; fires confetti + success haptic + toast the first time a milestone is newly crossed (savings rate ≥20%, health grade improved, a goal newly achieved). Uses `localStorage` (`nf_milestones_v1`) with a silent first-load baseline so a returning user's existing wins don't all pop.
- **`app/(app)/dashboard/page.tsx`** (Server Component) rework:
  - **Bento KPI grid**: Net Worth is a hero tile (full-width mobile, `lg:row-span-2` desktop, `.bento-hero` gradient) with count-up + a large sparkline + delta chip; the other four KPIs (income/spending/safe-to-spend/savings-rate) are 2-up tiles using `CardIcon` + `tone`. Income & spending get small sparklines; savings rate keeps the radial gauge.
  - Assets/Liabilities/Savings tiles converted to `AnimatedNumber` count-up (liabilities passes `-totalDebt`).
  - Spending pie converted from a full-width card into a **2-up "what vs when" row** with the new `SpendingHeatmap`.
  - Server-side additions: 6-month income/spending/net-worth trend arrays; per-day spend map → `heatmapDays` + `todayIso` (local, not UTC); no-spend streak (consecutive zero-expense days up to today, capped 45, 0 when the user has no expenses); `achievedGoals`. No-spend streak ≥2 shows a 🔥 chip by the greeting; greeting + hero/headline numbers use `.font-display`.
- **i18n** (`locales/en.json`, `locales/vi.json`): added `dashboard.{noSpendStreak,spendingCalendar,spendingCalendarSub}`, new `heatmap.{noSpend,noSpendDays,less,more}`, new `celebrate.{savingsRate,health,goal}`.

## 2026-06-05 — Performance & reusability pass: collapse Sheets round-trips, faster writes, lazy charts (branch claude/musing-curran-c60675)

Latency in NovaFi is dominated by Google Sheets round-trips (quota ~60 reads + 60 writes/min/user), payload size, and client-bundle weight — not CPU. This pass cut round-trips and trimmed the bundle, building shared helpers first so the same boilerplate isn't rewritten per route/page. All existing invariants preserved (writes never auto-retried, ledger-row-first ordering, balance math stays in the pure tested `lib/calculations.ts`). Verified: `npm run typecheck` clean, `npm run lint` 0 errors (pre-existing warnings only), `npm run build` succeeds, `npm test` 331/331 pass (+7 new).

### Part 0 — Reusable foundations (consumed by all later parts)
- **`lib/cache.ts`**: added `cachedOrFetch(key, ttl, fetcher)` (get-or-populate; replaces the 3× copy-pasted cache IIFE in the dashboard and the body of every cached GET route) and `invalidateMany(spreadsheetId, resources[])` + named groups `TX_CACHES`/`ACCOUNT_CACHES`/`BILL_CACHES`/`BUDGET_CACHES`/`GOAL_CACHES` (replace the scattered per-line `invalidateCache(...)` clusters). Only uniformly-invalidated groups are named; conditional/partial routes (loans, paychecks, budget reorder, splits) pass explicit arrays so semantics are unchanged.
- **`lib/apiRoute.ts` (new)**: `withSession(handler)` (auth + 401 guard, hands the handler `{accessToken, spreadsheetId, req}`) and `cachedGet({resource, ttl, fetch})` (composes withSession + cachedOrFetch with the per-user key `${resource}:${spreadsheetId}` — same key the mutating routes invalidate).
- **`lib/sheets.ts`**: extracted pure `parseSettingsRows(rows)` (+ `SETTINGS_RANGE`) out of `getSettings`, and `parseNetWorthRows(rows)` (+ `NET_WORTH_RANGE`) out of `getNetWorthHistory`, so the combined dashboard batch reuses them. Extracted `persistChangedAccounts(...)` (the identity-check "write only changed accounts" loop that was **duplicated** in the transactions + loans routes and inlined in paychecks DELETE) — now shared by transactions/loans/paychecks/splits.
- **`lib/client/api.ts` (new)**: `loadBatch(keys)` (one `/api/batch` round trip, typed) and `apiMutate(url, method, body)` (standard JSON mutation, throws `ApiError` w/ status+body). `import type`-only from server modules so the browser bundle stays clean.
- **Converted ~12 routes** to `cachedGet`/`withSession`/`invalidateMany`: accounts, bills, budgets, goals, contacts, settings, categories, paychecks, loans, splits, transactions, transactions/backfill-categories. Badges left hand-written (bespoke non-`{error}` 401 body). **Fixed a latent staleness bug**: settings `PUT` previously invalidated nothing → now invalidates `['settings','categories','dashboard']` (it carries dashboard-affecting toggles + the custom/hidden category lists); also cached the settings GET (was uncached).

### Part 1 — Batch the read paths
- Extended `/api/batch` + `batchGetSheets` with two new keys: `loans` (lazy-tab getter like contacts/splits) and `settings` (returns the `TaxSettings` object). Added to `BatchResult`, `BATCH_KEYS`, and the route TTL map.
- Migrated the 4 fan-out client pages from N parallel `fetch`es to ONE `loadBatch(...)`: **transactions** (5→1), **planning** (5→1), **paychecks** (3→1), **reports** (3→1). (bills + savings already used `/api/batch`.)
- **Dashboard: 3 Sheets round-trips → 1.** `batchGetDashboardData` now folds Settings + NetWorthHistory into a single `values.batchGet` (8 ranges) and returns `settings`+`netWorthHistory` too (parsed via the reused parsers). NetWorthHistory may be absent on legacy sheets (would 400 the batch), so there's a graceful fallback to the 7 always-present ranges + the auto-creating `getNetWorthHistory`. Dashboard page now uses one `cachedOrFetch(dashKey, 45_000, …)` instead of three cache IIFEs (`getNetWorthHistory`/`getSettings` no longer imported there).

### Part 4.1 — Tame polling
- `hooks/useAutoRefresh.ts` default interval **30s → 60s** (the on-visibility refetch already covers the common "back to tab" case). Halves steady-state background Sheets load on the 3 auto-refreshing pages (savings/transactions/accounts), which all use the default.

### Part 2 — Faster writes (kill the post-mutation full reload)
- Transactions `POST`/`PUT`/`DELETE` now return `{ ok, accounts: <recomputed> }` — the authoritative post-write balances the route already computes (no extra Sheets read).
- **transactions/page.tsx**: the page was already optimistic for the list; the redundant full `load()` after add/edit/delete/restore is replaced by `setAccounts(data.accounts)` from the response. Owner-sync edits (loan/split-managed rows) still `load()` (they touch loans/splits). Net: a plain add/edit/delete is now write + **0** extra reads (was write + a full 5-resource reload).
- **accounts/page.tsx** `handleSave`: dropped the redundant success-path `load()` (optimistic state already reflects every displayed field; only the invisible `openingBalance` is server-maintained). `handleDelete` was already fully optimistic.
- Other pages (savings/bills/planning/paychecks) keep `load()` after writes but it's now a **single batched call** (from Part 1), not 3–5.

### Part 3 — Trim the client bundle (measured with `route-bundle-stats.json`)
- Finding: **recharts (~420 KB chunk) was already route-isolated** by Turbopack to only `/dashboard` + `/reports`; the other 7 routes never load it. framer-motion is needed app-wide for drag gestures (Modal/SwipeToDelete) so it stays.
- New reusable **`lib/dynamicChart.tsx`** = `next/dynamic(loader, {ssr:false, loading: skeleton})` for charts.
- **Reports route: 1204 KB → 791 KB First Load JS (−413 KB).** Extracted the pure `SpendingPaceWidget` (no recharts) out of `DashboardCharts.tsx` into `app/(app)/dashboard/SpendingPaceWidget.tsx` (reports imported it, transitively pulling the recharts-heavy module); extracted the reports BarChart into `app/(app)/reports/MonthlyComparisonChart.tsx` loaded via `dynamicChart`. Reports no longer statically imports recharts. Dashboard keeps charts eager (it's a Server Component → can't `ssr:false`, and charts are its core content); only 3 of its exports use recharts.
- Locale lazy-loading was assessed and **deliberately not done**: a correct fix needs an SSR/hydration refactor (server must pass the active dict) with a caching tradeoff (dict moves from a cached JS chunk into the per-request HTML), for a modest ~28 KB universal gain — not worth the risk here. Noted as a possible follow-up.

### New tests
- `lib/__tests__/cache.test.ts`: `cachedOrFetch` (hit skips fetcher; miss fetches + caches under TTL) and `invalidateMany` (clears named resources for one spreadsheet, leaves others).
- `lib/__tests__/sheets-parse.test.ts` (new): `parseSettingsRows` (mapping + defaults) and `parseNetWorthRows`.

## 2026-06-04 — Home "Budget Progress" container: match the Planning page's last-month comparison (branch claude/progress-container-comparison-IAwHC)

**Bug reported (from a Home screenshot):** The Home **Budget Progress** container (the `BudgetBars` component) didn't show the last-month comparison the way the **Planning** page does. Its headline number and "vs last mo" figure ignored the rolled-over deficit, so they disagreed with the bar / "left" / "over" beneath them and with the Planning page. Visible symptoms with budget rollover on: a Transportation row read **`$0.00 / $150.00`** at the top yet showed a partly-filled bar, **`$87.13 left`**, and **`-$212.87 vs last mo`**; a Shopping row read **`$0.00`** in red yet **`$754.77 over`**.

**Root cause:** `BudgetBars` already computed `usage = b.spent + rolledOver` (and used it for the bar, `remaining`, and the `over` flag), but two spots still used the raw `b.spent`:
- The top-right headline rendered `formatCurrency(b.spent)` instead of `formatCurrency(usage)`, so when this month's actual spend was `$0` but a deficit had rolled over, it printed `$0.00` (even in red while saying "$X over").
- The month-over-month badge computed `diff = b.spent - b.prevMonthSpent` instead of `usage - b.prevMonthSpent`, so it differed from the Planning page, whose `BudgetItem` uses `momDiff = usage - prevSpent`.

**Fix (`app/(app)/dashboard/DashboardCharts.tsx`, `BudgetBars`):**
- Headline amount now renders `formatCurrency(usage)` (the effective usage incl. rolled-over deficit), matching the bar/`remaining`/`over` it sits above and the Planning page's headline.
- The "vs last mo" badge now computes `diff = usage - b.prevMonthSpent` (added a comment mirroring the Planning page's rationale), so the two pages report the same number.

No data-model, i18n, or prop changes — the dashboard already passes `prevMonthSpent` and `rolledOver` into `BudgetBars`. The category-% chip still uses raw `b.spent` (unchanged; matches Planning's `categoryPct`).

**Verification:** `npm ci` then `tsc --noEmit` clean; full vitest **324 passing**; `eslint` on the changed file — 0 errors (only pre-existing unused-import / setState-in-effect warnings remain).

## 2026-06-03 — Extend the loan-style record-payment UI to the Transactions "Split an Expense" tracker (branch claude/bills-payment-ui-consistency-Vi0D0)

**Request (follow-up):** After converting the Bills "Owed to You" tracker, the user asked to upgrade the **Transactions-page one-time "Split an Expense"** tracker the same way — partial, loan-style record-payment per person instead of the checkbox.

**No data-model change needed** — the `Split` type / sheet / splits API already gained `repaidAmount` + `repaymentTxIds` in the previous change; this reuses them.

**`app/(app)/transactions/page.tsx`:**
- Replaced `handleSplitToggle` with `openSplitPayback(split)` + `handleRecordSplitPayback(split)` (same logic as the Bills page: clamp to remaining, accumulate `repaidAmount`, settle when covered, bundle a `cashIn` `buildSplitTx` when an account is chosen, then `load()` to refresh ledger/balances). New `renderPendingSplitRow(split)` helper draws the loan-style row (remaining, progress bar + "{paid} of {total} paid", **Record payment** button, delete, inline amount/account form).
- Uses its **own** payback state (`splitPaybackFor` / `splitPaybackForm` / `recordingSplitPayback`) so it never collides with the existing loan payback state (`paybackFor` etc.) on the same page. Removed the now-unused `settlingSplitId`.
- Pending group-card totals now sum **remaining** (`splitRemaining`); settled-history checkmarks became static badges (un-settle removed — delete is the reversal path).
- **Managed-tx integrity:** added `repaymentTxIds` to `managedTxIds` (locks each payback leg from generic-ledger account/type edits, like loan repayments). `syncOwnerAmount` gained a split-repayment branch mirroring the loan-repayment one: editing a payback leg's amount adjusts the split's `repaidAmount` and re-derives `settled` (instead of falling through to the fronted/share sync). `handleDeleteSplit` now also reloads when `repaymentTxIds.length`.

**i18n:** none new — reuses the keys added in the Bills change (`bills.recordSplitPayment`, `bills.splitPaidOf`, `bills.toastSplitPartial`, `loans.*`). Both trackers (Bills + Split-an-Expense) are now consistent with Loans.

**Verification:** `tsc --noEmit` clean; `next build` compiles; `eslint` 0 errors (27 pre-existing warnings unchanged); full vitest **324 passing**.

## 2026-06-03 — Bills "owed to you" payback gets the loan-style record-payment UI with partial amounts (branch claude/bills-payment-ui-consistency-Vi0D0)

**Request:** Make the Bills "pay back" option consistent with Loan/Split — a "record payment" flow with an amount (and grouped when needed). Clarified with the user: scope is the **"Owed to You"** tracker on the Bills page (people repaying their share of a shared bill); paybacks should **allow partial amounts** (Loan-style, tracking a remaining balance and accumulating until settled); recorded **per person** for multi-person bills.

**Before:** A shared-bill receivable was settled with an all-or-nothing **checkbox toggle** ("mark transferred") — `handleSplitToggle` wrote one full cash-in `transfer` and flipped `settled`, with un-settle reversing it. No partial repayment was possible.

**Data model — `Split` now mirrors `Loan`'s partial-payback shape (`types/index.ts`):** added `repaidAmount: number` (cumulative paid back) and `repaymentTxIds: string[]` (one cash-in transfer id per payback). `settled` now means `repaidAmount >= amount`. Legacy `settleTxId` kept for older fully-settled rows (still reversed on delete); `frontedTxId` unchanged.

**Storage (`lib/sheets.ts`):** `SPLITS_HEADER` gains `repaid_amount` + `repayment_tx_ids` (cols N/O). `getSplits` reads `A2:O1000` and parses `repaidAmount` (`Number`) + `repaymentTxIds` (`'|'`-split, filtered). `upsertSplit`/`deleteSplit` widen the row-clear range from `'M'` → `'O'` and append the two new cells (`repaymentTxIds` joined by `'|'`). Old 13-column rows read back as `repaidAmount: 0`, `repaymentTxIds: []` — backward compatible.

**API (`app/api/splits/route.ts`):** `DELETE` now reverses + deletes `[frontedTxId, settleTxId, ...repaymentTxIds]` so removing a partially-repaid split restores every linked account exactly (same model as loans). `POST` was already capable of bundling `{ split, tx }`, so each payback reuses it.

**Helper (`lib/splits.ts`):** new exported `splitRemaining(s)` = `settled ? 0 : roundCents(amount − repaidAmount)`.

**Bills UI (`app/(app)/bills/page.tsx`):**
- Replaced `handleSplitToggle` with `openSplitPayback(split)` (toggles an inline form, pre-filling the amount with the remaining and the account with the fronted-from account) and `handleRecordSplitPayback(split)` — clamps the entered amount to the remaining, accumulates into `repaidAmount`, marks `settled` once it covers the share, and (when an account is chosen) bundles a `cashIn` `buildSplitTx` so the balance + receivable move together. Optimistic update with rollback on failure.
- New `renderPendingSplitRow(split, showBill)` helper renders the loan-style card: contact (+ bill name for standalone rows), remaining amount, a progress bar + "{paid} of {total} paid" once partially paid, a **Record payment** button (HandCoins), delete, and the inline amount/account form (reusing `loans.paybackAmount` / `loans.intoAccount` / `loans.noAccount` / `loans.confirmPayback` labels). Used for both single-person cards and each person inside a multi-person group.
- Pending single/multi rows and `totalOwed` + the group-card total now sum **remaining** (via `splitRemaining`) instead of original amounts. Settled-history checkmarks became static badges (un-settle removed — deletion is the reversal path, matching loans). Removed the now-unused `settlingSplitId` state.
- New split creations (Bills `handleRecordPayment`, Transactions split-an-expense, splits test helper) initialize `repaidAmount: 0`, `repaymentTxIds: []`.

**i18n:** added `bills.recordSplitPayment`, `bills.splitPaidOf` ("{paid} of {total} paid"), `bills.toastSplitPartial` to `en.json` + `vi.json`; reworded `splitPayNote`/`splitPayNoteGroup` from "mark them transferred" → "record their payment". `markTransferred`/`toastSplitUnsettled` remain (still used by the Transactions-page one-off split tracker, which keeps its checkbox).

**Scope note:** Only the Bills "Owed to You" tracker was converted, per the clarification. The Transactions-page one-off split tracker still uses the checkbox toggle (its `settleTxId` path is untouched and backward compatible).

**Verification:** `tsc --noEmit` clean; `next build` succeeds; `eslint` 0 errors on changed files (pre-existing hook-dep/setState warnings only); full vitest **324 passing**.

## 2026-06-03 — Health Banner: invisible days-left bar + final Safe-to-Spend dedup (branch claude/health-banner-safe-spend-dX3fo)

**Bugs reported (from a Home/dashboard screenshot):** (1) The Health Banner and the dedicated "Safe to Spend" KPI card "still the same" — both showed `-$136.48 over for the month`. (2) The little progress bar under "27d left" looked broken (a flat gray line, no fill).

**Bug 1 — banner/card collision (root cause):** The 2026-06-03 dedup pass (branch `claude/unruffled-mccarthy-cbf03a`) made the banner echo the *daily* safe-to-spend, which de-duped the **on-track** case but NOT the **overspent** case: when `safeToSpend < 0` the banner rendered `charts.safeOver` = `"{amount} over for the month"`, byte-for-byte identical to the card's `dashboard.safeToSpendOver` = `"over for the month"` on the same negative number. (Note: when overspent, `calcSafeToSpendDaily` passes the shortfall through unchanged, so daily == whole-month total == the same figure — there's no framing that makes them differ.) **Fix (user-chosen): drop the safe-to-spend segment from the banner entirely** so the KPI card is its sole owner. The banner's on-track second line is now just `{net}` net (net cashflow is unique to the banner — no card shows it); the `monthIncome === 0` and `monthSpending > monthIncome` branches are unchanged.

**Bug 2 — invisible bar (root cause):** Tailwind **v4**. The fill color was built at runtime: `cfg.iconColor.replace('text-', 'bg-')`. Two problems: (a) Tailwind v4 only emits classes it finds as *literal strings* in source, so a runtime-constructed `bg-amber-600` is never generated → no background → invisible fill; (b) `String.replace` only swaps the first match, so `"text-amber-600 dark:text-amber-400"` became `"bg-amber-600 dark:text-amber-400"` — the dark variant stayed `text-`, broken too. **Fix:** added a static, literal `barColor` to each status config (`bg-emerald-500` / `bg-indigo-500` / `bg-amber-500` / `bg-rose-500` / `bg-slate-400`) and the bar now uses `cfg.barColor`. The width math `((daysInMonth - daysLeft) / daysInMonth) * 100` (month-elapsed %) was always correct — only the color was missing.

**Files changed:**
- `app/(app)/dashboard/DashboardCharts.tsx` — `HealthBanner`: removed the `safeToSpend` / `dailySafeToSpend` props (no longer used); the on-track branch renders just `{cashFlow} net`; added `barColor` to all five status configs and switched the days-left bar to `cfg.barColor`.
- `app/(app)/dashboard/page.tsx` — `<HealthBanner>` no longer passes `safeToSpend` / `dailySafeToSpend` (both values are still computed for the Safe-to-Spend KPI card, which is unchanged).
- `locales/en.json` / `locales/vi.json` — removed the now-dead `charts.safeDaily` and `charts.safeOver` keys (were banner-only).

**Verification:** `tsc --noEmit` clean (after `npm ci`); full vitest **324 passing**; `eslint` on the two changed dashboard files — 0 errors (only the pre-existing unused-import / setState-in-effect warnings remain).

## 2026-06-03 — Merge "Divide total" / "Per person" split modes into one smart resolver (branch claude/cranky-germain-50e0ee)

**Request:** Every split surface (Bills, Split-an-Expense, group Loans) had a two-tab toggle — **Divide total** (type a total, blank rows auto-divide the remainder) vs **Per person** (type each share, total auto-sums). User wanted the two combined into one input that detects intent: e.g. with 4 people, typing 3 shares + a total auto-fills the 4th; typing only a total auto-divides evenly; leaving the total blank sums up the typed shares. Also asked that Bills "inherit" the same formula so Loans/Splits/Bills all share one calculation (Bills stays in its own section, just shares the math).

**Design — the toggle is replaced by "is the Total field filled?":**
- **Total filled** → divide it across people: typed amounts honored, blank boxes evenly split the remainder (you join that pool when `includeMe`). = existing `computeSplitShares`.
- **Total blank** → infer the total by summing the typed parts (blanks = 0) plus your own typed share when included. = existing `sumPerPersonShares`.
- One UX consequence: when a Total is set, your own share is always the remainder — to type a fixed personal share, leave Total blank. No functionality lost, just expressed differently.

**Change — `lib/splits.ts`:** new `resolveSplit(total, amounts, includeMe, myAmount=0)` that delegates to `computeSplitShares` when `total != null && total > 0`, else `sumPerPersonShares`; always returns the resolved group `total` so callers don't re-derive it. The two underlying functions are unchanged (still exported/tested). Added a `resolveSplit` suite to `lib/__tests__/splits.test.ts` (7 cases incl. the 4-people auto-fill, even divide, inferred sum, zero-total→infer, includeMe both ways, over-allocation).

**Forms refactored** — each dropped its `*SplitMode` state + the toggle UI, derives `hasTotal = (totalInput ?? 0) > 0`, and calls `resolveSplit`. When `!hasTotal`: the "your share" input appears (Bills/Splits) and the Total field shows the inferred sum as its placeholder with label `bills.totalAmountAuto`; when `hasTotal`: participant boxes show auto-share placeholders and the "Split equally" affordance appears.
- `app/(app)/bills/page.tsx` — removed `billSplitMode`; `resetSplitMode()` now only clears `billMyShare`. Bill `amount` field always editable (no more disabled "computed total" swap). `includeMe` is always true here.
- `app/(app)/transactions/page.tsx` — same for the Split-an-Expense form (`seSplitMode` removed; `includeMe` is the checkbox) and the group-loan form (`loanSplitMode` removed; `includeMe` always false; `loanUnassigned` = `computed.myShare` only when a total is typed).

**i18n:** added `bills.splitSmartHint` (combined explanation) and `bills.totalAmountAuto` to `locales/en.json` + `vi.json`. Old keys (`splitModeDivide/PerPerson/Hint`, `splitAutoHint`, `computedTotal`) left in place, now unused.

**Verification:** `tsc --noEmit` clean; full vitest 324 passing (incl. 20 in splits.test.ts); `eslint` on the 3 changed files — 0 errors (only pre-existing setState-in-effect / no-unused-expression warnings remain, untouched).

## 2026-06-03 — Rework Safe-to-Spend into a forward-looking daily allowance (branch claude/exciting-raman-cc0515)

**Problem reported:** The Safe-to-Spend KPI duplicated metrics already on the dashboard. It was `income − cashSpending − billsThisMonth`, i.e. just "income minus spending" with bills netted — the same backward-looking "what's left this month" idea that Savings Rate (a %), the Health Banner's "net" (`income − spending`), and the banner's own "after bills" line all already expressed. It never answered the question a safe-to-spend number exists for: how much can I spend from here to month-end without going under. User asked to enhance or replace it; said "you decide."

**Decision:** Replace the static total with a **forward-looking per-day allowance** (Simple/Copilot-style "safe to spend") — distinct from every other KPI because it's a *rate* over the days remaining, and it nets out the bills *still due* rather than all bills this month. Skipped the savings-reserve variant (no clean per-month savings-target concept exists yet — that'd be a separate feature).

**Formula:** `leftToSpend = monthIncome − monthCashSpending − upcomingBillsTotal` (bills still due, since already-paid bills are part of `monthCashSpending` — avoids double-counting). `dailySafeToSpend = leftToSpend / daysRemaining`, where `daysRemaining = daysLeft + 1` so today counts and it's never 0. Switched the bills input from `billsThisMonth` (all bills due this month, incl. already-passed) to `upcomingBillsTotal` (rest-of-month forecast, already computed on the page) — so `billsThisMonth` was removed.

**Changes:**
- `lib/calculations.ts` — `calcSafeToSpend` now wraps its result in `roundCents` and its comment reframed as "money left to spend for the rest of the month." New pure fn `calcSafeToSpendDaily(leftToSpend, daysRemaining)`: returns the shortfall unchanged when `leftToSpend < 0` (no allowance to give), returns the full leftover when `daysRemaining <= 0`, else `roundCents(leftToSpend / daysRemaining)`.
- `app/(app)/dashboard/page.tsx` — removed the `billsThisMonth` block; compute `leftToSpend` from `upcomingBillsTotal`, plus `daysRemaining`, `dailySafeToSpend`, `overspent`. The Safe-to-Spend StatCard now shows `${daily}/day` (indigo) with annotation `"{total} left · {days}d to go"` when on track, or the negative `leftToSpend` total (rose) with `"over for the month"` when overspent. HealthBanner still receives the leftover total via `safeToSpend={leftToSpend}` so its "after bills" line stays consistent.
- `locales/en.json` / `locales/vi.json` — new keys `perDay` ("/day" / "/ngày"), `safeToSpendNote` ("{total} left · {days}d to go"), `safeToSpendOver` ("over for the month").
- `lib/__tests__/calculations.test.ts` — added a `calcSafeToSpendDaily` suite (spread, cent-rounding, negative passthrough, zero-days) and a cent-rounding case for `calcSafeToSpend`.

**Verification:** `npx vitest run lib/__tests__/calculations.test.ts` → 234 passed. `tsc --noEmit` clean, `eslint` clean on changed files.

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

### Follow-up — settled loans group like Bills/Splits (same branch)

User: "Make sure to have the group just changed from Loan same with Bills and Splits." Bills and one-off/recurring Splits already collapse multi-person occurrences into expandable cards for BOTH pending and settled (via `groupSplits` + a settled History). Open loans got that grouping in the prior step, but **settled loans were still a flat list** — the one inconsistency.

`app/(app)/transactions/page.tsx`:
- Extracted the open-loan grouping into reusable `groupLoansByGroupId(list, keyPrefix?)` (adds `principal` sum; `keyPrefix` namespaces settled keys so expand state can't collide with the open group of the same `groupId`).
- `openLoanGroups` now uses it; new `settledLoanGroups` (prefix `settled:`).
- New `renderSettledLoanCard(loan, nested?)` (extracted from the old flat row) and `renderSettledLoanGroup(group)` — same collapsed/expandable shape as the open group + the Splits history (chevron, people count, direction · names, total principal line-through, delete per person).
- Replaced the flat `settledLoans.map(...)` with `settledLoanGroups.map(g => g.isGroup ? renderSettledLoanGroup : renderSettledLoanCard)`. Partial settlements render cleanly (the open and settled sides each show only their members; a 1-member settled "group" falls back to a solo card).

**Verification:** `tsc` clean; 312 tests pass; eslint 0 errors.

### Follow-up — settled loans behind a collapsible History (same branch)

User: "Let's add it" (the settled-loans History toggle for full parity with Splits). `app/(app)/transactions/page.tsx`: new `showLoanHistory` state (default collapsed); the settled-loans section is now a toggle button (`loans.settledHistory` {n} + chevron) that reveals `settledLoanGroups.slice(0, 10)` — same shape as the Splits settled History. New i18n `loans.settledHistory` (en + vi). tsc clean; locales valid; 312 tests pass.

## 2026-06-03 — Smooth height animation for expandable groups (branch claude/tender-wiles-0213ec)

**Problem reported:** Expanding a group row (loans, splits, bills, merchant view) popped its body in instantly, snapping the rows below it down. User wanted the reveal to animate smoothly "instead of pushing the container after expanding."

**Root cause:** Every expandable group rendered its body with `{open && (<div>…</div>)}`. Conditional mount/unmount means there's no height to transition — the element appears at full height in one frame, so siblings jump.

**Change — new reusable component `components/ui/Collapsible.tsx`:** animates open/close by transitioning the CSS `grid-template-rows` from `0fr` → `1fr` (the standard zero-JS height trick — no `ref`/measuring, works for any content height). Outer div is `grid transition-[grid-template-rows] ease-out` toggling `grid-rows-[0fr]`/`grid-rows-[1fr]`; inner wrapper is `overflow-hidden min-h-0` so the body clips while collapsed and eases the rows below it down on expand. Default `duration={300}` (overridable). Honors `prefers-reduced-motion` via `motion-reduce:transition-none`. Content stays mounted while collapsed (clipped), which is fine for these small lists.

**Applied** (replaced `{open && (…)}` with `<Collapsible open={open}>…</Collapsible>`, body markup unchanged):
- `app/(app)/transactions/page.tsx` — open multi-person loan group, settled loan group, merchant-view transaction list, pending split group, settled split group, and the settled-splits History section reveal.
- `app/(app)/bills/page.tsx` — the Sharing History section reveal.

The chevron rotation (`transition-transform rotate-180`) already animated and now visually matches the body easing. Bills' multi-person *pending* cards are always-expanded breakdowns (no toggle), so they were left as-is.

**Verification:** `tsc --noEmit` clean; `eslint` 0 errors on changed files (only the two pre-existing `bills/page.tsx` purity/setState-in-effect warnings remain, untouched by this change).

## 2026-06-03 — Banner safe-to-spend dedup + smoother Collapsible (branch claude/unruffled-mccarthy-cbf03a)

User questions/asks:
1. Confirm splits/loans/shared-bills only log *their share as my expense* and never as income when paid back. **Verified correct** — no code change. Only `myShare` is a `type:'expense'` tx (`app/(app)/transactions/page.tsx:884`); every other-person share (fronted on pay + payback on settle) is `buildSplitTx`/loan tx = `type:'transfer'` with an empty counterparty (`lib/splits.ts:29`). Transfers never count as income/expense: `calcMonthIncome`/`calcMonthExpense` filter strictly (`lib/calculations.ts:39`), `aggregateMonthlyTotals` `continue`s past them (`:478`). Fronted cash also doesn't dent Safe-to-Spend (`calcMonthCashSpending` only counts transfers whose `toAccount` is a debt acct; a fronted share's toAccount is empty — `:98`).

2. **Health Banner restated Safe-to-Spend as a whole-month lump total** (`{net} net · {leftToSpend} after bills`) while the KPI card had already moved to the forward-looking *daily* allowance (`calcSafeToSpendDaily`). User flagged the redundancy/inconsistency. **Fix:** banner now shows the daily figure too, so both speak the same language.
   - `HealthBanner` (`app/(app)/dashboard/DashboardCharts.tsx`): added `dailySafeToSpend` prop; kept `safeToSpend` only to detect the overspent case. Second line is now `{net} net · {daily}/day to spend`, or `{net} net · {shortfall} over for the month` when `safeToSpend < 0`.
   - `app/(app)/dashboard/page.tsx`: pass `dailySafeToSpend={dailySafeToSpend}`.
   - i18n: removed `charts.afterBills`; added `charts.safeDaily` ("{amount}/day to spend") + `charts.safeOver` ("{amount} over for the month") in en + vi.

3. **Collapsible open animation still not smooth** — rewrote `components/ui/Collapsible.tsx`. Was the grid-template-rows `0fr→1fr` trick (interpolates fr units, not composited, reflows whole subtree). Now measures content height via `ResizeObserver` on an inner ref and animates exact `height` (0↔px) + `opacity` fade with `transition-[height,opacity] ease-out motion-reduce:transition-none`. Keeping height synced to live content means a nested expand (splits history has a nested Collapsible) re-animates the parent instead of clipping. Same `open`/`duration`/`className` API — all call sites unchanged.

**Verification:** `tsc --noEmit` clean; 234 calc tests pass; no stale `afterBills` refs.

## 2026-06-03 — Distinct Loan/Split identity for transfer-type ledger rows (same branch)

User: loan (and split) cash movements showed as generic blue "Transfer" in the transaction history; wanted a distinct icon + name while keeping `type:'transfer'` (so income/expense math is untouched). Chose scope **Loans + Splits** and **backfill existing** rows.

Changes:
- `components/CategoryIcon.tsx`: added `Loan` (HandCoins, violet) and `Split` (Users, teal) to `CATEGORY_ICONS`.
- `app/(app)/transactions/page.tsx` `buildLoanTx`: transfer category `'Transfer'`→`'Loan'`.
- `lib/splits.ts` `buildSplitTx`: transfer category `'Transfer'`→`'Split'` (covers both one-off-split fronting and shared-bill/split paybacks).
- `locales/en.json` + `vi.json`: `categories.Loan` / `categories.Split` (Cho vay / Chia sẻ).
- **Backfill (existing rows):** `lib/sheets.ts` new `setTransactionCategories(updates)` — writes column F in place via `values.batchUpdate` (no delete+append, so rows don't reorder; matches ids→sheet row from `Transactions!A2:A`). New route `app/api/transactions/backfill-categories/route.ts` (POST): loads loans+splits+transactions, maps each loan `principalTxId`/`repaymentTxIds`→'Loan' and split `frontedTxId`/`settleTxId`→'Split', updates only rows whose category differs (idempotent), invalidates transactions+dashboard cache, returns `{updated}`. Transactions page fires it once per browser (localStorage guard `nf_loan_split_cat_backfill_v1`) and `load()`s again if anything changed.

Notes: real account-to-account transfers (savings page `category:'Transfer'`) intentionally stay 'Transfer'. 'Loan'/'Split' don't pollute spending charts/category totals (those count only `type:'expense'`). Edit-form transfer category select still uses EXPENSE_CATEGORIES (won't list Loan/Split) — acceptable since these are managed via the loans/splits UI.

**Verification:** `tsc --noEmit` clean; 317 tests pass; eslint 0 errors (only pre-existing warnings).

## 2026-06-03 — "Editable but safe" for loan/split-owned ledger rows (same branch)

Context: after giving loan/split transfers a distinct Loan/Split category, user noticed the generic transaction editor could mis-handle them. Investigation: the generic transactions API is loan/split-UNAWARE (grep confirmed), and every ledger row (incl. these transfers) had inline pencil-edit + swipe-delete. Risks: editing amount/account desyncs the owning loan/split (its remaining + account-balance reconciliation) and swipe-delete orphans the owning record's txId. (Note: the category dropdown is actually HIDDEN for `type:'transfer'` — `form.type !== 'transfer'` gate — so the original "shows expense categories" worry was moot.)

User chose **"editable but safe"**: keep harmless edits (date/description), lock the rest.

Changes (`app/(app)/transactions/page.tsx`):
- New `managedTxIds` memo = Set of all loan `principalTxId`/`repaymentTxIds` + split `frontedTxId`/`settleTxId`. `editManaged = !!editTarget && managedTxIds.has(editTarget.id)`.
- Edit modal when `editManaged`: violet hint banner (`t('transactions.managedRowHint')`, HandCoins icon); type tabs, amount `<input>`, from-account & to-account `<Select>`s all `disabled` (+ `disabled:opacity-60 disabled:cursor-not-allowed`). Date + description stay editable. Category select is already hidden for transfers, and locked type tabs prevent flipping it via handleTypeChange.
- Merchant view's edit pencil opens the same modal, so it's covered too.
- Swipe-delete: `SwipeableRow` gains `managed` prop → passes `disabled` to `SwipeToDelete`. `components/ui/SwipeToDelete.tsx` gained a `disabled?` prop (early-returns children with no drag wrapper, AFTER all hooks to respect rules-of-hooks). Managed rows = no swipe/delete; remove them via the Loans/Splits UI (whose DELETE routes cascade properly).
- i18n: `transactions.managedRowHint` (en + vi).

Why safe: with amount/account/type unchanged, the transactions PUT (reverse-old + apply-new) nets zero balance change; only date/description differ. Minor accepted cosmetic: editing the transfer's date doesn't change the loan/split record's own stored date.

**Verification:** `tsc --noEmit` clean; 317 tests pass; eslint 0 errors (only pre-existing setState-in-effect warnings).

## 2026-06-03 — Unlock amount editing on loan/split-owned rows with write-back sync (same branch)

User refined "editable but safe": amount SHOULD be editable (category is the only truly-fixed thing). Design decision: amount is cleanly per-row editable (lives on each transfer) so it can be synced back; `account` is a SHARED identity (a loan's many paybacks share one account; a split has two cash legs) and `type` must stay `transfer` — so those stay locked, category strict.

Changes (`app/(app)/transactions/page.tsx`):
- Amount `<input>` no longer `disabled` for managed rows (account selects + type tabs stay disabled; category still hidden for transfers).
- New `syncOwnerAmount(original, newAmount)` called from `handleSave` after the transactions PUT when `managedTxIds.has(editTarget.id)` && amount changed:
  - **loan principal** (`principalTxId`): set `loan.principal = newAmount`; recompute `settled = repaidAmount >= roundCents(newAmount) - 0.005`; POST /api/loans (bare = metadata upsert).
  - **loan repayment** (`repaymentTxIds`): `repaidAmount = max(0, repaid - original.amount + newAmount)`; recompute settled vs principal; POST /api/loans.
  - **split** (`frontedTxId`/`settleTxId`): set `split.amount = newAmount`; POST /api/splits; then also PUT the OTHER cash leg (sibling fronted/settle tx) to the new amount so both legs stay equal.
  - Throws on any failure → handleSave's catch reloads to resync. `load()` runs after success too.
- Balance correctness: the edited row's balance is handled by the generic transactions PUT (reverse original + apply updated on the unchanged account); loan number fields are metadata-only; the split sibling PUT adjusts the second leg (settled split nets zero on the account, unsettled leaves them owing the new amount).
- Hint updated (`transactions.managedRowHint`, en+vi): "Editing the amount also updates the linked loan/split. The account, type and category stay fixed to keep everything in sync."

Best-effort caveat (accepted by user): for a split this syncs the person's share + both cash legs, but does NOT rebalance the original group total or your own recorded expense share. Swipe-delete stays disabled for managed rows (deleting from the ledger would orphan the owning record — remove via Loans/Splits, whose DELETE cascades).

**Verification:** `tsc --noEmit` clean; 317 tests pass; eslint 0 errors.

## 2026-06-04 — Add per-person edit to Split-an-Expense (loan-style)

User: "we're missing edit button inside the split, make them similar to Loan, allow user to edit the transaction per person or total amount." The Loans tracker had a Pencil edit button per open loan; the Splits tracker's pending rows only had Record-payment + Delete. Mirrored the loan-edit model.

Changes:
- `app/api/splits/route.ts`: new **PUT** handler mirroring the loans PUT. Accepts `{ updated: Split; newTx?; removeTxId? }` — reverses the old fronted transfer's balance + deletes the row, applies the new fronted transfer, then upserts the split, all in one in-memory balance pass via `applyTransactionToBalances` + `persistChanged`. Paybacks (`repaidAmount`/`repaymentTxIds`) untouched. Invalidates splits + cash caches.
- `app/(app)/transactions/page.tsx`:
  - New state: `splitEditFor` (open split id), `splitEditForm` ({contactId, amount, account, date, category, description}), `savingSplitEdit`.
  - `openSplitEdit(split)`: toggles the inline edit panel; closes the payback panel first (one panel open per row); pre-fills from the split.
  - `handleEditSplit(split)`: rebuilds the fronted `cashOut` transfer via `buildSplitTx` from new amount/account/desc, recomputes `settled` against existing `repaidAmount`, optimistically updates `splits`, calls PUT `/api/splits` with `removeTxId: split.frontedTxId`, `load()`s when a cash row changed, reverts + toasts on failure.
  - `renderPendingSplitRow`: added a Pencil edit button (between Record-payment and Delete, `ml-auto` moved onto it) and a second `<Collapsible open={editing}>` panel with description, person (contact Select), their-share amount, date, category, pay-from account, Cancel/Save.
- i18n: `bills.toastSplitUpdated` (en: "Shared payment updated", vi). Reused existing keys (theirShare, person, selectContact, payFromOptional, txFronted, common.edit/save/date/category/description).

Design notes: per-person edit (matches Loan, which edits a single contact even for group loans). For a single-person split that one share IS the group total, so "edit total amount" is covered. Does NOT redistribute a multi-person group total or re-touch your own recorded expense share (same best-effort caveat as the ledger-row amount sync). `description` edits only that row's `billName`; grouping keys on billId+date so no group break.

**Verification:** `tsc --noEmit` clean; splits tests 20/20 pass; both locale JSONs parse.

## 2026-06-04 — Replace per-person split edit with whole-group edit (branch claude/split-group-edit)

Follow-up to PR #69 (per-person inline split edit, now merged to master). User clarified they want to "edit the whole group": re-open the full split form for a group, edit the total AND each person's share, add/remove people, redistribute like creating. Chose this over "fixed total, redistribute rest" and over keeping the per-person model. So this PR REPLACES the per-row edit with a group-level edit (the group form can still edit a single person, so nothing is lost).

Changes (`app/(app)/transactions/page.tsx`):
- Removed per-person edit: state `splitEditFor`/`splitEditForm`/`savingSplitEdit`, fns `openSplitEdit`/`handleEditSplit`, the per-row Pencil button + its inline edit Collapsible in `renderPendingSplitRow`.
- New state: `editingGroupKey` (group whose card is replaced by the form), `editingGroupSplits` (snapshot of members to reconcile against), `savingEditGroup`.
- New `openEditSplitGroup(group: SplitGroup)`: pre-fills the SHARED `splitExpenseForm` + `splitParticipants` (one row per member, key = split id) with the group's total/description/date/category/account; forces `includeMe:false` (your own share isn't part of a group — it's a standalone expense row with no back-link, so group edit never touches it).
- New `cancelEditGroup()` resets the shared form + clears editing keys. `openSplitExpense()` now also clears the editing keys so add-mode is clean.
- New `handleSaveEditGroup()`: resolves shares via `resolveSplit(total, amounts, false)`, then reconciles resolved participants against `editingGroupSplits` by contactId — existing member → PUT `/api/splits` (rebuild fronted tx, preserve paybacks, recompute settled; skips members whose every field is unchanged); new person → POST `{split, tx}`; removed member → DELETE (cascades cash reversal). All members reuse the group's `billId` so a date change moves the whole group together. Sequential awaits (shared account balance mutates server-side), then `load()` to resync.
- Extracted the split-an-expense form JSX into a reusable `renderSplitExpenseForm()` used both at the top (add mode) and in place of a group's card (edit mode, when `editingGroupKey === group.key`). In edit mode it hides the create-only help text and the "include my share" controls and swaps the footer to Save/Cancel→cancelEditGroup. Added a Pencil button to each pending group header (restructured header into a flex row: toggle button + edit button, avoiding nested buttons).
- Modal `onClose` also clears editing keys.

No API change: reuses the splits `PUT` added in #69. No new i18n keys (reuses `bills.toastSplitUpdated`, `common.save`, etc.).

Caveat (same as create / per-person): does NOT touch your own recorded expense share, and reducing a member's share below what they've already repaid marks them settled.

**Verification:** `tsc --noEmit` clean; splits tests 20/20; eslint 0 errors (only pre-existing set-state-in-effect warnings).

## 2026-06-04 — Group-edit: reconcile YOUR own share (myShareTxId back-reference) (same branch claude/split-group-edit)

User asked why the whole-group split edit didn't include the "include my share" option, and wanted editing it to move both the total and update their personal expense. Root cause: your own share is a standalone `expense` ledger row created at split time with NO link back to the group's Split records, so edit had no reliable way to find/update it.

Fix — give the group a back-reference to that expense row:
- `types/index.ts`: `Split.myShareTxId?: string` — id of your personal expense row, denormalized onto every group member ('' = not included).
- `lib/sheets.ts`: new Splits column P `my_share_tx_id`. `SPLITS_HEADER` += 'my_share_tx_id'; getSplits range `A2:O1000`→`A2:P1000` + parse `r[15]`; upsertSplit appends `split.myShareTxId ?? ''`. (`deleteRowById`'s last-col arg is unused — deletes by id row — so no change needed there. Additive column; legacy rows read as ''.)
- `handleSaveSplitExpense` (create): capture the created my-share expense's id into `myShareTxId` and stamp it on every member split.
- `openEditSplitGroup`: look up the group's `myShareTxId` → find that tx in `transactions` → pre-fill `includeMe` + `myShare` from it. Total is pre-filled BLANK so the form sums the parts (your share + everyone's) and round-trips the stored amounts while letting you edit your share and watch the total move.
- `handleSaveEditGroup`: now resolves with the real `includeMe`/`myShare`. Reconciles the personal expense FIRST: update in place (PUT /api/transactions) when it changed, create (POST) when newly included, delete (DELETE) when dropped to 0 — yielding the final `myShareTxId`, stamped onto every written member. Members whose cash-bearing fields are unchanged but whose my-share link changed get a cheap bare metadata upsert (POST split, fronted tx untouched); fully-unchanged members are skipped. So editing only your share = one transactions PUT + zero member cash churn (its id is unchanged).
- `renderSplitExpenseForm`: removed the `!editing` gates so the include-my-share checkbox, the your-share input, and the your-share preview show in edit mode too.

Caveat (pre-existing data): groups created before this column have `myShareTxId=''`; their old my-share expense (if any) is an unlinked orphan, so re-adding a share on edit creates a new expense rather than updating the orphan.

**Verification:** `tsc --noEmit` clean; full suite 324/324 pass; eslint 0 errors (only pre-existing set-state-in-effect warnings).
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
