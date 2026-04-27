import React from 'react';
import Skeleton from './Skeleton';

type Props = {
  count?: number;
};

export default function FeedSkeleton({ count = 4 }: Props) {
  const items = Array.from({ length: Math.max(3, Math.min(6, count)) });
  return (
    <div className="space-y-4" aria-hidden="true">
      {items.map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl overflow-hidden"
          style={{ background: '#0F0F0F', border: '1px solid #1E1E1E' }}
        >
          <div className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton variant="avatar" className="w-10 h-10" />
              <div className="flex-1 min-w-0">
                <Skeleton variant="text" className="h-3 w-32 mb-2" />
                <Skeleton variant="text" className="h-3 w-20 opacity-90" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton variant="text" className="h-3 w-[92%]" />
              <Skeleton variant="text" className="h-3 w-[86%]" />
              <Skeleton variant="text" className="h-3 w-[70%]" />
            </div>
            <div className="mt-4">
              <Skeleton variant="image" className="h-40 w-full rounded-xl" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

