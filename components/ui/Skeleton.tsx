import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-2xl bg-slate-100', className)} />
  );
}

export function AccountsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-3xl" />)}
      </div>
      <div className="bg-white rounded-3xl border border-slate-100 p-4 sm:p-6 space-y-3">
        <Skeleton className="h-5 w-32 rounded-xl" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    </div>
  );
}

export function TransactionsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-3xl" />)}
      </div>
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-11 w-24 rounded-2xl" />)}
      </div>
      <div className="bg-white rounded-3xl border border-slate-100 divide-y divide-slate-50">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="w-11 h-11 shrink-0 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40 rounded-xl" />
              <Skeleton className="h-3 w-24 rounded-xl" />
            </div>
            <Skeleton className="h-5 w-16 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BillsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-3xl" />)}
      </div>
      <Skeleton className="h-48 rounded-3xl" />
      <div className="space-y-2.5">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-3xl" />)}
      </div>
    </div>
  );
}

export function PlanningSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-3">
        <Skeleton className="h-6 w-24 rounded-xl" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-3xl" />)}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-24 rounded-xl" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-3xl" />)}
      </div>
    </div>
  );
}
