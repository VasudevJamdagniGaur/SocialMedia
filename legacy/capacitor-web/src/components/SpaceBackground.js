import React, { useMemo } from 'react';

/** Stable star field so layout does not shift on re-render. */
function useStarField(count = 120) {
  return useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${(i * 17.3) % 100}%`,
      top: `${(i * 23.7 + 11) % 100}%`,
      size: (i % 5 === 0 ? 2.5 : i % 3 === 0 ? 1.5 : 1) + (i % 2) * 0.5,
      opacity: 0.35 + (i % 7) * 0.08,
      delay: (i % 11) * 0.4,
      duration: 3 + (i % 5),
    }));
  }, [count]);
}

/**
 * Deep space + star field + cyan/purple nebula (shared by signup & landing).
 * @param {{ nebulaCenterY?: string, starCount?: number }} props
 */
export default function SpaceBackground({ nebulaCenterY = '38%', starCount = 140 }) {
  const stars = useStarField(starCount);

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 120% 80% at 50% 35%, #0d1228 0%, #06060f 45%, #020205 100%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {stars.map((s) => (
          <div
            key={s.id}
            className="absolute rounded-full bg-white"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              opacity: s.opacity,
              boxShadow: `0 0 ${s.size * 2}px rgba(255,255,255,0.5)`,
              animation: `space-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </div>
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          top: nebulaCenterY,
          width: 'min(92vw, 420px)',
          height: 'min(92vw, 420px)',
          background:
            'radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.22) 0%, rgba(88, 28, 135, 0.18) 28%, rgba(30, 10, 60, 0.12) 48%, transparent 72%)',
          filter: 'blur(2px)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          top: nebulaCenterY,
          width: 'min(70vw, 280px)',
          height: 'min(70vw, 280px)',
          background:
            'radial-gradient(circle, rgba(147, 51, 234, 0.15) 0%, rgba(6, 182, 212, 0.08) 40%, transparent 70%)',
          filter: 'blur(28px)',
        }}
        aria-hidden
      />
      <style>{`
        @keyframes space-twinkle {
          0%, 100% { opacity: 0.25; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
    </>
  );
}
