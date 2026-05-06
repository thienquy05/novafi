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

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={cn(
              'relative z-10 w-full max-w-lg rounded-t-[2rem] sm:rounded-3xl bg-white shadow-2xl',
              'flex flex-col max-h-[92dvh] sm:max-h-[90vh]',
              className
            )}
          >
            {/* Drag handle (mobile only) */}
            <div className="shrink-0 pt-4 pb-2 px-6 sm:pt-8 sm:px-8">
              <div className="mx-auto w-12 h-1.5 rounded-full bg-slate-200 mb-4 sm:hidden" />
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-10 w-10 p-0 rounded-full hover:bg-slate-100">
                  <X className="w-5 h-5 text-slate-500" />
                </Button>
              </div>
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto overscroll-contain flex-1 px-6 pb-6 sm:px-8 sm:pb-8">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}