'use client';
import { useState, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { Haptics } from '@/lib/haptics';

/** Width of the revealed delete action. Kept compact for a tighter feel. */
const REVEAL_W = 64;

/**
 * Wraps any card/row and reveals a delete action when swiped left.
 * The trash icon scales + fades in as the row opens, so the gesture feels
 * lively without a permanently-visible trash button. Works with mouse drag too.
 *
 * The child must paint its own opaque background so the reveal stays hidden
 * until the row is dragged.
 */
export function SwipeToDelete({
  onDelete,
  children,
  className = '',
  rounded = 'rounded-3xl',
  label = 'Delete',
  disabled = false,
}: {
  onDelete: () => void;
  children: ReactNode;
  className?: string;
  rounded?: string;
  label?: string;
  /** When true the row can't be swiped/deleted — renders the content plainly. */
  disabled?: boolean;
}) {
  const x = useMotionValue(0);
  const [revealed, setRevealed] = useState(false);

  // Icon grows + fades in as the row slides open for a more playful reveal.
  const iconScale = useTransform(x, [-REVEAL_W, -REVEAL_W / 3, 0], [1, 0.6, 0.3]);
  const iconOpacity = useTransform(x, [-REVEAL_W, -10, 0], [1, 0.35, 0]);

  function snapOpen() {
    animate(x, -REVEAL_W, { type: 'spring', stiffness: 420, damping: 38 });
    if (!revealed) Haptics.light(); // tick only on the open transition
    setRevealed(true);
  }
  function snapClose() {
    animate(x, 0, { type: 'spring', stiffness: 420, damping: 38 });
    setRevealed(false);
  }

  // No swipe affordance for locked rows (e.g. loan/split-owned ledger entries).
  if (disabled) {
    return <div className={`relative ${rounded} overflow-hidden ${className}`}>{children}</div>;
  }

  return (
    <div className={`relative ${rounded} overflow-hidden ${className}`}>
      {/* Delete reveal */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-gradient-to-l from-rose-600 via-rose-500 to-rose-400"
        style={{ width: REVEAL_W + 14 }}
      >
        <motion.button
          type="button"
          onClick={() => { Haptics.medium(); onDelete(); snapClose(); }}
          style={{ scale: iconScale, opacity: iconOpacity }}
          className="flex flex-col items-center justify-center gap-0.5 text-white pr-1.5 tap-highlight-none"
          aria-label={label}
        >
          <Trash2 className="w-[18px] h-[18px]" />
          <span className="text-[10px] font-bold leading-none">{label}</span>
        </motion.button>
      </div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -REVEAL_W, right: 0 }}
        dragElastic={0.06}
        dragMomentum={false}
        style={{ x, touchAction: 'pan-y' }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -REVEAL_W / 2) snapOpen();
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
