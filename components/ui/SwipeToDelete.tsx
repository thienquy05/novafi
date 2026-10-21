'use client';
import { useState, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, animate, type MotionValue } from 'framer-motion';
import { Trash2, type LucideIcon } from 'lucide-react';
import { Haptics } from '@/lib/haptics';

/** Width of the revealed delete action. Kept compact for a tighter feel. */
const REVEAL_W = 64;

/** A swipe-revealed action. `tone` picks the reveal gradient. */
export type SwipeAction = { label: string; icon: LucideIcon; tone: 'rose' | 'emerald' | 'indigo'; onAction: () => void };

const TONE_BG: Record<SwipeAction['tone'], string> = {
  rose: 'bg-gradient-to-l from-rose-600 via-rose-500 to-rose-400',
  emerald: 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400',
  indigo: 'bg-gradient-to-l from-indigo-600 via-indigo-500 to-indigo-400',
};

/**
 * Wraps any card/row and reveals actions on swipe. Swiping LEFT reveals the
 * trailing action — Delete by default (`onDelete`), or any `trailing` action
 * (e.g. Edit, where deleting by gesture would be too destructive). Swiping RIGHT
 * reveals an optional `leading` action (e.g. Pay a bill). The icon scales + fades
 * in as the row opens. Works with mouse drag too.
 *
 * The child must paint its own opaque background so the reveal stays hidden
 * until the row is dragged.
 */
export function SwipeToDelete({
  onDelete,
  trailing,
  leading,
  children,
  className = '',
  rounded = 'rounded-3xl',
  label = 'Delete',
  disabled = false,
}: {
  onDelete?: () => void;
  trailing?: SwipeAction;
  leading?: SwipeAction;
  children: ReactNode;
  className?: string;
  rounded?: string;
  label?: string;
  /** When true the row can't be swiped/deleted — renders the content plainly. */
  disabled?: boolean;
}) {
  const x = useMotionValue(0);
  const [revealed, setRevealed] = useState<'left' | 'right' | null>(null);
  const end: SwipeAction | undefined = trailing ?? (onDelete ? { label, icon: Trash2, tone: 'rose', onAction: onDelete } : undefined);

  // Icons grow + fade in as the row slides open for a more playful reveal.
  const endScale = useTransform(x, [-REVEAL_W, -REVEAL_W / 3, 0], [1, 0.6, 0.3]);
  const endOpacity = useTransform(x, [-REVEAL_W, -10, 0], [1, 0.35, 0]);
  const startScale = useTransform(x, [0, REVEAL_W / 3, REVEAL_W], [0.3, 0.6, 1]);
  const startOpacity = useTransform(x, [0, 10, REVEAL_W], [0, 0.35, 1]);

  function snapOpen(side: 'left' | 'right') {
    animate(x, side === 'left' ? -REVEAL_W : REVEAL_W, { type: 'spring', stiffness: 420, damping: 38 });
    if (revealed !== side) Haptics.light(); // tick only on the open transition
    setRevealed(side);
  }
  function snapClose() {
    animate(x, 0, { type: 'spring', stiffness: 420, damping: 38 });
    setRevealed(null);
  }

  // No swipe affordance for locked rows (e.g. loan/split-owned ledger entries).
  if (disabled || (!end && !leading)) {
    return <div className={`relative ${rounded} overflow-hidden ${className}`}>{children}</div>;
  }

  const actionButton = (a: SwipeAction, scale: MotionValue<number>, opacity: MotionValue<number>, pad: string) => {
    const Icon = a.icon;
    return (
      <motion.button
        type="button"
        onClick={() => { Haptics.medium(); a.onAction(); snapClose(); }}
        style={{ scale, opacity }}
        className={`flex flex-col items-center justify-center gap-0.5 text-white ${pad} tap-highlight-none`}
        aria-label={a.label}
      >
        <Icon className="w-[18px] h-[18px]" />
        <span className="text-[11px] font-bold leading-none">{a.label}</span>
      </motion.button>
    );
  };

  return (
    <div className={`relative ${rounded} overflow-hidden ${className}`}>
      {leading && (
        <div className={`absolute inset-y-0 left-0 flex items-center justify-center ${TONE_BG[leading.tone]}`} style={{ width: REVEAL_W + 14 }}>
          {actionButton(leading, startScale, startOpacity, 'pl-1.5')}
        </div>
      )}
      {end && (
        <div className={`absolute inset-y-0 right-0 flex items-center justify-center ${TONE_BG[end.tone]}`} style={{ width: REVEAL_W + 14 }}>
          {actionButton(end, endScale, endOpacity, 'pr-1.5')}
        </div>
      )}

      <motion.div
        drag="x"
        dragConstraints={{ left: end ? -REVEAL_W : 0, right: leading ? REVEAL_W : 0 }}
        dragElastic={0.06}
        dragMomentum={false}
        style={{ x, touchAction: 'pan-y' }}
        onDragEnd={(_, info) => {
          if (end && info.offset.x < -REVEAL_W / 2) snapOpen('left');
          else if (leading && info.offset.x > REVEAL_W / 2) snapOpen('right');
          else snapClose();
        }}
        onClick={() => { if (revealed) snapClose(); }}
        className="relative z-10"
      >
        {children}
      </motion.div>
    </div>
  );
}
