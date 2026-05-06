import { TransactionsSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5 pb-28 md:pb-8">
      <TransactionsSkeleton />
    </div>
  );
}
