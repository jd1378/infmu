/** 16-bit PCM stereo WAV. Samples are clamped to [-1, 1] and rounded (no dither). */
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const frames = Math.min(left.length, right.length);
  const data = frames * 4;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    v.setInt16(o, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
    v.setInt16(o + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
    o += 4;
  }
  return new Uint8Array(buf);
}
