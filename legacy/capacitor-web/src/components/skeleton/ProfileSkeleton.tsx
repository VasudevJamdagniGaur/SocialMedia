import React from 'react';
import Skeleton from './Skeleton';

export default function ProfileSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#131314' }} aria-hidden="true">
      <div className="max-w-sm mx-auto px-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}>
        <div className="flex items-center gap-3 mb-6">
          <Skeleton variant="avatar" className="w-10 h-10" />
          <Skeleton variant="text" className="h-5 w-28" />
        </div>

        <div
          className="rounded-2xl p-6 mb-6"
          style={{ background: '#262626', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex flex-col items-center text-center">
            <Skeleton variant="avatar" className="w-20 h-20 mb-3" />
            <Skeleton variant="text" className="h-6 w-40 mb-2" />
            <Skeleton variant="text" className="h-4 w-24 mb-4 opacity-90" />
            <Skeleton variant="card" className="h-9 w-28 rounded-full" />
            <div className="flex items-center justify-center gap-4 mt-4 pt-4 w-full" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <Skeleton variant="avatar" className="w-9 h-9" />
              <Skeleton variant="avatar" className="w-9 h-9" />
              <Skeleton variant="avatar" className="w-9 h-9" />
              <Skeleton variant="avatar" className="w-9 h-9" />
            </div>
          </div>
        </div>

        <Skeleton variant="text" className="h-4 w-28 mb-3" />
        <div className="space-y-4">
          <div
            className="rounded-2xl p-4"
            style={{ background: '#262626', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="space-y-2">
              <Skeleton variant="text" className="h-4 w-[92%]" />
              <Skeleton variant="text" className="h-4 w-[86%]" />
              <Skeleton variant="text" className="h-4 w-[70%]" />
            </div>
            <Skeleton variant="image" className="h-40 w-full rounded-xl mt-3" />
          </div>
          <div
            className="rounded-2xl p-4"
            style={{ background: '#262626', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="space-y-2">
              <Skeleton variant="text" className="h-4 w-[90%]" />
              <Skeleton variant="text" className="h-4 w-[84%]" />
            </div>
            <Skeleton variant="text" className="h-3 w-24 mt-3 opacity-90" />
          </div>
        </div>
      </div>
    </div>
  );
}

