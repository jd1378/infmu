// The page: now-playing details, the dial, the player bar, dialogs and keyboard. It talks to the music only
// through PlayerPort and to the song plan through the domain.

import { Song } from '../core/plan.ts';
import type { PlayerPort } from '../core/player.ts';
import { displaySeed, randomSeedPhrase, roman } from '../core/seed.ts';
import { STYLE_IDS, STYLES } from '../core/styles.ts';
import { keyName, MODE_LABEL, noteName } from '../core/theory.ts';
import type { Movement, Score, StyleId } from '../core/types.ts';
import { Dial } from './dial.ts';
import { clock, ROLE_LABEL, styleLabel } from './format.ts';
import { bindMediaSession } from './media.ts';
import { recentSeeds, rememberSeed, storedVolume, storeVolume } from './storage.ts';
import { applyTint, tintFor } from './theme.ts';
import { hashFor, readHash } from './url.ts';

const PLAY_GLYPH = 'M7 4.5v15l13-7.5z';
const PAUSE_GLYPH = 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z';
const SLEEP_STEPS = [null, 15, 30, 60, 90] as const;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function startApp(makePlayer: (song: Song) => PlayerPort): void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const initial = readHash();
  let song = new Song(initial.seed ?? randomSeedPhrase(), initial.styles);
  const player = makePlayer(song);
  const start = initial.movement !== undefined
    ? song.locate(initial.movement, initial.time ?? 0)
    : { index: 0, offset: 0 };
  player.load(song, start.index, start.offset);
  player.setVolume(storedVolume() ?? 0.8);
  history.replaceState(
    null,
    '',
    hashFor({ seed: song.phrase, styles: [...song.styles], movement: song.section(start.index).movement.index }),
  );

  const dial = new Dial($<HTMLCanvasElement>('dial'), reduced);
  const el = {
    seed: $('seed'),
    title: $('mv-title'),
    style: $('f-style'),
    key: $('f-key'),
    tempo: $('f-tempo'),
    section: $('f-section'),
    chords: $('chords'),
    next: $('next'),
    status: $('status'),
    bigPlay: $<HTMLButtonElement>('big-play'),
    play: $<HTMLButtonElement>('play'),
    glyph: document.querySelector<SVGPathElement>('#play .glyph')!,
    now: $('t-now'),
    end: $('t-end'),
    track: $('track'),
    segments: $('segments'),
    repeat: $<HTMLButtonElement>('repeat'),
    sleep: $<HTMLButtonElement>('sleep'),
    vol: $<HTMLInputElement>('vol'),
    mute: $<HTMLButtonElement>('mute'),
    toast: $('toast'),
    download: $<HTMLButtonElement>('download'),
  };
  el.vol.value = String(player.volume);
  // the handlers are hoisted function declarations below
  const media = bindMediaSession({
    play: () => void player.play(),
    pause: () => player.pause(),
    prev,
    next,
    seek: (s) => seekMovement(player.position().score.movement.index, s),
    skip: (d) => skip(d),
  });

  // ------------------------------------------------------------------ now playing

  let shownIndex = -1;
  let shownMovement: Movement | null = null;
  let shownChord = -1;
  let chordChips: number[] = []; // chord span index -> chip index
  let segFills: HTMLElement[] = [];
  let segEls: HTMLElement[] = [];

  function showSection(score: Score): void {
    wake();
    shownIndex = score.index;
    const mv = score.movement;
    if (mv !== shownMovement) showMovement(mv);
    el.section.textContent = `${ROLE_LABEL[score.section.role]}, ${score.local + 1} of ${mv.sections.length}`;
    // the progression once (not every repeat of it), with a chord held over bars merged into one chip
    const names = score.chords.map((c) => c.name);
    const period = [...names.keys()].slice(1).find((p) => names.every((n, i) => n === names[i % p])) ?? names.length;
    el.chords.replaceChildren();
    const cycle: number[] = [];
    names.slice(0, period).forEach((n, i) => {
      if (i === 0 || n !== names[i - 1]) {
        const li = document.createElement('li');
        li.textContent = n;
        el.chords.append(li);
      }
      cycle.push(el.chords.children.length - 1);
    });
    chordChips = names.map((_, i) => cycle[i % period]);
    shownChord = -1;
    segEls.forEach((s, i) => s.classList.toggle('hot', i === score.local));
  }

  function showMovement(mv: Movement): void {
    shownMovement = mv;
    el.seed.textContent = displaySeed(song.phrase);
    el.title.querySelector('.num')!.textContent = `${roman(mv.index + 1)}.`;
    el.title.querySelector('.name')!.textContent = mv.title;
    el.style.textContent = styleLabel(mv.style);
    el.key.textContent = keyName(mv.key);
    el.tempo.textContent = `${mv.bpm} BPM${mv.swing > 0.05 ? ', swung' : ''}`;
    const nx = song.movement(mv.index + 1);
    el.next.replaceChildren('Up next: ');
    const b = document.createElement('b');
    b.textContent = `${roman(nx.index + 1)}. ${nx.title}`;
    el.next.append(b, `, ${STYLES[nx.style].genre} in ${noteName(nx.key.tonic, nx.key)} ${MODE_LABEL[nx.key.mode]}`);
    const tint = tintFor(mv.key);
    applyTint(tint);
    dial.setTint(tint);
    document.title = `${roman(mv.index + 1)}. ${mv.title} | infmu`;
    buildSegments(mv);
    el.end.textContent = clock(mv.duration);
    history.replaceState(null, '', hashFor({ seed: song.phrase, styles: [...song.styles], movement: mv.index }));
    rememberSeed(song.phrase);
    // the dial snapshot becomes the cover art once a few frames have been drawn in the new key
    setTimeout(() => {
      const art = (document.getElementById('dial') as HTMLCanvasElement).toDataURL('image/png');
      media.meta(
        `${roman(mv.index + 1)}. ${mv.title}`,
        `infmu, seed ${song.phrase}`,
        `${STYLES[mv.style].name} in ${keyName(mv.key)}`,
        art,
      );
    }, 1500);
  }

  function buildSegments(mv: Movement): void {
    el.segments.replaceChildren();
    segFills = [];
    segEls = [];
    mv.sections.forEach((s) => {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.style.flex = `${s.bars} 1 0`;
      seg.title = ROLE_LABEL[s.role];
      const fill = document.createElement('div');
      fill.className = 'fill';
      const label = document.createElement('span');
      label.className = 'seg-label';
      label.textContent = ROLE_LABEL[s.role];
      seg.append(fill);
      el.segments.append(seg);
      seg.append(label);
      segFills.push(fill);
      segEls.push(seg);
    });
    el.track.setAttribute('aria-valuemax', String(Math.round(mv.duration)));
    requestAnimationFrame(() => {
      for (const seg of segEls) (seg.querySelector('.seg-label') as HTMLElement).hidden = seg.clientWidth < 46;
    });
  }

  // ------------------------------------------------------------------ frame loop

  let dragging: number | null = null;

  // while paused the dial only redraws until its animations settle, so an idle tab costs nothing
  let settleUntil = 0;
  const wake = () => (settleUntil = performance.now() + 2000);
  addEventListener('resize', wake);

  function frame(): void {
    const pos = player.position();
    if (pos.index !== shownIndex) showSection(pos.score);
    const playing = player.state === 'playing';
    if (playing || performance.now() < settleUntil) dial.frame(pos, playing);
    const mv = pos.score.movement;
    const t = dragging ?? pos.movementTime;
    el.now.textContent = clock(t);
    let acc = 0;
    mv.sections.forEach((s, i) => {
      const d = (s.bars * 240) / mv.bpm;
      segFills[i].style.width = `${Math.min(100, Math.max(0, ((t - acc) / d) * 100))}%`;
      acc += d;
    });
    const span = pos.score.chords.findIndex((c) => pos.offset >= c.t && pos.offset < c.t + c.d);
    if (span !== shownChord && span >= 0) {
      shownChord = span;
      [...el.chords.children].forEach((li, i) => li.classList.toggle('on', i === chordChips[span]));
    }
    el.track.setAttribute('aria-valuenow', String(Math.round(t)));
    el.track.setAttribute('aria-valuetext', `${clock(t)} of ${clock(mv.duration)}`);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => {
    const pos = player.position();
    if (player.state === 'playing') media.progress(pos.movementTime, pos.score.movement.duration);
    updateSleepBadge();
  }, 1000);

  // ------------------------------------------------------------------ transport

  function toggle(): void {
    if (player.state === 'playing' || player.state === 'loading') player.pause();
    else void player.play();
  }

  function seekMovement(m: number, t: number): void {
    const { index, offset } = song.locate(m, t);
    player.seek(index, offset);
    wake();
  }

  function skip(delta: number): void {
    const pos = player.position();
    const mv = pos.score.movement;
    const t = pos.movementTime + delta;
    if (t < 0 && mv.index > 0) seekMovement(mv.index - 1, song.movement(mv.index - 1).duration + t);
    else if (t >= mv.duration) seekMovement(mv.index + 1, t - mv.duration);
    else seekMovement(mv.index, Math.max(0, t));
  }

  function prev(): void {
    const pos = player.position();
    const m = pos.score.movement.index;
    seekMovement(pos.movementTime > 3 || m === 0 ? m : m - 1, 0);
  }

  function next(): void {
    seekMovement(player.position().score.movement.index + 1, 0);
  }

  player.on('state', (s) => {
    wake();
    const active = s === 'playing' || s === 'loading';
    el.glyph.setAttribute('d', active ? PAUSE_GLYPH : PLAY_GLYPH);
    el.play.setAttribute('aria-label', active ? 'Pause' : 'Play');
    el.bigPlay.hidden = active;
    el.status.textContent = s === 'loading' ? 'Composing and synthesizing…' : '';
    media.playing(s === 'playing');
  });
  player.on('error', (msg) => toast(`Playback stopped: ${msg}`));
  // also runs while the tab is hidden (the frame loop doesn't), so the lock screen stays current
  player.on('section', (score) => {
    if (score.index !== shownIndex) showSection(score);
  });

  el.play.addEventListener('click', toggle);
  el.bigPlay.addEventListener('click', () => void player.play());
  $('prev').addEventListener('click', prev);
  $('next-btn').addEventListener('click', next);

  // seeking on the section bar: preview while dragging, jump on release
  const timeAt = (clientX: number) => {
    const r = el.track.getBoundingClientRect();
    const mv = player.position().score.movement;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * mv.duration;
  };
  el.track.addEventListener('pointerdown', (e) => {
    el.track.setPointerCapture(e.pointerId);
    dragging = timeAt(e.clientX);
  });
  el.track.addEventListener('pointermove', (e) => {
    if (dragging !== null) dragging = timeAt(e.clientX);
  });
  el.track.addEventListener('pointerup', (e) => {
    if (dragging === null) return;
    const t = timeAt(e.clientX);
    dragging = null;
    seekMovement(player.position().score.movement.index, t);
  });
  el.track.addEventListener('pointercancel', () => (dragging = null));
  el.track.addEventListener('keydown', (e) => {
    const pos = player.position();
    const step = { ArrowLeft: -10, ArrowRight: 10, PageDown: -30, PageUp: 30 }[e.key];
    if (step) skip(step);
    else if (e.key === 'Home') seekMovement(pos.score.movement.index, 0);
    else if (e.key === 'End') seekMovement(pos.score.movement.index, pos.score.movement.duration - 5);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // ------------------------------------------------------------------ extras

  function setRepeat(on: boolean): void {
    player.setRepeat(on);
    el.repeat.setAttribute('aria-pressed', String(on));
    toast(on ? 'Repeating this movement' : 'Continuing through the song');
  }
  el.repeat.addEventListener('click', () => setRepeat(!player.repeat));

  let sleepStep = 0;
  function updateSleepBadge(): void {
    const left = player.sleepRemaining();
    const badge = el.sleep.querySelector('.badge') as HTMLElement;
    if (left === null) sleepStep = 0;
    badge.hidden = left === null;
    badge.textContent = left === null ? '' : String(Math.ceil(left / 60000));
    el.sleep.setAttribute('aria-pressed', String(left !== null));
    el.sleep.setAttribute(
      'aria-label',
      left === null ? 'Sleep timer: off' : `Sleep timer: ${Math.ceil(left / 60000)} minutes left`,
    );
  }
  el.sleep.addEventListener('click', () => {
    sleepStep = (sleepStep + 1) % SLEEP_STEPS.length;
    const m = SLEEP_STEPS[sleepStep];
    player.setSleep(m);
    updateSleepBadge();
    toast(m ? `Fading out in ${m} minutes` : 'Sleep timer off');
  });

  let preMute = player.volume || 0.8;
  function setVolume(v: number): void {
    player.setVolume(v);
    el.vol.value = String(v);
    el.mute.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
    el.mute.querySelector('.wave')!.setAttribute('opacity', v === 0 ? '0.2' : '1');
    storeVolume(v);
  }
  el.vol.addEventListener('input', () => setVolume(Number(el.vol.value)));
  el.mute.addEventListener('click', () => {
    if (player.volume > 0) {
      preMute = player.volume;
      setVolume(0);
    } else setVolume(preMute || 0.8);
  });

  el.download.addEventListener('click', async () => {
    if (el.download.disabled) return;
    const mv = player.position().score.movement;
    // named now: the seed may change while it renders
    const name = `${song.phrase}-${roman(mv.index + 1)}-${mv.title.toLowerCase().replace(/\s+/g, '-')}.wav`;
    el.download.disabled = true;
    toast(`Rendering movement ${roman(mv.index + 1)} (${clock(mv.duration)})…`, 60_000);
    try {
      const wav = await player.exportMovement(mv.index);
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast('Download ready');
    } catch (err) {
      toast(
        err instanceof Error && err.name === 'CancelledError' ? 'Download cancelled' : 'Could not render the download',
      );
    } finally {
      el.download.disabled = false;
    }
  });

  // ------------------------------------------------------------------ seeds and sharing

  function loadSong(
    phrase: string,
    styles: readonly StyleId[] | undefined,
    play: boolean,
    at?: { m: number; t: number },
  ): void {
    const wasPlaying = player.state === 'playing' || player.state === 'loading';
    song = new Song(phrase, styles);
    const pos = at ? song.locate(at.m, at.t) : { index: 0, offset: 0 };
    shownMovement = null;
    shownIndex = -1;
    player.load(song, pos.index, pos.offset);
    history.pushState(null, '', hashFor({ seed: song.phrase, styles: [...song.styles], movement: at?.m }));
    if (play || wasPlaying) void player.play();
  }

  $('new-seed').addEventListener('click', () => loadSong(randomSeedPhrase(), song.styles, true));

  $('share').addEventListener('click', async () => {
    const pos = player.position();
    const url = location.origin + location.pathname + hashFor({
      seed: song.phrase,
      styles: [...song.styles],
      movement: pos.score.movement.index,
      time: pos.movementTime,
    });
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. It opens at this exact moment.');
    } catch {
      prompt('Copy this link:', url);
    }
  });

  addEventListener('popstate', () => {
    const p = readHash();
    const styles = p.styles ?? STYLE_IDS;
    if (p.seed && (p.seed !== song.phrase || styles.join() !== song.styles.join())) {
      song = new Song(p.seed, styles);
      shownMovement = null;
      shownIndex = -1;
      const pos = song.locate(p.movement ?? 0, p.time ?? 0);
      player.load(song, pos.index, pos.offset);
    }
  });

  // dialogs
  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = $<HTMLDialogElement>(b.dataset.open!);
      if (d.id === 'seeds') fillSeedDialog();
      d.showModal();
    })
  );
  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) =>
    b.addEventListener('click', () => (b.closest('dialog') as HTMLDialogElement).close())
  );
  document.querySelectorAll('dialog').forEach((d) =>
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close(); // a click on the backdrop
    })
  );

  const chosen = new Set<StyleId>();
  function fillSeedDialog(): void {
    $<HTMLInputElement>('seed-input').value = displaySeed(song.phrase);
    chosen.clear();
    for (const s of song.styles) chosen.add(s);
    const list = $('styles');
    list.replaceChildren();
    for (const id of STYLE_IDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = styleLabel(id);
      b.setAttribute('aria-pressed', String(chosen.has(id)));
      b.addEventListener('click', () => {
        if (chosen.has(id) && chosen.size === 1) return toast('Keep at least one style on');
        if (chosen.has(id)) chosen.delete(id);
        else chosen.add(id);
        b.setAttribute('aria-pressed', String(chosen.has(id)));
      });
      list.append(b);
    }
    const recent = recentSeeds().filter((s) => s !== song.phrase);
    $('recent-h').hidden = !recent.length;
    const ul = $('recent');
    ul.replaceChildren(...recent.map((s) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = displaySeed(s);
      b.addEventListener('click', () => {
        $<HTMLDialogElement>('seeds').close();
        loadSong(s, [...chosen], true);
      });
      li.append(b);
      return li;
    }));
  }
  $<HTMLFormElement>('seed-form').addEventListener('submit', (e) => {
    const phrase = $<HTMLInputElement>('seed-input').value;
    if (!phrase.trim()) {
      e.preventDefault();
      toast('Type a seed, or use New seed for a random one');
      return;
    }
    loadSong(phrase, STYLE_IDS.filter((s) => chosen.has(s)), true);
  });

  // ------------------------------------------------------------------ keyboard

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, dialog[open]')) return;
    const onButton = t.tagName === 'BUTTON';
    switch (e.key) {
      case ' ':
        if (onButton) return;
        toggle();
        break;
      case 'ArrowLeft':
        skip(-10);
        break;
      case 'ArrowRight':
        skip(10);
        break;
      case 'n':
      case 'N':
        next();
        break;
      case 'p':
      case 'P':
        prev();
        break;
      case 'r':
      case 'R':
        setRepeat(!player.repeat);
        break;
      case 'd':
      case 'D':
        loadSong(randomSeedPhrase(), song.styles, true);
        break;
      case 's':
      case 'S':
        $('share').click();
        break;
      case 'm':
      case 'M':
        el.mute.click();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // ------------------------------------------------------------------ toast

  let toastTimer = 0;
  function toast(msg: string, ms = 2600): void {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
  }
}
