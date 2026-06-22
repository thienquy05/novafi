import { Skeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-5 pb-28 md:pb-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-44 rounded-2xl" />
        <Skeleton className="h-10 w-36 rounded-2xl" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-3xl" />)}
      </div>
      <div className="space-y-2.5">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-3xl" />)}
      </div>
    </div>
  );
}
