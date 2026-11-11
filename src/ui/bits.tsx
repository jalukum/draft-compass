import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Brawler } from '../data/types';

export function Portrait({ b, size = 56, tint = true, dim = false }: { b: Brawler; size?: number; tint?: boolean; dim?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      class={`portrait${dim ? ' dim' : ''}${tint ? ' framed' : ''}`}
      style={{ width: `${size}px`, height: `${size}px`, '--rar': b.rarityColor } as any}
    >
      {broken || !b.img ? (
        <span class="portrait-fallback">{b.name.slice(0, 2)}</span>
      ) : (
        <img src={b.img} alt="" loading="lazy" decoding="async" width={size} height={size} onError={() => setBroken(true)} />
      )}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, tour }: {
  value: T; options: { value: T; label: ComponentChildren; tone?: string }[]; onChange: (v: T) => void; label: string; tour?: string;
}) {
  return (
    <div class="seg" role="radiogroup" aria-label={label} data-tour={tour}>
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={`seg-btn ${o.value === value ? 'on' : ''} ${o.tone ?? ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label class="switch-row">
      <span>
        <span class="switch-label">{label}</span>
        {hint && <span class="hint">{hint}</span>}
      </span>
      <input type="checkbox" class="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="btn ghost icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export const fmtDate = (iso?: string) => {
  if (!iso) return 'unknown';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/); // plain dates are calendar days, not UTC midnight
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" class="logo">
      <circle cx="32" cy="32" r="28" fill="#ffd21f" stroke="#0d0b26" stroke-width="5" />
      <circle cx="32" cy="32" r="18" fill="#14123a" />
      <path d="M32 12 L39 32 L32 52 L25 32 Z" fill="#ff3d7f" stroke="#0d0b26" stroke-width="3" stroke-linejoin="round" />
      <path d="M32 12 L39 32 L25 32 Z" fill="#2ad4ff" stroke="#0d0b26" stroke-width="3" stroke-linejoin="round" />
      <circle cx="32" cy="32" r="4" fill="#fff8e6" stroke="#0d0b26" stroke-width="2.5" />
    </svg>
  );
}
