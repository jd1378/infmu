import type { MovementInfo, StyleInfo } from '../core/engine.ts';

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const ROLE_LABEL: Record<string, string> = { prechorus: 'Pre-chorus', rest: 'Rest' };

/** "prechorus" -> "Pre-chorus", "drop" -> "Drop" */
export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role[0].toUpperCase() + role.slice(1);

/** A style as the listener knows it: its genre ("Post-rock"), not its name inside the engine. */
export const styleLabel = (s: StyleInfo) => s.genre[0].toUpperCase() + s.genre.slice(1);

/** How long each section of a movement plays, in seconds: as the engine says, or its bars at a steady 4/4. */
export const sectionSeconds = (mv: Pick<MovementInfo, 'bpm' | 'sections'>): number[] =>
  mv.sections.map((s) => s.seconds ?? (s.bars * 240) / mv.bpm);
