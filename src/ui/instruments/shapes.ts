// Each instrument drawn as the thing a player touches: a keyboard, a fretboard, bars, tines, strings, holes, a kit,
// pads. What plays carries `data-play` (a MIDI note, or a hit id); `light()` shows what is sounding. Line art in the
// page's ink, lit in its accent: the colours are the stylesheet's (see instruments.html).

import type { InstrumentInfo } from '../../core/engine.ts';
import { isBlack, noteName, SPAN } from './keys.ts';

export interface Drawing {
  svg: SVGSVGElement;
  /**
   * Lights what plays `played` (a note or a hit id), or puts it out. Where one note has several places (a
   * fretboard's), `at` is the one played (a part's `data-at`); without it, the place a player would reach for.
   */
  light(played: string, on: boolean, at?: string): void;
}

/** What labels a part: the computer key that plays it, by note or hit id. */
export type Labels = ReadonlyMap<string, string>;

const NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number>;
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | null)[]) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const k of kids) if (k) e.append(k);
  return e;
}
const text = (x: number, y: number, s: string, cls: string, anchor = 'middle') =>
  el('text', { x, y, class: cls, 'text-anchor': anchor }, document.createTextNode(s));

/** A part that plays: `data-play` and an accessible name. */
function part<E extends SVGElement>(e: E, play: string | number, name: string): E {
  e.setAttribute('data-play', String(play));
  e.setAttribute('class', `${e.getAttribute('class') ?? ''} part`.trim());
  e.setAttribute('role', 'button');
  e.setAttribute('aria-label', name);
  return e;
}

function drawing(width: number, height: number, label: string, ...kids: Node[]): Drawing {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'instrument', role: 'group', 'aria-label': label });
  for (const k of kids) svg.append(k);
  return {
    svg,
    light(played, on) {
      for (
        const e of svg.querySelectorAll(`[data-play="${CSS.escape(played)}"], [data-lights="${CSS.escape(played)}"]`)
      ) {
        e.classList.toggle('lit', on);
      }
    },
  };
}

/** A drawing where a note lights one of its places: the one played, or the lowest on the neck. */
function placed(d: Drawing, lowest: ReadonlyMap<string, string>): Drawing {
  return {
    svg: d.svg,
    light(played, on, at) {
      const where = at ?? lowest.get(played);
      if (where) d.svg.querySelector(`[data-spot="${CSS.escape(where)}"]`)?.classList.toggle('lit', on);
    },
  };
}

const windowNotes = (inst: InstrumentInfo, base: number) =>
  Array.from({ length: SPAN + 1 }, (_, i) => base + i).filter((n) => n >= inst.range![0] && n <= inst.range![1]);
const keyOf = (labels: Labels, play: string | number) => labels.get(String(play)) ?? '';

// ------------------------------------------------------------------ keyboards

type Panel = 'piano' | 'keys' | 'organ' | 'synth';

/** A synth's waveform on its little screen, by instrument. */
function waveOf(id: string): string {
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = i / 60;
    const ph = (x * 3) % 1;
    const y = id.includes('saw') || id.includes('hook') || id === 'pad:wide' || id === 'pad:drop'
      ? 1 - 2 * ph
      : id === 'acid' || id.includes('pulse')
      ? (ph < 0.5 ? 0.8 : -0.8)
      : id === 'pluck' || id === 'pad:stab'
      ? Math.sin(2 * Math.PI * x * 3) * Math.exp(-3 * x)
      : Math.sin(2 * Math.PI * x * 3);
    pts.push(`${(x * 150).toFixed(1)},${(22 - 16 * y).toFixed(1)}`);
  }
  return pts.join(' ');
}

function keyboard(inst: InstrumentInfo, base: number, labels: Labels, panel: Panel): Drawing {
  const notes = windowNotes(inst, base);
  const whites = notes.filter((n) => !isBlack(n));
  const W = 1000 / whites.length;
  const top = { piano: 44, keys: 44, organ: 92, synth: 104 }[panel];
  const H = 250;
  const deco: Node[] = [];
  if (panel === 'piano') {
    deco.push(el('path', { d: `M0 ${top - 6} Q500 ${top - 40} 1000 ${top - 6}`, class: 'rim' }));
    deco.push(el('line', { x1: 0, y1: top - 4, x2: 1000, y2: top - 4, class: 'rim' }));
  } else if (panel === 'keys') {
    deco.push(el('rect', { x: 0, y: 4, width: 1000, height: top - 12, rx: 6, class: 'body' }));
    for (const x of [60, 110]) deco.push(el('circle', { cx: x, cy: top / 2 - 2, r: 11, class: 'knob' }));
  } else if (panel === 'organ') {
    // drawbars: nine stops in their slots, pulled out to different lengths
    deco.push(el('rect', { x: 0, y: 4, width: 1000, height: top - 14, rx: 8, class: 'body' }));
    [5, 8, 6, 3, 7, 2, 4, 1, 3].forEach((len, i) => {
      const x = 330 + i * 38;
      deco.push(el('rect', { x, y: 14, width: 22, height: top - 34, rx: 3, class: 'screen' }));
      deco.push(el('rect', { x: x - 4, y: 14 + (8 - len) * 5, width: 30, height: 16, rx: 3, class: 'knob' }));
    });
    for (const x of [60, 110, 890, 940]) {
      deco.push(el('circle', { cx: x, cy: (top - 10) / 2 + 4, r: 14, class: 'knob' }));
    }
  } else {
    deco.push(el('rect', { x: 0, y: 4, width: 1000, height: top - 14, rx: 8, class: 'body' }));
    deco.push(el('rect', { x: 40, y: 22, width: 170, height: 52, rx: 4, class: 'screen' }));
    deco.push(el('polyline', { points: waveOf(inst.id), class: 'wave', transform: 'translate(50 26)' }));
    for (let i = 0; i < 6; i++) {
      const cx = 300 + i * 110;
      deco.push(el('circle', { cx, cy: 48, r: 18, class: 'knob' }));
      deco.push(
        el('line', { x1: cx, y1: 48, x2: cx + 12 * Math.cos(2 + i), y2: 48 - 12 * Math.sin(2 + i), class: 'rim' }),
      );
    }
  }
  const keys: Node[] = [];
  whites.forEach((n, i) => {
    const x = i * W;
    keys.push(part(el('rect', { x: x + 1, y: top, width: W - 2, height: H, rx: 4, class: 'white' }), n, noteName(n)));
    keys.push(text(x + W / 2, top + H - 14, keyOf(labels, n), 'key-label on-white'));
    if (n % 12 === 0) keys.push(text(x + W / 2, top + H - 38, noteName(n), 'note-label on-white'));
  });
  notes.filter(isBlack).forEach((n) => {
    const left = whites.findIndex((w) => w > n);
    const x = left * W - (W * 0.62) / 2;
    keys.push(
      part(el('rect', { x, y: top, width: W * 0.62, height: H * 0.62, rx: 3, class: 'black' }), n, noteName(n)),
    );
    keys.push(text(x + (W * 0.62) / 2, top + H * 0.62 - 12, keyOf(labels, n), 'key-label on-black'));
  });
  return drawing(1000, top + H + 6, `${inst.name}, a keyboard`, ...deco, ...keys);
}

// ------------------------------------------------------------------ fretboards

function fretboard(inst: InstrumentInfo, tuning: readonly number[]): Drawing {
  const [lo, hi] = inst.range!;
  const FRETS = 12;
  const nut = 90;
  const end = 985;
  const x = (f: number) => nut + ((end - nut) * (1 - 2 ** (-f / 12))) / 0.5;
  const yTop = 40;
  const yBottom = tuning.length === 4 ? 190 : 230;
  const gap = (yBottom - yTop) / (tuning.length - 1);
  // the lowest string at the bottom, as the player sees it
  const y = (s: number) => yBottom - s * gap;
  const board: Node[] = [
    el('rect', { x: nut, y: yTop - 18, width: end - nut, height: yBottom - yTop + 36, class: 'body' }),
  ];
  for (const f of [3, 5, 7, 9]) {
    board.push(el('circle', { cx: (x(f - 1) + x(f)) / 2, cy: (yTop + yBottom) / 2, r: 7, class: 'inlay' }));
  }
  for (const dy of [-gap, gap]) {
    board.push(el('circle', { cx: (x(11) + x(12)) / 2, cy: (yTop + yBottom) / 2 + dy, r: 7, class: 'inlay' }));
  }
  for (let f = 1; f <= FRETS; f++) {
    board.push(el('line', { x1: x(f), y1: yTop - 18, x2: x(f), y2: yBottom + 18, class: 'fret' }));
  }
  board.push(el('line', { x1: nut, y1: yTop - 18, x2: nut, y2: yBottom + 18, class: 'nut' }));
  for (const f of [3, 5, 7, 9, 12]) board.push(text((x(f - 1) + x(f)) / 2, yBottom + 44, String(f), 'note-label'));
  const cells: Node[] = [];
  const dots: Node[] = [];
  // where each note is played when a key plays it: its lowest fret, as a player stays near the nut
  const lowest = new Map<string, { at: string; fret: number }>();
  tuning.forEach((open, s) => {
    board.push(
      el('line', {
        x1: 40,
        y1: y(s),
        x2: end,
        y2: y(s),
        class: 'string',
        'stroke-width': 1 + (tuning.length - 1 - s) * 0.45,
      }),
    );
    board.push(text(14, y(s) + 6, noteName(open).replace(/\d/, ''), 'note-label', 'start'));
    for (let f = 0; f <= FRETS; f++) {
      const n = open + f;
      if (n < lo || n > hi) continue;
      const x0 = f ? x(f - 1) : 40;
      const cx = f ? (x(f - 1) + x(f)) / 2 : (nut + 40) / 2;
      cells.push(
        part(
          el('rect', {
            x: x0,
            y: y(s) - gap / 2,
            width: x(f) - x0 || nut - 40,
            height: gap,
            class: 'cell',
            'data-at': `${s}:${f}`,
          }),
          n,
          `${noteName(n)}, fret ${f}`,
        ),
      );
      dots.push(el('circle', { cx, cy: y(s), r: 11, class: 'dot', 'data-spot': `${s}:${f}` }));
      const known = lowest.get(String(n));
      if (!known || f < known.fret) lowest.set(String(n), { at: `${s}:${f}`, fret: f });
    }
  });
  return placed(
    drawing(1000, yBottom + 56, `${inst.name}, a fretboard`, ...board, ...cells, ...dots),
    new Map([...lowest].map(([n, x]) => [n, x.at])),
  );
}

// ------------------------------------------------------------------ bars, tines, tubes, strings, holes

function bars(inst: InstrumentInfo, base: number, labels: Labels, vibes: boolean): Drawing {
  const notes = windowNotes(inst, base);
  const whites = notes.filter((n) => !isBlack(n));
  const W = 1000 / whites.length;
  const tubes: Node[] = [];
  const out: Node[] = [];
  const len = (n: number) => 210 - ((n - notes[0]) / Math.max(1, notes.length - 1)) * 90;
  const place = (n: number): [number, number, number] => {
    const i = whites.indexOf(n);
    if (i >= 0) return [i * W, 250, W];
    const left = whites.findIndex((w) => w > n);
    return [left * W - W / 2, 110, W];
  };
  for (const n of notes) {
    const [x, cy, w] = place(n);
    const h = len(n) * (isBlack(n) ? 0.62 : 0.72);
    // the resonator under the bar: shorter as the note climbs
    tubes.push(el('rect', { x: x + w * 0.3, y: cy + h / 2, width: w * 0.4, height: 40 - (h - 90) / 6, class: 'tube' }));
    if (vibes) tubes.push(el('circle', { cx: x + w / 2, cy: cy + h / 2 + 8, r: w * 0.14, class: 'knob' }));
    out.push(
      part(
        el('rect', { x: x + 4, y: cy - h / 2, width: w - 8, height: h, rx: 5, class: vibes ? 'metal' : 'wood' }),
        n,
        noteName(n),
      ),
    );
    for (const k of [0.22, 0.78]) {
      out.push(el('circle', { cx: x + w / 2, cy: cy - h / 2 + h * k, r: 2.5, class: 'node' }));
    }
    out.push(text(x + w / 2, cy + (isBlack(n) ? -h / 2 - 8 : h / 2 + 60), keyOf(labels, n), 'key-label'));
  }
  return drawing(1000, 400, `${inst.name}, bars`, ...tubes, ...out);
}

function kalimba(inst: InstrumentInfo, base: number, labels: Labels): Drawing {
  // a kalimba's tines are the scale: the lowest in the middle, climbing outwards left and right by turns
  const tines = windowNotes(inst, base).filter((n) => !isBlack(n));
  const slots = tines.map((_, i) => (i % 2 ? -1 : 1) * Math.ceil(i / 2));
  const step = 44;
  const out: Node[] = [
    el('path', { d: 'M140 120 Q500 70 860 120 L900 400 Q500 430 100 400 Z', class: 'body' }),
    el('circle', { cx: 500, cy: 362, r: 26, class: 'hole' }),
    el('line', { x1: 120, y1: 310, x2: 880, y2: 310, class: 'bridge' }),
  ];
  tines.forEach((n, i) => {
    const cx = 500 + slots[i] * step;
    const h = 210 - i * 8;
    out.push(
      part(el('rect', { x: cx - 14, y: 310 - h, width: 28, height: h + 26, rx: 13, class: 'metal' }), n, noteName(n)),
    );
    out.push(text(cx, 310 - h - 10, keyOf(labels, n), 'key-label'));
    if (n % 12 === 0) out.push(text(cx, 300, noteName(n), 'note-label on-metal'));
  });
  return drawing(1000, 440, `${inst.name}, tines`, ...out);
}

function chimes(inst: InstrumentInfo, base: number, labels: Labels): Drawing {
  const notes = windowNotes(inst, base);
  const W = 1000 / notes.length;
  const out: Node[] = [el('rect', { x: 0, y: 20, width: 1000, height: 12, rx: 6, class: 'body' })];
  notes.forEach((n, i) => {
    const x = i * W + W / 2;
    const h = 300 - i * (170 / notes.length);
    out.push(el('line', { x1: x, y1: 32, x2: x, y2: 46, class: 'rim' }));
    out.push(
      part(
        el('rect', {
          x: x - W * 0.32,
          y: 46,
          width: W * 0.64,
          height: h,
          rx: W * 0.3,
          class: isBlack(n) ? 'metal dark' : 'metal',
        }),
        n,
        noteName(n),
      ),
    );
    out.push(el('rect', { x: x - W * 0.36, y: 46, width: W * 0.72, height: 10, rx: 3, class: 'cap' }));
    out.push(text(x, 46 + h + 22, keyOf(labels, n), 'key-label'));
  });
  return drawing(1000, 400, `${inst.name}, tubes`, ...out);
}

function harp(inst: InstrumentInfo, base: number, labels: Labels): Drawing {
  const notes = windowNotes(inst, base);
  const x0 = 170;
  const x1 = 900;
  const board = (x: number) => 400 - ((x - x0) / (x1 - x0)) * 210;
  const neck = (x: number) => 60 + 70 * Math.sin(((x - x0) / (x1 - x0)) * Math.PI * 0.9);
  const out: Node[] = [
    el('line', { x1: 120, y1: 430, x2: 120, y2: 40, class: 'column' }),
    el('path', {
      d: Array.from({ length: 25 }, (_, i) => {
        const x = 120 + ((x1 + 40 - 120) * i) / 24;
        return `${i ? 'L' : 'M'}${x.toFixed(0)} ${neck(x).toFixed(0)}`;
      }).join(' '),
      class: 'column thin',
    }),
    el('line', { x1: x0 - 30, y1: board(x0 - 30), x2: x1 + 40, y2: board(x1 + 40), class: 'column' }),
  ];
  notes.forEach((n, i) => {
    const x = x0 + ((x1 - x0) * i) / Math.max(1, notes.length - 1);
    const pc = ((n % 12) + 12) % 12;
    // a harp's C strings are red and its F strings blue, so a player can find their place
    const cls = pc === 0
      ? 'harp-string c'
      : pc === 5
      ? 'harp-string f'
      : isBlack(n)
      ? 'harp-string sharp'
      : 'harp-string';
    out.push(el('line', { x1: x, y1: neck(x) + 6, x2: x, y2: board(x) - 4, class: cls, 'data-lights': n }));
    out.push(
      part(el('rect', { x: x - 10, y: neck(x), width: 20, height: board(x) - neck(x), class: 'hit' }), n, noteName(n)),
    );
    out.push(text(x, board(x) + 34, keyOf(labels, n), 'key-label small'));
  });
  return drawing(1000, 450, `${inst.name}, strings`, ...out);
}

function flute(inst: InstrumentInfo, base: number, labels: Labels): Drawing {
  const notes = windowNotes(inst, base);
  const out: Node[] = [
    el('rect', { x: 20, y: 90, width: 960, height: 46, rx: 23, class: 'metal' }),
    el('ellipse', { cx: 70, cy: 113, rx: 14, ry: 9, class: 'hole' }),
  ];
  const whites = notes.filter((n) => !isBlack(n));
  const step = 800 / Math.max(1, whites.length - 1);
  notes.forEach((n) => {
    const i = whites.indexOf(n);
    const x = 150 + (i >= 0 ? i : whites.findIndex((w) => w > n) - 0.5) * step;
    const r = isBlack(n) ? 8 : 13;
    out.push(part(el('circle', { cx: x, cy: isBlack(n) ? 100 : 113, r, class: 'pad' }), n, noteName(n)));
    out.push(text(x, isBlack(n) ? 76 : 170, keyOf(labels, n), 'key-label'));
  });
  return drawing(1000, 200, `${inst.name}, tone holes`, ...out);
}

function sax(inst: InstrumentInfo, base: number, labels: Labels): Drawing {
  const notes = windowNotes(inst, base);
  // the body as a curve from the bell (bottom right, the lowest notes) up to the neck (top left, the highest)
  const P = [[860, 110], [880, 360], [620, 440], [520, 260], [420, 60]] as const;
  const at = (u: number): [number, number] => {
    // a Catmull-Rom path through P
    const seg = Math.min(P.length - 2, Math.floor(u * (P.length - 1)));
    const t = u * (P.length - 1) - seg;
    const p0 = P[Math.max(0, seg - 1)], p1 = P[seg], p2 = P[seg + 1], p3 = P[Math.min(P.length - 1, seg + 2)];
    const c = (a: number, b: number, c2: number, d: number) =>
      0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t * t + (-a + 3 * b - 3 * c2 + d) * t * t * t);
    return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
  };
  const path = Array.from({ length: 41 }, (_, i) => at(i / 40)).map(([x, y], i) =>
    `${i ? 'L' : 'M'}${x.toFixed(0)} ${y.toFixed(0)}`
  ).join(' ');
  const out: Node[] = [
    el('path', { d: path, class: 'sax-body' }),
    el('path', { d: 'M860 110 Q870 40 930 20 L790 30 Q840 50 845 110 Z', class: 'sax-bell' }),
    el('path', { d: 'M420 60 Q360 20 300 40 L240 60', class: 'column thin' }),
  ];
  notes.forEach((n, i) => {
    const u = 0.06 + (0.9 * i) / Math.max(1, notes.length - 1);
    const [x, y] = at(u);
    out.push(part(el('circle', { cx: x, cy: y, r: isBlack(n) ? 9 : 13, class: 'pad' }), n, noteName(n)));
    // the label outside the curve, along its normal, away from the middle of its bow
    const [ax, ay] = at(Math.max(0, u - 0.01));
    const [bx, by] = at(Math.min(1, u + 0.01));
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
    if (Math.hypot(x + nx - 700, y + ny - 300) < Math.hypot(x - 700, y - 300)) [nx, ny] = [-nx, -ny];
    out.push(text(x + 52 * nx, y + 52 * ny + 7, keyOf(labels, n), 'key-label small'));
  });
  return drawing(1000, 470, `${inst.name}, keys along its body`, ...out);
}

function choir(inst: InstrumentInfo, base: number, labels: Labels): Drawing {
  const notes = windowNotes(inst, base);
  const vowel = inst.id.startsWith('choir:') ? inst.id.slice(6) : 'm';
  // three rows on risers, the lowest voices at the front
  const rows = [notes.slice(0, 12), notes.slice(12, 24), notes.slice(24)];
  const out: Node[] = [];
  rows.slice().reverse().forEach((row, r) => {
    const ri = rows.length - 1 - r;
    const y = 330 - ri * 110;
    row.forEach((n, i) => {
      const x = 500 + (i - (row.length - 1) / 2) * 74;
      const yy = y - 18 * Math.cos(((i - (row.length - 1) / 2) / 8) * Math.PI);
      out.push(el('path', { d: `M${x - 30} ${yy + 62} Q${x} ${yy + 20} ${x + 30} ${yy + 62}`, class: 'body' }));
      out.push(part(el('circle', { cx: x, cy: yy, r: 25, class: 'face' }), n, noteName(n)));
      for (const dx of [-8, 8]) out.push(el('circle', { cx: x + dx, cy: yy - 6, r: 2.6, class: 'eye' }));
      const mouth = vowel === 'a'
        ? el('ellipse', { cx: x, cy: yy + 10, rx: 5, ry: 7, class: 'mouth', 'data-lights': n })
        : vowel === 'o'
        ? el('circle', { cx: x, cy: yy + 9, r: 6, class: 'mouth', 'data-lights': n })
        : vowel === 'u'
        ? el('circle', { cx: x, cy: yy + 9, r: 3.5, class: 'mouth', 'data-lights': n })
        : el('line', { x1: x - 7, y1: yy + 9, x2: x + 7, y2: yy + 9, class: 'mouth line', 'data-lights': n });
      out.push(mouth);
      out.push(text(x, yy - 32, keyOf(labels, n), 'key-label'));
    });
  });
  return drawing(1000, 420, `${inst.name}, singers`, ...out);
}

// ------------------------------------------------------------------ drums and pads

const KIT: Record<string, [cx: number, cy: number, r: number, kind: 'drum' | 'cymbal' | 'kick']> = {
  kick: [500, 300, 110, 'kick'],
  snare: [330, 300, 70, 'drum'],
  hat: [180, 250, 68, 'cymbal'],
  open: [95, 120, 58, 'cymbal'],
  tomHi: [420, 150, 55, 'drum'],
  tomMid: [580, 150, 60, 'drum'],
  tomLo: [710, 310, 82, 'drum'],
  ride: [840, 160, 96, 'cymbal'],
  crash: [255, 95, 78, 'cymbal'],
};

function kit(inst: InstrumentInfo, labels: Labels): Drawing {
  const out: Node[] = [];
  for (const h of inst.hits ?? []) {
    const [cx, cy, r, kind] = KIT[h.id] ?? [500, 200, 50, 'drum'];
    out.push(part(el('circle', { cx, cy, r, class: kind === 'cymbal' ? 'cymbal' : 'drumhead' }), h.id, h.name));
    if (kind === 'cymbal') {
      out.push(el('circle', { cx, cy, r: r * 0.62, class: 'groove' }));
    } else out.push(el('circle', { cx, cy, r: r * 0.86, class: 'groove' }));
    if (h.id === 'snare') {
      out.push(
        el('path', { d: `M${cx - r * 0.5} ${cy + 10} h${r} M${cx - r * 0.5} ${cy + 20} h${r}`, class: 'groove' }),
      );
    }
    if (kind === 'kick') {
      out.push(el('rect', { x: cx - 26, y: cy + r - 4, width: 52, height: 40, rx: 6, class: 'body' }));
    }
    out.push(
      text(cx, cy - 2, h.name, 'hit-label small on-head'),
      text(cx, cy + 24, keyOf(labels, h.id), 'key-label on-head'),
    );
  }
  return drawing(1000, 440, `${inst.name}, from above`, ...out);
}

function pads(inst: InstrumentInfo, labels: Labels, style: 'machine' | 'sampler' | 'fx'): Drawing {
  const hits = inst.hits ?? [];
  const cols = 4;
  const rows = Math.ceil(hits.length / cols);
  const S = 150;
  const gap = 18;
  const x0 = 500 - (cols * S + (cols - 1) * gap) / 2;
  const top = 86;
  const out: Node[] = [
    el('rect', {
      x: x0 - 30,
      y: 10,
      width: cols * S + (cols - 1) * gap + 60,
      height: top + rows * (S + gap) + 16,
      rx: 16,
      class: 'body',
    }),
    el('rect', { x: x0, y: 26, width: 220, height: 40, rx: 4, class: 'screen' }),
    text(x0 + 110, 52, inst.name, 'screen-label'),
  ];
  for (let i = 0; i < 3; i++) out.push(el('circle', { cx: x0 + 330 + i * 70, cy: 46, r: 16, class: 'knob' }));
  hits.forEach((h, i) => {
    const x = x0 + (i % cols) * (S + gap);
    const y = top + Math.floor(i / cols) * (S + gap);
    out.push(
      part(
        el('rect', { x, y, width: S, height: S, rx: style === 'fx' ? 30 : 12, class: `pad-square ${style}` }),
        h.id,
        h.name,
      ),
    );
    out.push(
      text(x + S / 2, y + S / 2, h.name, 'hit-label'),
      text(x + S / 2, y + S / 2 + 26, keyOf(labels, h.id), 'key-label'),
    );
  });
  return drawing(1000, top + rows * (S + gap) + 40, `${inst.name}, pads`, ...out);
}

function hands(inst: InstrumentInfo, labels: Labels): Drawing {
  const out: Node[] = [];
  const shape: Record<string, (x: number, y: number) => SVGElement> = {
    conga: (x, y) => el('circle', { cx: x, cy: y, r: 95, class: 'drumhead' }),
    congaHi: (x, y) => el('circle', { cx: x, cy: y, r: 80, class: 'drumhead' }),
    bongo: (x, y) =>
      el('path', {
        d: `M${x - 90} ${y} a55 55 0 1 0 110 0 a55 55 0 1 0 -110 0 M${
          x + 25
        } ${y} a45 45 0 1 0 90 0 a45 45 0 1 0 -90 0`,
        class: 'drumhead',
      }),
    cowbell: (x, y) =>
      el('path', {
        d: `M${x - 40} ${y - 80} L${x + 40} ${y - 80} L${x + 70} ${y + 80} L${x - 70} ${y + 80} Z`,
        class: 'metal',
      }),
    shaker: (x, y) => el('ellipse', { cx: x, cy: y, rx: 44, ry: 80, class: 'wood' }),
  };
  (inst.hits ?? []).forEach((h, i) => {
    const x = 110 + i * 195;
    const y = 200;
    out.push(part((shape[h.id] ?? shape.conga)(x, y), h.id, h.name));
    if (h.id.startsWith('conga')) {
      out.push(el('circle', { cx: x, cy: y, r: h.id === 'conga' ? 80 : 66, class: 'groove' }));
    }
    out.push(text(x, y + 124, h.name, 'hit-label'), text(x, y + 150, keyOf(labels, h.id), 'key-label'));
  });
  return drawing(1000, 370, `${inst.name}, from above`, ...out);
}

/** An instrument drawn with its window of notes (from `base`) or its hits, labelled with the keys that play them. */
export function draw(inst: InstrumentInfo, base: number, labels: Labels): Drawing {
  switch (inst.family) {
    case 'piano':
      return keyboard(inst, base, labels, 'piano');
    case 'keys':
      return keyboard(inst, base, labels, 'keys');
    case 'organ':
      return keyboard(inst, base, labels, 'organ');
    case 'mallets':
      return bars(inst, base, labels, inst.id.endsWith('vibes'));
    case 'kalimba':
      return kalimba(inst, base, labels);
    case 'bells':
      return chimes(inst, base, labels);
    case 'guitar':
      return fretboard(inst, [40, 45, 50, 55, 59, 64]);
    case 'bass':
      return fretboard(inst, [28, 33, 38, 43]);
    case 'harp':
      return harp(inst, base, labels);
    case 'winds':
      return inst.id.endsWith('sax') ? sax(inst, base, labels) : flute(inst, base, labels);
    case 'voices':
      return choir(inst, base, labels);
    case 'drums':
      return inst.id === 'kit:acoustic'
        ? kit(inst, labels)
        : pads(inst, labels, inst.id === 'kit:lofi' ? 'sampler' : 'machine');
    case 'percussion':
      return hands(inst, labels);
    case 'effects':
      return pads(inst, labels, 'fx');
    default:
      return keyboard(inst, base, labels, 'synth');
  }
}
