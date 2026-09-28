// The instruments page: every instrument the engine synthesizes, drawn, and playable with the mouse, a finger or the
// computer keyboard (see keys.ts), with a legend of what each key plays. A chosen instrument's notes are rendered
// in the background, so they play at once.

import type { Engine, InstrumentFamily, InstrumentInfo } from '../../core/engine.ts';
import { NotePlayer, type Voice } from '../../audio/notes.ts';
import { keymap, noteName, type Played, shifts, SPAN, windowBase } from './keys.ts';
import { layoutNames, type Legend, legend } from './legend.ts';
import { draw, type Drawing } from './shapes.ts';

/** The list's groups, in order, each with the page's hue while one of its instruments is out. */
const GROUPS: readonly (readonly [string, readonly InstrumentFamily[], number])[] = [
  ['Keyboards', ['piano', 'keys', 'organ'], 285],
  ['Mallets and bells', ['mallets', 'kalimba', 'bells'], 60],
  ['Guitars and harp', ['guitar', 'harp'], 30],
  ['Bass', ['bass', 'synth bass'], 10],
  ['Winds and voices', ['winds', 'voices'], 160],
  ['Synths', ['synths'], 210],
  ['Pads', ['pads'], 250],
  ['Drums and percussion', ['drums', 'percussion'], 80],
  ['Effects', ['effects'], 330],
];

/** Struck and plucked things ring on when let go; keys, breath and bows stop. */
const RINGS: ReadonlySet<InstrumentFamily> = new Set([
  'mallets',
  'kalimba',
  'bells',
  'guitar',
  'harp',
  'drums',
  'percussion',
  'effects',
]);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function startInstruments(engine: Engine, workerUrl: URL, workers: number): void {
  const all = engine.instruments ?? [];
  if (!all.length) return;
  const player = new NotePlayer(engine.version, workerUrl, workers);
  const fromHash = () => all.find((x) => x.id === decodeURIComponent(location.hash.slice(1)));
  let current: InstrumentInfo = fromHash() ?? all[0];
  let shift = 0;
  let names: ReadonlyMap<string, string> = new Map();
  let keys = new Map<string, Played>();
  let shape: Drawing | null = null;
  let board: Legend | null = null;
  /** What is sounding, by source: a key (`key:KeyZ`) or a pointer (`ptr:1`). */
  const sounding = new Map<string, { voice: Voice; played: string; at?: string }>();
  const buttons = new Map<string, HTMLButtonElement>();

  // ------------------------------------------------------------------ the list
  const list = $('list');
  for (const [title, families] of GROUPS) {
    const members = all.filter((x) => families.includes(x.family));
    if (!members.length) continue;
    const h = document.createElement('h2');
    h.textContent = title;
    const ul = document.createElement('ul');
    for (const inst of members) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = inst.name;
      b.addEventListener('click', () => choose(inst));
      buttons.set(inst.id, b);
      li.append(b);
      ul.append(li);
    }
    list.append(h, ul);
  }

  // ------------------------------------------------------------------ choosing and drawing
  const played = (p: Played) => ('note' in p ? String(p.note) : p.hit);
  const hueOf = (inst: InstrumentInfo) => GROUPS.find(([, f]) => f.includes(inst.family))?.[2] ?? 285;

  function choose(inst: InstrumentInfo, keepShift = false): void {
    releaseAll();
    current = inst;
    if (!keepShift) shift = 0;
    history.replaceState(null, '', `#${encodeURIComponent(inst.id)}`);
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === inst.id));
    document.documentElement.style.setProperty('--h', String(hueOf(inst)));
    render();
    prepare();
  }

  function render(): void {
    const base = current.range ? windowBase(current.range, shift) : 0;
    keys = keymap(current, base);
    const labels = new Map<string, string>();
    for (const [code, p] of keys) {
      if (!labels.has(played(p))) {
        labels.set(played(p), (names.get(code) ?? code.replace(/^(Key|Digit)/, '')).toUpperCase());
      }
    }
    shape = draw(current, base, labels);
    board = legend(keys, names);
    $('drawing').replaceChildren(shape.svg);
    $('legend').replaceChildren(board.svg);
    $('name').textContent = current.name;
    $('about').textContent = current.about;
    const octave = $('octave');
    octave.hidden = !current.range;
    if (current.range) {
      const [down, up] = shifts(current.range);
      const notes = [...keys.values()].map((p) => ('note' in p ? p.note : 0));
      $('span').textContent = `${noteName(Math.min(...notes))} to ${noteName(Math.max(...notes))}`;
      $<HTMLButtonElement>('lower').disabled = shift <= down;
      $<HTMLButtonElement>('higher').disabled = shift >= up;
    }
  }

  function prepare(): void {
    const notes: (number | string)[] = current.range
      ? Array.from({ length: SPAN + 1 }, (_, i) => windowBase(current.range!, shift) + i)
        .filter((n) => n >= current.range![0] && n <= current.range![1])
      : (current.hits ?? []).map((h) => h.id);
    const status = $('status');
    const id = current.id;
    let done = 0;
    status.textContent = `Preparing ${notes.length} sounds`;
    player.prepare(id, notes, () => {
      if (current.id !== id) return;
      done++;
      status.textContent = done < notes.length ? `Preparing: ${done} of ${notes.length} ready` : 'Ready to play';
    });
  }

  // ------------------------------------------------------------------ playing
  /** `at`: the place on the drawing it was played at, where a note has several (a fretboard's). */
  function play(source: string, what: string, at?: string): void {
    stop(source);
    const note = current.range ? Number(what) : what;
    sounding.set(source, { voice: player.play(current.id, note, RINGS.has(current.family)), played: what, at });
    shape?.light(what, true, at);
  }

  function stop(source: string): void {
    const s = sounding.get(source);
    if (!s) return;
    sounding.delete(source);
    s.voice.release();
    if (![...sounding.values()].some((x) => x.played === s.played && x.at === s.at)) {
      shape?.light(s.played, false, s.at);
    }
  }

  function releaseAll(): void {
    for (const source of [...sounding.keys()]) stop(source);
    for (const code of keys.keys()) board?.press(code, false);
  }

  function move(octaves: number): void {
    if (!current.range) return;
    const [down, up] = shifts(current.range);
    const next = Math.max(down, Math.min(up, shift + octaves));
    if (next === shift) return;
    releaseAll();
    shift = next;
    render();
    prepare();
  }

  const step = (by: number) => choose(all[(all.indexOf(current) + by + all.length) % all.length]);

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = (e.target as HTMLElement).tagName === 'BUTTON';
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!e.repeat) move(e.key === 'ArrowUp' ? 1 : -1);
      board?.press(e.code, true);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!e.repeat) step(e.key === 'ArrowRight' ? 1 : -1);
      board?.press(e.code, true);
      return;
    }
    const p = keys.get(e.code);
    if (!p || (onButton && (e.key === ' ' || e.key === 'Enter'))) return;
    e.preventDefault();
    if (e.repeat) return;
    play(`key:${e.code}`, played(p));
    board?.press(e.code, true);
  });
  addEventListener('keyup', (e) => {
    stop(`key:${e.code}`);
    board?.press(e.code, false);
  });
  addEventListener('blur', releaseAll);

  // the mouse or a finger: press a part to play it, slide across the drawing to play what you pass
  const partAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-play]') ?? null;
  const pointing = new Map<number, Element>();
  const stage = $('drawing');
  const press = (e: PointerEvent, part: Element) => {
    pointing.set(e.pointerId, part);
    play(`ptr:${e.pointerId}`, part.getAttribute('data-play')!, part.getAttribute('data-at') ?? undefined);
  };
  stage.addEventListener('pointerdown', (e) => {
    const part = partAt(e.clientX, e.clientY);
    if (!part) return;
    e.preventDefault();
    press(e, part);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointing.has(e.pointerId)) return;
    const part = partAt(e.clientX, e.clientY);
    if (part && part !== pointing.get(e.pointerId)) press(e, part);
  });
  const up = (e: PointerEvent) => {
    if (!pointing.delete(e.pointerId)) return;
    stop(`ptr:${e.pointerId}`);
  };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);

  $('lower').addEventListener('click', () => move(-1));
  $('higher').addEventListener('click', () => move(1));
  addEventListener('hashchange', () => {
    const inst = fromHash();
    if (inst && inst !== current) choose(inst);
  });

  choose(current);
  // label the keys as they are printed on this keyboard, once the browser says
  void layoutNames().then((n) => {
    if (!n.size) return;
    names = n;
    render();
  });
}
