// The computer keyboard, drawn: a key that plays shows what it plays (a note, a drum), the rest are dim, and the
// arrows move the window by an octave or change the instrument. Keys are labelled in the listener's layout when the
// browser can tell (navigator.keyboard), a US one otherwise; they are found by position, so any layout plays.

import { isBlack, noteName, type Played } from './keys.ts';

const ROWS: readonly (readonly (readonly [string, string])[])[] = [
  [
    ['Backquote', '`'],
    ['Digit1', '1'],
    ['Digit2', '2'],
    ['Digit3', '3'],
    ['Digit4', '4'],
    ['Digit5', '5'],
    ['Digit6', '6'],
    ['Digit7', '7'],
    ['Digit8', '8'],
    ['Digit9', '9'],
    ['Digit0', '0'],
    ['Minus', '-'],
    ['Equal', '='],
  ],
  [
    ['KeyQ', 'Q'],
    ['KeyW', 'W'],
    ['KeyE', 'E'],
    ['KeyR', 'R'],
    ['KeyT', 'T'],
    ['KeyY', 'Y'],
    ['KeyU', 'U'],
    ['KeyI', 'I'],
    ['KeyO', 'O'],
    ['KeyP', 'P'],
    ['BracketLeft', '['],
    ['BracketRight', ']'],
  ],
  [
    ['KeyA', 'A'],
    ['KeyS', 'S'],
    ['KeyD', 'D'],
    ['KeyF', 'F'],
    ['KeyG', 'G'],
    ['KeyH', 'H'],
    ['KeyJ', 'J'],
    ['KeyK', 'K'],
    ['KeyL', 'L'],
    ['Semicolon', ';'],
    ['Quote', "'"],
  ],
  [
    ['KeyZ', 'Z'],
    ['KeyX', 'X'],
    ['KeyC', 'C'],
    ['KeyV', 'V'],
    ['KeyB', 'B'],
    ['KeyN', 'N'],
    ['KeyM', 'M'],
    ['Comma', ','],
    ['Period', '.'],
    ['Slash', '/'],
  ],
];
/** Each row's indent, in keys, as on a real keyboard. */
const INDENT = [0, 0.5, 0.75, 1.25];
const ARROWS: readonly (readonly [string, string, number, number])[] = [
  ['ArrowUp', '↑', 1, 2],
  ['ArrowLeft', '←', 0, 3],
  ['ArrowDown', '↓', 1, 3],
  ['ArrowRight', '→', 2, 3],
];
const K = 66;
const GAP = 7;
const NS = 'http://www.w3.org/2000/svg';

export interface Legend {
  svg: SVGSVGElement;
  /** Shows a key down or up. */
  press(code: string, down: boolean): void;
}

function el(tag: string, attrs: Record<string, string | number>, content?: string): SVGElement {
  const e = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (content !== undefined) e.textContent = content;
  return e;
}

/** A short name for a key cap: a note's name, or a drum's first word or two. */
const capOf = (p: Played) => ('note' in p ? noteName(p.note) : p.name.length > 9 ? p.name.split(' ')[0] : p.name);

/** The keyboard for what the keys play now; `names` gives each key's printed character in the listener's layout. */
export function legend(played: ReadonlyMap<string, Played>, names: ReadonlyMap<string, string>): Legend {
  const svg = el('svg', {
    viewBox: `0 0 ${14.5 * (K + GAP) + 3 * (K + GAP) + 40} ${4 * (K + GAP) + 44}`,
    class: 'legend',
    role: 'img',
    'aria-label': 'The computer keyboard, with what each key plays',
  }) as SVGSVGElement;
  const caps = new Map<string, SVGElement>();
  const key = (code: string, label: string, x: number, y: number, what?: Played, action?: string) => {
    const cls = [
      'kbd',
      what ? 'mapped' : '',
      what && 'note' in what && isBlack(what.note) ? 'sharp' : '',
      action ? 'action' : '',
    ]
      .filter(Boolean).join(' ');
    const g = el('g', { class: cls, transform: `translate(${x} ${y})` });
    g.append(el('rect', { width: K, height: K, rx: 9 }));
    g.append(el('text', { x: 9, y: 19, class: 'cap' }, (names.get(code) ?? label).toUpperCase()));
    if (what) {
      // a long name set smaller, to fit its cap
      const cap = capOf(what);
      const size = Math.min(15, (15 * 7) / Math.max(7, cap.length));
      g.append(el('text', { x: K / 2, y: K - 14, class: 'plays', 'text-anchor': 'middle', 'font-size': size }, cap));
    }
    if (action) g.append(el('text', { x: K / 2, y: K - 14, class: 'plays', 'text-anchor': 'middle' }, action));
    caps.set(code, g);
    svg.append(g);
  };
  ROWS.forEach((row, r) => {
    row.forEach(([code, label], i) =>
      key(code, label, 20 + (INDENT[r] + i) * (K + GAP), 20 + r * (K + GAP), played.get(code))
    );
  });
  const ax = 20 + 14.5 * (K + GAP);
  const actions: Record<string, string> = {
    ArrowUp: 'higher',
    ArrowDown: 'lower',
    ArrowLeft: 'prev',
    ArrowRight: 'next',
  };
  for (const [code, label, cx, cy] of ARROWS) {
    key(code, label, ax + cx * (K + GAP), 20 + (cy - 1.5) * (K + GAP) + 30, undefined, actions[code]);
  }
  return {
    svg,
    press(code, down) {
      caps.get(code)?.classList.toggle('down', down);
    },
  };
}

/** The listener's layout, if the browser tells it: physical key to the character printed on it. */
export async function layoutNames(): Promise<ReadonlyMap<string, string>> {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  try {
    return (await kb?.getLayoutMap?.()) ?? new Map();
  } catch {
    return new Map();
  }
}
