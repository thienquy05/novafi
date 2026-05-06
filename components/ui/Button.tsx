'use client';
import { cn } from '@/lib/utils';
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] select-none',
          {
            'bg-slate-900 text-white hover:bg-slate-800 shadow-md hover:shadow-lg hover:shadow-slate-900/20': variant === 'primary',
            'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-sm hover:shadow': variant === 'secondary',
            'text-slate-500 hover:text-slate-900 hover:bg-slate-100': variant === 'ghost',
            'bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-100': variant === 'danger',
          },
          {
            'h-10 px-4 text-sm': size === 'sm',
            'h-12 px-6 text-sm': size === 'md',
            'h-14 px-8 text-base': size === 'lg',
            'h-14 w-14 rounded-full': size === 'icon',
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';