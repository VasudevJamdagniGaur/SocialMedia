import React from 'react';
import clsx from 'clsx';

export type SkeletonVariant = 'text' | 'avatar' | 'card' | 'image';

type Props = {
  variant?: SkeletonVariant;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Width/height helpers for quick usage without inline styles.
   * If you pass `className` (e.g. w-20 h-5), you usually don't need these.
   */
  width?: number | string;
  height?: number | string;
};

function variantDefaults(variant: SkeletonVariant) {
  switch (variant) {
    case 'avatar':
      return { borderRadius: 9999 };
    case 'text':
      return { borderRadius: 10 };
    case 'image':
      return { borderRadius: 12 };
    case 'card':
    default:
      return { borderRadius: 16 };
  }
}

export default function Skeleton({
  variant = 'text',
  className,
  style,
  width,
  height,
}: Props) {
  const base = variantDefaults(variant);
  return (
    <div
      className={clsx('skeleton', className)}
      style={{
        ...base,
        ...(width != null ? { width } : null),
        ...(height != null ? { height } : null),
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

