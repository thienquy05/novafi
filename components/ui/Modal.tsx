'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        /*
         * On mobile: bottom sheet lifted above the fixed nav bar.
         * pb uses env(safe-area-inset-bottom) so the sheet clears the
         * home indicator on iPhone X+ devices as well.
         * On sm+: centered dialog with standard padding.
         */
        <div className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:p-6 sm:items-center"
          style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet panel — drag="y" controlled only from the handle strip */}
          <motion.div
            ref={ref}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={0}
            onDragEnd={(_, { offset, velocity }) => {
              if (offset.y > 100 || velocity.y > 500) onClose();
            }}
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 340 }}
            style={{ willChange: 'transform' }}
            className={cn(
              'relative z-10 w-full max-w-lg bg-white dark:bg-slate-800 shadow-2xl',
              'rounded-t-[2rem] sm:rounded-3xl',
              'flex flex-col',
              // 88dvh gives more room for tall forms; capped at 90vh on desktop
              'max-h-[88dvh] sm:max-h-[90vh]',
              className
            )}
          >
            {/* Drag handle — mobile only. Larger touch target than visual indicator. */}
            <div
              className="shrink-0 pt-3 pb-1.5 sm:hidden flex justify-center touch-none select-none cursor-grab active:cursor-grabbing tap-highlight-none"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600" />
            </div>

            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-6 pt-3 pb-3 sm:px-8 sm:pt-6 sm:pb-4">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">{title}</h2>
              <button
                onClick={onClose}
                className="h-9 w-9 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-150 tap-highlight-none shrink-0"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Scrollable body — overscroll-contain prevents page scroll bleed */}
            <div className="overflow-y-auto overscroll-contain flex-1 px-6 sm:px-8">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
