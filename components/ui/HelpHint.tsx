'use client';
import { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type Props = {
  children: React.ReactNode;
  label?: string;
  /** Where the popover floats relative to the trigger. Defaults to bottom-right of the icon. */
  align?: 'left' | 'right';
  /** Trigger button size in px. */
  size?: number;
};

export function HelpHint({ children, label = 'Help', align = 'right', size = 16 }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-1"
      >
        <HelpCircle style={{ width: size, height: size }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className={`absolute z-30 top-full mt-2 w-72 max-w-[80vw] bg-slate-900 dark:bg-slate-700 text-white text-xs font-medium leading-relaxed rounded-xl shadow-xl p-3 ${align === 'right' ? 'right-0' : 'left-0'}`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
