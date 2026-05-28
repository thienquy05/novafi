import { cn } from '@/lib/utils';
import { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 p-5 sm:p-7 shadow-sm hover:shadow-md hover:border-slate-200 dark:hover:border-slate-600 transition-[box-shadow,border-color] duration-200',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between mb-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 
      className={cn('text-sm font-bold text-slate-800 dark:text-slate-200 tracking-wide', className)}
      {...props} 
    />
  );
}