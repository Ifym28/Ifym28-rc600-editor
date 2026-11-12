// WAV decode and encode. The RC-600 stores each track as 44.1 kHz stereo 32-bit float.

export const RATE = 44100;

function findChunks(view) {
  const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (view.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  const chunks = {};
  let o = 12;
  while (o + 8 <= view.byteLength) {
    const id = tag(o);
    const size = view.getUint32(o + 4, true);
    if (!chunks[id]) chunks[id] = { offset: o + 8, size: Math.min(size, view.byteLength - o - 8) };
    o += 8 + size + (size & 1);
  }
  return chunks;
}

export function wavInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { 'fmt ': fmt, data } = findChunks(view);
  if (!fmt || !data) throw new Error('WAV has no fmt or data chunk');
  let format = view.getUint16(fmt.offset, true);
  const channels = view.getUint16(fmt.offset + 2, true);
  const rate = view.getUint32(fmt.offset + 4, true);
  const bits = view.getUint16(fmt.offset + 14, true);
  if (format === 0xfffe && fmt.size >= 26) format = view.getUint16(fmt.offset + 24, true);
  const frameBytes = (bits / 8) * channels;
  return { format, channels, rate, bits, dataOffset: data.offset, frames: Math.floor(data.size / frameBytes), view };
}

/** Decode PCM 8/16/24/32 or float 32/64 into { rate, channels: [Float32Array, ...] }. */
export function decodeWav(bytes) {
  const info = wavInfo(bytes);
  const { view, format, bits, frames } = info;
  const n = info.channels;
  const out = Array.from({ length: n }, () => new Float32Array(frames));
  const step = bits / 8;
  let read;
  if (format === 3 && bits === 32) read = (o) => view.getFloat32(o, true);
  else if (format === 3 && bits === 64) read = (o) => view.getFloat64(o, true);
  else if (format === 1 && bits === 16) read = (o) => view.getInt16(o, true) / 32768;
  else if (format === 1 && bits === 24) read = (o) => ((view.getInt8(o + 2) << 16) | view.getUint16(o, true)) / 8388608;
  else if (format === 1 && bits === 32) read = (o) => view.getInt32(o, true) / 2147483648;
  else if (format === 1 && bits === 8) read = (o) => (view.getUint8(o) - 128) / 128;
  else throw new Error(`Unsupported WAV encoding (format ${format}, ${bits} bit)`);
  let o = info.dataOffset;
  for (let i = 0; i < frames; i++) for (let c = 0; c < n; c++, o += step) out[c][i] = read(o);
  return { rate: info.rate, channels: out };
}

/** Make exactly two channels: mono is doubled, extra channels are dropped. */
export function toStereo(channels) {
  if (channels.length === 1) return [channels[0], channels[0]];
  return [channels[0], channels[1]];
}

/** Linear resample. The app uses the browser resampler when it can; this is the fallback. */
export function resampleLinear(data, from, to) {
  if (from === to) return data;
  const length = Math.max(1, Math.round((data.length * to) / from));
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const p = i * ratio;
    const a = Math.floor(p);
    const b = Math.min(a + 1, data.length - 1);
    out[i] = data[a] + (data[b] - data[a]) * (p - a);
  }
  return out;
}

/**
 * Encode stereo float32 the way the unit writes it: fmt chunk of 28 bytes
 * (format 3, cbSize 10), data at byte 56.
 */
export function encodeRcWav(left, right) {
  const frames = Math.min(left.length, right.length);
  const dataBytes = frames * 8;
  const out = new Uint8Array(56 + dataBytes);
  const v = new DataView(out.buffer);
  const ascii = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 48 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 28, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 8, true);
  v.setUint16(32, 8, true);
  v.setUint16(34, 32, true);
  v.setUint16(36, 10, true);
  ascii(48, 'data');
  v.setUint32(52, dataBytes, true);
  for (let i = 0, o = 56; i < frames; i++, o += 8) {
    v.setFloat32(o, left[i], true);
    v.setFloat32(o + 4, right[i], true);
  }
  return out;
}

/** 16-bit PCM for export to other software. */
export function encodePcm16(left, right, rate = RATE) {
  const frames = Math.min(left.length, right.length);
  const out = new Uint8Array(44 + frames * 4);
  const v = new DataView(out.buffer);
  const ascii = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + frames * 4, true);
  ascii(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, frames * 4, true);
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0, o = 44; i < frames; i++, o += 4) {
    v.setInt16(o, q(left[i]), true);
    v.setInt16(o + 2, q(right[i]), true);
  }
  return out;
}

/** Peak pairs for drawing a waveform: [min0, max0, min1, max1, ...]. */
export function peaks(data, buckets) {
  const out = new Float32Array(buckets * 2);
  const size = data.length / buckets;
  for (let b = 0; b < buckets; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(data.length, Math.floor((b + 1) * size));
    for (let i = Math.floor(b * size); i < end; i++) {
      const x = data[i];
      if (x < lo) lo = x;
      else if (x > hi) hi = x;
    }
    out[b * 2] = lo;
    out[b * 2 + 1] = hi;
  }
  return out;
}

/**
 * Mix tracks into one stereo loop. Each track is { left, right, level (0..2), pan (0..1) }.
 * Shorter tracks repeat until the longest one ends.
 */
export function mixTracks(tracks) {
  const frames = Math.max(0, ...tracks.map((t) => t.left.length));
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (const t of tracks) {
    const n = t.left.length;
    if (!n) continue;
    const gl = t.level * Math.min(1, 2 * (1 - t.pan));
    const gr = t.level * Math.min(1, 2 * t.pan);
    for (let i = 0; i < frames; i++) {
      const j = i % n;
      L[i] += t.left[j] * gl;
      R[i] += t.right[j] * gr;
    }
  }
  return [L, R];
}
