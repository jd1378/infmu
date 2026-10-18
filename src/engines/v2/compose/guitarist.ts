// A guitarist's hands. Players are told apart by a few habits more than by their notes: how wide and how fast they
// shake a held note (a quick narrow flutter, a slow wide one), whether they pick every note or hammer and pull a run
// off one pick, whether they slide into notes, bend up to them, or wear a bottleneck and glide from note to note on
// one pick. Each piece's lead guitarist has one set of these habits, heard in every line they play, and tunes the
// guitar their way: which open strings ring on through the chords.

import { MODES } from '../theory.ts';
import type { Ctx } from './context.ts';

export type Player = 'singer' | 'blues' | 'legato' | 'plain' | 'tremolo' | 'bottleneck';

/** How a guitarist plays a line: the chances are per note that could be played that way. */
export interface Hands {
  /** The vibrato on a held note: its width (1 the usual) and rate (Hz). */
  readonly vib: number;
  readonly rate: number;
  /** A step to a note joined to the one before: hammered on or pulled off, not picked. */
  readonly slur: number;
  /** A held note joined to the one before (up to a fifth away): slid to along the string, not picked. */
  readonly legato: number;
  /** A held note reached by a leap: slid into from a fret or two away. */
  readonly slide: number;
  /** How long a slide takes, as a multiple of a quick one along the frets (a bottleneck glides). */
  readonly glide: number;
  /** A held note: picked on the scale's note below and bent up to it (not on an acoustic's heavy strings). */
  readonly bend: number;
  /** Tremolo-picked in 32nds rather than 16ths. */
  readonly fast: boolean;
}

/** Anyone: the band's other guitarists, as most players play. */
export const ANYONE: Hands = {
  vib: 1,
  rate: 5.2,
  slur: 0.5,
  legato: 0,
  slide: 0.3,
  glide: 1,
  bend: 0,
  fast: false,
};

export const PLAYERS: Record<Player, Hands> = {
  // sings each long note: bends up to it and shakes it slowly and wide
  singer: { vib: 1.5, rate: 4.4, slur: 0.3, legato: 0.1, slide: 0.15, glide: 1, bend: 0.3, fast: false },
  // a quick narrow flutter, runs hammered and pulled off, bends
  blues: { vib: 1.1, rate: 6.3, slur: 0.65, legato: 0.15, slide: 0.3, glide: 1, bend: 0.25, fast: false },
  // barely picks: hammers, pulls off and slides from note to note
  legato: {
    vib: 0.9,
    rate: 5.2,
    slur: 0.85,
    legato: 0.45,
    slide: 0.4,
    glide: 1.4,
    bend: 0.05,
    fast: false,
  },
  // picks every note cleanly and leaves it to the delay, barely shaken
  plain: { vib: 0.35, rate: 5.3, slur: 0.1, legato: 0, slide: 0.03, glide: 1, bend: 0, fast: false },
  // quick and bright: tremolo in 32nds, a quick narrow vibrato
  tremolo: { vib: 0.7, rate: 5.9, slur: 0.4, legato: 0.1, slide: 0.1, glide: 1, bend: 0.05, fast: true },
  // a slide on one finger: no frets, so nothing is hammered; it glides from note to note on one pick and scoops up
  // into the notes it picks, with a wide even vibrato
  bottleneck: { vib: 1.6, rate: 5.8, slur: 0, legato: 0.8, slide: 0.5, glide: 3, bend: 0, fast: false },
};

/**
 * Tunings, as the open strings that ring through the chords, in semitones above the tonic: the root and fifth
 * (an open tuning, or standard in E), the fifth and ninth (standard tuning's top strings in A), all three.
 */
const TUNINGS: readonly (readonly number[])[] = [[0, 7], [7, 14], [0, 7, 14]];

/** The piece's lead guitarist: who plays, and the open strings of their tuning (only those in the key). */
export function guitarist(ctx: Ctx): { who: Player; hands: Hands; open: number[] } {
  const rng = ctx.mrng.fork('guitarist');
  const who = rng.pick(Object.keys(PLAYERS) as Player[]);
  const scale: readonly number[] = MODES[ctx.key.mode];
  const open = rng.pick(TUNINGS).filter((x) => scale.includes(x % 12));
  return { who, hands: PLAYERS[who], open };
}
