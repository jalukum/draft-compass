import { useEffect, useState } from 'preact/hooks';

const STEPS = [
  { target: 'map', title: 'Start with the map', body: 'Tap here and choose the map from your Ranked lobby. Suggestions use its mode to weigh range, walls and roles.' },
  { target: 'tap-mode', title: 'Ban first', body: 'With Ban on, tapping a brawler in the roster adds it to the ban row. Up to six, then it flips to picks.' },
  { target: 'roster', title: 'Then log picks', body: 'Switch to Pick and tap brawlers as they lock in. Turns follow the 1-2-2-1 order, and you can flip whose turn it is.' },
  { target: 'breakdown', title: 'Ask why', body: 'Tap a suggestion to open its breakdown: mode fit, team fit, matchups and blind-pick safety, each with a short note.' },
  { target: 'reset', title: 'Next game', body: 'Reset clears bans and picks but keeps your map. Tap any slot on the board to undo just that one.' },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) return;
    el.classList.add('tour-focus');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return () => el.classList.remove('tour-focus');
  }, [step.target]);
  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : onDone());
  return (
    <div class="tour" role="dialog" aria-live="polite" aria-label="Quick tour">
      <div class="tour-card">
        <span class="tour-step">{i + 1} / {STEPS.length}</span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div class="btn-row">
          <button type="button" class="btn ghost" onClick={onDone}>Skip</button>
          {i > 0 && <button type="button" class="btn" onClick={() => setI(i - 1)}>Back</button>}
          <button type="button" class="btn primary" onClick={next}>{i < STEPS.length - 1 ? 'Next' : 'Got it'}</button>
        </div>
      </div>
    </div>
  );
}
