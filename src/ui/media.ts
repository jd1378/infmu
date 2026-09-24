// Lock screen, headphone buttons and OS media keys.

export interface MediaHandlers {
  play(): void;
  pause(): void;
  prev(): void;
  next(): void;
  seek(seconds: number): void;
  skip(delta: number): void;
}

export interface Media {
  meta(title: string, artist: string, album: string, artwork?: string): void;
  progress(position: number, duration: number): void;
  playing(on: boolean): void;
}

export function bindMediaSession(h: MediaHandlers): Media {
  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
  if (!ms) return { meta() {}, progress() {}, playing() {} };
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      // action not supported by this browser
    }
  };
  set('play', () => h.play());
  set('pause', () => h.pause());
  set('previoustrack', () => h.prev());
  set('nexttrack', () => h.next());
  set('seekto', (d) => d.seekTime !== undefined && h.seek(d.seekTime));
  set('seekbackward', (d) => h.skip(-(d.seekOffset ?? 10)));
  set('seekforward', (d) => h.skip(d.seekOffset ?? 10));
  return {
    meta(title, artist, album, artwork) {
      ms.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/png' }] : [],
      });
    },
    progress(position, duration) {
      try {
        ms.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
      } catch {
        // some browsers reject position state while metadata is changing
      }
    },
    playing(on) {
      ms.playbackState = on ? 'playing' : 'paused';
    },
  };
}
