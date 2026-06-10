import { cn } from '@/lib/utils';
import type { BankBrand } from '@/lib/bankBrands';

/** Tinted monogram tile standing in for a bank's logo (we don't ship trademarked
 *  marks). Size is the square edge in px; the monogram scales with it. */
export function BankBadge({ brand, size = 48, className }: { brand: BankBrand; size?: number; className?: string }) {
  return (
    <div
      className={cn('rounded-2xl flex items-center justify-center shrink-0 shadow-sm font-extrabold tracking-tight select-none', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: brand.color,
        color: brand.textColor ?? '#ffffff',
        fontSize: Math.round(size * 0.36),
      }}
      title={brand.label}
      aria-label={brand.label}
    >
      {brand.short}
    </div>
  );
}
