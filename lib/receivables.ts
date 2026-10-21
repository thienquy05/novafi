import type { Funding, Split } from '@/types';
import { roundCents } from './calculations';
import { isRealPool, totalOwed } from './funding';
import { splitRemaining } from './splits';

// Money other people still owe the user. It is deliberately NOT part of net
// worth: fronting a share (split or funding tab) already moved the cash out of
// the account, and the IOU is never added back, so net worth stays "mine only".
// The dashboard shows this figure beside net worth instead.
//   • splits   — bill splits + one-off expense splits (the same `Split` sheet),
//                what is left after partial paybacks
//   • funding  — participants' unpaid pledges on open virtual tabs. Real pools
//                are skipped (everyone already paid in) and so are closed tabs.
export type OwedToYou = { splits: number; funding: number; total: number };

export function calcOwedToYou(splits: Split[], fundings: Funding[]): OwedToYou {
  const splitsOwed = roundCents(splits.reduce((s, x) => s + splitRemaining(x), 0));
  const fundingOwed = roundCents(
    fundings
      .filter((f) => !f.closed && !isRealPool(f))
      .reduce((s, f) => s + totalOwed(f), 0),
  );
  return { splits: splitsOwed, funding: fundingOwed, total: roundCents(splitsOwed + fundingOwed) };
}
