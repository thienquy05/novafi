import { Skeleton } from '@/components/ui/Skeleton';

// Mirrors the real page (PageHeader emblem + title, 3 summary cards, rows) and
// its spacing, so nothing jumps when data arrives. Also rendered by the page
// itself while its first load is in flight.
export function SubscriptionsSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 pb-24 md:pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <Skeleton className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl shrink-0" />
          <div className="space-y-2">
            <Skeleton className="h-7 md:h-9 w-44 rounded-xl" />
            <Skeleton className="h-4 w-56 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-11 w-40 rounded-2xl" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-3xl" />)}
      </div>
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-[68px] rounded-3xl" />)}
      </div>
    </div>
  );
}

export default function Loading() {
  return <SubscriptionsSkeleton />;
}
