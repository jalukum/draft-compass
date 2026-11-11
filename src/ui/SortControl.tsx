import type { SortBy, SortPref } from '../engine/sort';

const OPTIONS: { by: SortBy; label: string }[] = [
  { by: 'name', label: 'Name' }, { by: 'rarity', label: 'Rarity' }, { by: 'class', label: 'Class' },
];
const DIR_LABEL: Record<SortBy, [string, string]> = {
  name: ['A → Z', 'Z → A'], rarity: ['Common first', 'Rarest first'], class: ['A → Z', 'Z → A'],
};

export function SortControl({ value, onChange, label = 'Sort brawlers' }: { value: SortPref; onChange: (v: SortPref) => void; label?: string }) {
  return (
    <div class="sort-ctl" role="group" aria-label={label}>
      <span class="sort-label">Sort</span>
      <div class="sort-opts" role="radiogroup" aria-label="Sort by">
        {OPTIONS.map((o) => (
          <button type="button" role="radio" aria-checked={value.by === o.by} class={`chip sort-chip ${value.by === o.by ? 'on' : ''}`}
            onClick={() => onChange({ by: o.by, dir: value.by === o.by ? value.dir : 'asc' })}>
            {o.label}
          </button>
        ))}
      </div>
      <button type="button" class="chip sort-dir" aria-label={`Order: ${DIR_LABEL[value.by][value.dir === 'asc' ? 0 : 1]}. Tap to flip.`}
        onClick={() => onChange({ ...value, dir: value.dir === 'asc' ? 'desc' : 'asc' })}>
        <span aria-hidden="true">{value.dir === 'asc' ? '▲' : '▼'}</span> {DIR_LABEL[value.by][value.dir === 'asc' ? 0 : 1]}
      </button>
    </div>
  );
}
