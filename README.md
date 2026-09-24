# infmu

Endless music from a seed. Every note is composed and every sample synthesized in your browser: there are no audio
files. The same seed plays the same endless song for anyone, so a song is shared as a link.

**Play it:** https://jd1378.github.io/infmu/

## What it does

- **A seed is a song.** Type any words, or roll a random phrase like `amber quiet harbor`. The link carries the seed,
  the movement and the second you're at: `#seed=amber-quiet-harbor&m=3&t=42`.
- **An endless journey.** The song is a chain of movements. Each has a style (ambient, lo-fi, synthwave, trance,
  cinematic), a key, a tempo and a form (intro, verse, chorus, build, drop, break, outro). Keys move to close neighbours
  and styles to related ones, and each movement hands over to the next with a fade, a reverse swell or a tape stop.
- **Written, not random.** Each movement invents a two-bar motif and restates it: fitted to the chords under it,
  answered, varied at cadences, slowed down in breakdowns. Chords are voice-led; strong beats land on chord tones.
- **A music player.** Play/pause, previous/next movement, a seekable bar showing the movement's form, repeat one
  movement, sleep timer with fade-out, volume, WAV download of the current movement, media keys (and lock-screen
  controls where the browser offers them), keyboard shortcuts, and a choice of styles.
- **The dial.** The circle of fifths, turned so the key's tonic sits at the top. The chord playing now is drawn as a
  shape, notes light up where they sit, and the melody leaves a trail. The whole page takes its colour from the key. It
  reads the same score the synthesizer plays, so what you see is what you hear.

## How it works

```
seed ─▶ Song plan (movements: style, key, tempo, form)       src/core/plan.ts
          │
          ▼
        Section score (drums, bass, chords, arps, melody)       src/core/compose/
          │
          ▼
        Synth, sample by sample, in Web Workers                  src/core/synth/
          │   each section leveled to a loudness target (ITU-R BS.1770) and limited
          ▼
        AudioContext scheduler: sections play back to back,     src/audio/player.ts
        each one's reverb tail overlapping the next
```

Everything in `src/core` is pure and deterministic: randomness comes only from seeded integer generators, so the notes
are identical in every browser. Any section can be rendered on its own, which is what makes seeking (and sharing a
moment deep into the song) instant: the player renders that section and the one before it, for its tail.

The synthesis grew out of [EX NIHILO](https://github.com/ErwannRobin/ex-nihilo), a 43-second demo whose soundtrack is
computed the same way. Its drums, bass, supersaw, organ, lead, bell, reverb and mastering chain were adapted and made
reentrant. New here: the composer and planner, streaming and seeking, electric piano, gated and lo-fi drums, strings,
glass pads, synthwave bass and lead, flute, vinyl, and per-section leveling.

Layers: `src/core` (domain) knows nothing about the browser; `src/audio` implements the `PlayerPort` from
`src/core/player.ts` with Web Audio and workers; `src/ui` talks only to that port and the domain.

## Develop

Requires [Deno](https://deno.com) 2.9 or newer. There are no npm dependencies; the only third-party code is Deno's
standard library, used by the dev server and the CLI, pinned in `deno.lock`.

```sh
deno task dev       # build on change, serve on http://127.0.0.1:8000
deno task check     # type check, lint, format check
deno task test      # determinism, theory, composer, synth, URL and player race tests
deno task build     # production build into dist/
deno task render --seed "amber quiet harbor" --movement 2    # render a movement to out/*.wav, with loudness stats
```

Tasks run with narrow permissions (for example the build may only write to `dist/`).

## Deploy

`.github/workflows/pages.yml` checks, builds and publishes `dist/` to GitHub Pages on every push to `main` (actions
pinned to commit SHAs). The link preview image `public/og.png` points at `https://jd1378.github.io/infmu/`; update the
`og:` tags in `src/index.html` if the site moves.
