'use client';
import React, { createContext, useContext, useState, useCallback } from 'react';
import * as Toast from '@radix-ui/react-toast';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'info';
type ToastAction = { label: string; onClick: () => void };
type ToastEntry = { id: string; message: string; type: ToastType; action?: ToastAction };
type ToastFn = (message: string, type?: ToastType, action?: ToastAction) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Auto-dismiss is driven by Radix's per-toast `duration` below (which also
  // pauses on hover/focus); removal from state happens in `onOpenChange` so the
  // close button, swipe, and timeout all funnel through one path.
  const toast = useCallback<ToastFn>((message, type = 'success', action) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type, action }]);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      <Toast.Provider swipeDirection="right" duration={3500}>
        {children}
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            // Toasts with an action (e.g. Undo) stay up longer so there's time to act.
            duration={t.action ? 6000 : 3500}
            onOpenChange={(open) => { if (!open) remove(t.id); }}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border text-sm font-semibold',
              'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-5 data-[state=open]:fade-in-0',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full',
              'transition-all duration-200',
              t.type === 'success' && 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-900/80 dark:border-emerald-700/60 dark:text-emerald-100 dark:backdrop-blur-sm',
              t.type === 'error' && 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-900/80 dark:border-rose-700/60 dark:text-rose-100 dark:backdrop-blur-sm',
              t.type === 'info' && 'bg-slate-900 border-slate-700 text-white dark:bg-slate-700 dark:border-slate-600',
            )}
          >
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />}
            {t.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-300 shrink-0" />}
            {t.type === 'info' && <Info className="w-4 h-4 text-slate-300 shrink-0" />}
            <Toast.Description asChild>
              <span className="flex-1">{t.message}</span>
            </Toast.Description>
            {t.action && (
              <Toast.Action asChild altText={t.action.label}>
                <button
                  onClick={() => {
                    t.action!.onClick();
                    setToasts((prev) => prev.filter((x) => x.id !== t.id));
                  }}
                  className="ml-1 shrink-0 font-bold underline underline-offset-2 hover:opacity-80 transition-opacity"
                >
                  {t.action.label}
                </button>
              </Toast.Action>
            )}
            <Toast.Close asChild>
              <button className="ml-1 text-current opacity-50 hover:opacity-100 transition-opacity">
                <X className="w-3.5 h-3.5" />
              </button>
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed bottom-[5.5rem] sm:bottom-6 right-4 sm:right-6 z-[400] flex flex-col gap-2 w-[calc(100vw-2rem)] sm:w-80 max-w-full pointer-events-none [&>*]:pointer-events-auto" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}
