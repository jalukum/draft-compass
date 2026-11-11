import { useState } from 'preact/hooks';
import type { Brawler } from '../data/types';

export function Portrait({ b, size = 36 }: { b: Brawler; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span class="pt" style={{ width: `${size}px`, height: `${size}px` }}>
      {broken || !b.img
        ? <span class="pt-fb">{b.name.slice(0, 2)}</span>
        : <img src={b.img} alt="" loading="lazy" decoding="async" width={size} height={size} onError={() => setBroken(true)} />}
    </span>
  );
}

export const fmtDate = (iso?: string) => {
  if (!iso) return 'unknown';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/); // plain dates are calendar days, not UTC midnight
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
