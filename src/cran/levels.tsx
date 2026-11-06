import { Circle, CircleAlert, OctagonAlert, Square, TriangleAlert, CircleDashed, type LucideIcon } from 'lucide-react';
import { triageCategories } from '../model';

// Colour is never the only signal: each level also has a name, a P-number and a distinct icon shape.
const icons: LucideIcon[] = [OctagonAlert, TriangleAlert, CircleAlert, Square, Circle];

export function levelInfo(level: number | null) {
  if (!level) return { level: null, key: 'none', colour: 'Not yet triaged', label: 'Awaiting triage', target: '', targetMinutes: null as number | null, Icon: CircleDashed };
  const c = triageCategories[level - 1];
  return { level, key: c.colour.toLowerCase(), colour: c.colour, label: c.label, target: c.target, targetMinutes: c.targetMinutes as number | null, Icon: icons[level - 1] };
}

export function LevelBadge({ level, size = 'md' }: { level: number | null; size?: 'md' | 'lg' | 'sm' }) {
  const info = levelInfo(level);
  return (
    <span className={`cran-level cran-level-${info.key} cran-level-${size}`}>
      <info.Icon aria-hidden size={size === 'lg' ? 30 : size === 'sm' ? 18 : 22} strokeWidth={2.5} />
      <span>{info.level ? `P${info.level} ${info.colour}` : info.colour}</span>
      {info.level && <span className="cran-level-label">{info.label}</span>}
    </span>
  );
}

export const allLevels = [1, 2, 3, 4, 5];

export function minutes(m: number) {
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function clock(ts?: string) {
  return ts ? new Date(ts).toLocaleTimeString('en-NA', { hour: '2-digit', minute: '2-digit' }) : '';
}
