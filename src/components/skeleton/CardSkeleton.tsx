import React from 'react';
import Skeleton from './Skeleton';

type Props = {
  /** Match hub cards: 260px wide, 200px tall by default. */
  count?: number;
};

export default function CardSkeleton({ count = 4 }: Props) {
  const items = Array.from({ length: Math.max(1, Math.min(6, count)) });
  return (
    <div
      className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 pr-4 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ WebkitOverflowScrolling: 'touch' }}
      aria-hidden="true"
    >
      {items.map((_, idx) => (
        <div
          key={idx}
          className="relative flex-shrink-0 w-[min(260px,78vw)] snap-start snap-always rounded-xl overflow-hidden border"
          style={{ borderColor: '#1E1E1E', minHeight: 200 }}
        >
          <Skeleton variant="image" className="absolute inset-0" />
          <div className="absolute inset-x-0 bottom-0 p-3 pt-10">
            <Skeleton variant="text" className="h-4 w-[92%] mb-2" />
            <Skeleton variant="text" className="h-4 w-[82%] mb-2" />
            <Skeleton variant="text" className="h-3 w-24 opacity-90" />
          </div>
        </div>
      ))}
    </div>
  );
}

