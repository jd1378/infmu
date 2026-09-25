import type { StyleInfo } from '../core/engine.ts';

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const ROLE_LABEL: Record<string, string> = { prechorus: 'Pre-chorus', rest: 'Rest' };

/** "prechorus" -> "Pre-chorus", "drop" -> "Drop" */
export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role[0].toUpperCase() + role.slice(1);

export const styleLabel = (s: StyleInfo) => `${s.name}, ${s.genre}`;
