import { STYLES } from '../core/styles.ts';
import type { Role, StyleId } from '../core/types.ts';

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const ROLE_LABEL: Record<Role, string> = {
  intro: 'Intro',
  verse: 'Verse',
  chorus: 'Chorus',
  build: 'Build',
  drop: 'Drop',
  break: 'Break',
  outro: 'Outro',
};

export const styleLabel = (s: StyleId) => `${STYLES[s].name}, ${STYLES[s].genre}`;
