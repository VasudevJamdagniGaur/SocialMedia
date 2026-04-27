import React from 'react';
import Skeleton from './Skeleton';

type Props = {
  count?: number;
};

export default function ListSkeleton({ count = 5 }: Props) {
  const items = Array.from({ length: Math.max(3, Math.min(6, count)) });
  return (
    <div className="space-y-3" aria-hidden="true">
      {items.map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl p-4"
          style={{ background: '#0F0F0F', border: '1px solid #1E1E1E' }}
        >
          <div className="flex items-center gap-3">
            <Skeleton variant="avatar" className="w-10 h-10" />
            <div className="flex-1 min-w-0">
              <Skeleton variant="text" className="h-4 w-[55%] mb-2" />
              <Skeleton variant="text" className="h-3 w-[30%] opacity-90" />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton variant="text" className="h-3 w-[92%]" />
            <Skeleton variant="text" className="h-3 w-[88%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

