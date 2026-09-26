# infmu

Endless music from a seed. Every note is composed and every sample synthesized in your browser: there are no audio
files. The same seed plays the same endless song for anyone, so a song is shared as a link.

**Play it:** https://jd1378.github.io/infmu/

## What it does

- **A seed is a song.** Type any words, or roll a random phrase like `amber quiet harbor`. The link carries the seed,
  the composer version, the length, the movement and the second you're at:
  `#seed=amber-quiet-harbor&v=2&len=long&m=3&t=42`.
- **An endless journey.** The song is a chain of movements of about two, three to four, or five to six minutes, as the
  listener chooses. Each has a style, a key, a tempo and a form built from intros, verses, pre-choruses, choruses,
  bridges, solos, builds, drops, breaks and outros. Keys move to close neighbours and styles to related ones. A movement
  often ends by ringing out into a few seconds of rest, like the gap between album tracks; others hand over with a
  reverse swell or a tape stop.
- **Written, not random.** Each movement invents a hook in its style's idiom (a lyrical line, a trance riff, a sparse
  film theme) with a planned contour: one climax, the rest reached by step. Phrases are built the way themes are
  (question and answer, sentence, AABA, rising sequence), each statement continuing from the last, and every chorus
  restates the hook. Sections end on the chord that leads into the next one, last choruses sometimes lift a key, and
  silences are written in: stop-time bars, a held breath before a chorus, a dead-silent beat before a drop.
- **Grooves with a feel.** Each style has a bank of grooves written the way a producer programs them (drums and a bass
  line that locks with the kick, with verse, chorus and fill bars); a movement draws one and keeps it, and two pieces of
  a style in a row never share one.
- **Played, not sequenced.** What a person would play is performed: a melody swells through its phrase and breathes at
  its end, each player drifts a little around the beat, chords are rolled, and the band plays softer under the melody
  and swells into a bigger part. A returning melody gets a grace note here and there; winds and brass shade every note
  with its own vibrato and swell into long ones; guitarists hammer on, slide and squeak; a slow piece is pedalled, its
  undamped strings ringing along. The band styles have a drummer with a feel of their own (a lazy backbeat, cymbals
  pushing ahead), ghost notes far under the backbeat, flams and fills that change from phrase to phrase, and a different
  take of the drum on every stroke. Their tempo breathes: the band pushes into its peak, calm phrases press on and
  relax, and a piece slows into its last chord. Drum machines and sequencers keep their exact grid.
- **Pieces that build.** A movement is an arc: it starts quiet, every return is bigger, breaks fall back, and the last
  chorus or drop is the peak. A returning part grows by one thing at a time (a counter-line answering the hook, a layer
  in the groove, the colour joining) and the peak doubles the hook. Loudness follows it over a range each style sets (a
  few LU for lo-fi, up to 18 for cinematic), measured against reference recordings.
- **Nine styles, one band each:** ambient, lo-fi, synthwave, trance, cinematic, acid house, organic downtempo, piano and
  post-rock. A movement keeps its style, its lead voice and one signature texture from start to end; the band grows
  rather than changes. Variety comes from movement to movement.
- **Mixed by measurement, heard as a recording.** Each section is rendered in stems (the bed of chords and textures,
  drums, bass, melody): drums and bass sit where the style wants them against the bed, the melody rides on top, the bed
  is widened (mono-compatibly), and the section is leveled to the loudness its place in the arc calls for. Each style
  plays in a room of its own (early reflections from its walls, a small room for lo-fi, a hall for cinematic), the band
  styles have the faint noise floor of a recording, and the analog ones a touch of tape warmth.
- **Instruments, all synthesized:** drums and hand percussion (congas, bongos, cowbell, ride, crash, snaps), supersaw
  pads, strings, a pipe organ, a grand piano (heard by a pair of microphones) and an electric piano, acoustic and
  electric guitars (clean, or overdriven through an amp model), harp, marimba, vibraphone, kalimba, glockenspiel and
  bells, flute, saxophone, brass, a hummed voice, a choir, synth leads and basses, an 808 and a 303-style acid line. The
  acoustic ones are physical and modal models fitted to measurements of real recordings.
- **A music player.** Play/pause, previous/next movement, a seekable bar showing the movement's form, repeat one
  movement, sleep timer with fade-out, volume, WAV download of the current movement, media keys (and lock-screen
  controls where the browser offers them), keyboard shortcuts, a choice of styles and of composer version.
- **The dial.** The circle of fifths, turned so the key's tonic sits at the top. The chord playing now is drawn as a
  shape, notes light up where they sit, and the melody leaves a trail. The whole page takes its colour from the key and
  turns with a key change. It reads the same score the synthesizer plays, so what you see is what you hear.

## Versions

A seed must keep its song forever, so the composer is versioned and a released version never changes. Seeds and links
carry their version; new seeds use the latest one, and the seed dialog can switch.

| Version |                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2      | Longer movements with a choice of length and a real arc, nine styles with producer-written grooves, many more instruments modelled on recordings, hooks that return and grow, turnarounds, written silences, key lifts, a stem mix. |
| v1      | The original: shorter movements in five styles. Links made before versions existed play v1.                                                                                                                                         |

Each version is a sealed engine under `src/engines/vN` behind the port in `src/core/engine.ts`. Tests pin each released
version's output (plans, scores and audio fingerprints), so an accidental change fails CI. To improve the music, copy
the latest engine to a new version and change that.

## How it works

```
seed ─▶ Song plan (movements: style, key, tempo, form)       src/engines/vN/plan.ts
          │
          ▼
        Section score (drums, bass, chords, arps, melody)       src/engines/vN/compose/
          │
          ▼
        Synth, sample by sample, in Web Workers                  src/engines/vN/synth/
          │   each section leveled to a loudness target (ITU-R BS.1770) and limited
          ▼
        AudioContext scheduler: sections play back to back,     src/audio/player.ts
        each one's reverb tail overlapping the next
```

Everything in an engine is pure and deterministic: randomness comes only from seeded integer generators, so the notes
are identical in every browser. Any section can be rendered on its own, which is what makes seeking (and sharing a
moment deep into the song) instant: the player renders that section and the one before it, for its tail.

The synthesis grew out of [EX NIHILO](https://github.com/ErwannRobin/ex-nihilo), a 43-second demo whose soundtrack is
computed the same way. Its drums, bass, supersaw, organ, lead, bell, reverb and mastering chain were adapted and made
reentrant. New here: the composer and planner, streaming and seeking, electric piano, gated and lo-fi drums, strings,
glass pads, synthwave bass and lead, flute, vinyl, and per-section leveling.

Layers: `src/core` holds the ports (engine and player) and `src/engines` the versioned composers; neither knows the
browser. `src/audio` implements the `PlayerPort` with Web Audio and workers; `src/ui` talks only to the ports.

## Develop

Requires [Deno](https://deno.com) 2.9 or newer. There are no npm dependencies; the only third-party code is Deno's
standard library, used by the dev server and the CLI, pinned in `deno.lock`.

```sh
deno task dev       # build on change, serve on http://127.0.0.1:8000
deno task check     # type check, lint, format check
deno task test      # determinism, theory, composer, synth, URL and player race tests
deno task build     # production build into dist/
deno task render --seed "amber quiet harbor" --version 2 --movement 2    # a movement to out/*.wav, with loudness stats
```

Tasks run with narrow permissions (for example the build may only write to `dist/`).

## Deploy

`.github/workflows/pages.yml` checks, builds and publishes `dist/` to GitHub Pages on every push to `main` (actions
pinned to commit SHAs). The link preview image `public/og.png` points at `https://jd1378.github.io/infmu/`; update the
`og:` tags in `src/index.html` if the site moves.

## Credits

infmu started from [EX NIHILO](https://justinperea.com/lab/ex-nihilo) by Justin Perea (code on GitHub:
[ErwannRobin/ex-nihilo](https://github.com/ErwannRobin/ex-nihilo)), a 43-second demoscene film whose every pixel and
sound comes from one HTML file. It was the inspiration and the starting point: its idea of a score written as data and
synthesized sample by sample in plain JavaScript, mixed by measurement rather than by ear, and its synthesizer (drums,
basses, supersaw, organ, leads, bell, reverb, echo and mastering chain), which infmu adapted and then grew from.

The DSP stands on published work: Freeverb (Jezar at Dreampoint), Vadim Zavalishin's topology-preserving state-variable
filter, PolyBLEP oscillators, the Karplus-Strong plucked string (with Jaffe and Smith's extensions, and Välimäki and
Karjalainen's loss and polarization models), and the ITU-R BS.1770 loudness measure.

The instrument models were fitted to measurements of recordings (used only for measurement, not distributed): the
University of Iowa Musical Instrument Samples, VSCO 2 Community Edition and VCSL (CC0), FreePats (CC0), the Discord SFZ
GM bank (Martin HD-28 by Jeff Learman, CC0), and Freesound packs by tim.kahn (CC BY 4.0) and hollandm (CC0). Melody
statistics were checked against the POP909 dataset (MIT).
