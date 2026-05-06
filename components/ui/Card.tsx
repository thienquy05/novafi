import { cn } from '@/lib/utils';
import { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-3xl bg-white border border-slate-100 p-5 sm:p-7 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group',
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative z-10">{props.children}</div>
    </div>
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between mb-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 
      className={cn('text-sm font-bold text-slate-800 tracking-wide', className)} 
      {...props} 
    />
  );
}