'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

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
         * On mobile: "items-end pb-[4.5rem]" lifts the sheet above the
         * fixed bottom nav bar (~4rem tall) so it never slides behind it.
         * On sm+: centered with standard padding.
         */
        <div className="fixed inset-0 z-[200] flex items-end pb-[4.5rem] sm:items-center sm:pb-0 justify-center p-0 sm:p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet panel */}
          <motion.div
            ref={ref}
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className={cn(
              'relative z-10 w-full max-w-lg bg-white shadow-2xl',
              'rounded-t-[2rem] sm:rounded-3xl',
              'flex flex-col',
              // Leave room for scroll + sticky footer; cap so it never overflows
              'max-h-[80dvh] sm:max-h-[90vh]',
              className
            )}
          >
            {/* Drag handle — mobile only */}
            <div className="shrink-0 pt-3 sm:hidden flex justify-center">
              <div className="w-10 h-1 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-6 pt-4 pb-3 sm:px-8 sm:pt-7 sm:pb-4">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-9 w-9 p-0 rounded-full hover:bg-slate-100 shrink-0"
              >
                <X className="w-5 h-5 text-slate-500" />
              </Button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto overscroll-contain flex-1 px-6 sm:px-8">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
