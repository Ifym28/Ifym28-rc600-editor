// Playback, file decoding and drum synthesis with the Web Audio API.

import { decodeWav, toStereo, resampleLinear, RATE } from './wav.js';

let ctx = null;
export function audioContext() {
  ctx ||= new AudioContext({ sampleRate: RATE });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Decode any audio file to stereo Float32Arrays at 44.1 kHz. */
export async function decodeToStereo(bytes) {
  let rate;
  let channels;
  try {
    ({ rate, channels } = decodeWav(bytes));
  } catch {
    const buf = await audioContext().decodeAudioData(bytes.slice().buffer);
    rate = buf.sampleRate;
    channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  }
  let [left, right] = toStereo(channels);
  if (rate !== RATE) {
    try {
      const frames = Math.max(1, Math.round((left.length * RATE) / rate));
      const off = new OfflineAudioContext(2, frames, RATE);
      const src = off.createBufferSource();
      const buf = off.createBuffer(2, left.length, rate);
      buf.copyToChannel(left, 0);
      buf.copyToChannel(right, 1);
      src.buffer = buf;
      src.connect(off.destination);
      src.start();
      const done = await off.startRendering();
      left = done.getChannelData(0);
      right = done.getChannelData(1);
    } catch {
      const same = left === right;
      left = resampleLinear(left, rate, RATE);
      right = same ? left : resampleLinear(right, rate, RATE);
    }
  }
  return { left, right, sourceRate: rate };
}

// ---- loop players, one per key ----

const players = new Map();

export function play(key, left, right, { level = 1, pan = 0.5, loop = true, when, onEnd } = {}) {
  stop(key);
  const ac = audioContext();
  const buf = ac.createBuffer(2, left.length, RATE);
  buf.copyToChannel(left, 0);
  buf.copyToChannel(right, 1);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const gain = ac.createGain();
  gain.gain.value = level;
  const panner = ac.createStereoPanner();
  panner.pan.value = pan * 2 - 1;
  src.connect(gain).connect(panner).connect(ac.destination);
  const startAt = when ?? ac.currentTime + 0.02;
  src.start(startAt);
  const player = { src, gain, startAt, duration: buf.duration };
  src.onended = () => {
    if (players.get(key) === player) players.delete(key);
    onEnd?.();
  };
  players.set(key, player);
  return player;
}

export function stop(key) {
  const p = players.get(key);
  if (!p) return;
  players.delete(key);
  try {
    p.src.stop();
  } catch {
    /* already stopped */
  }
}

export function stopAll() {
  for (const key of [...players.keys()]) stop(key);
}

export const isPlaying = (key) => players.has(key);

/** Position in the loop from 0 to 1, or null when the key is not playing. */
export function position(key) {
  const p = players.get(key);
  if (!p || !ctx) return null;
  const t = ctx.currentTime - p.startAt;
  return t < 0 ? 0 : (t % p.duration) / p.duration;
}

// ---- drum voices for the rhythm editor ----
// General MIDI drum notes. The preview is a simple synth, not the sound of the looper kits.

export const DRUM_NOTES = [
  [49, 'Crash', 'crash'], [57, 'Crash 2', 'crash'], [55, 'Splash', 'crash'], [52, 'China', 'crash'],
  [51, 'Ride', 'ride'], [53, 'Ride Bell', 'ride'], [59, 'Ride 2', 'ride'],
  [46, 'Open Hat', 'ohh'], [42, 'Closed Hat', 'chh'], [44, 'Pedal Hat', 'chh'],
  [54, 'Tambourine', 'chh'], [56, 'Cowbell', 'cow'],
  [50, 'High Tom', 'tomH'], [48, 'High Tom 2', 'tomH'], [47, 'Mid Tom', 'tomH'], [45, 'Mid Tom 2', 'tomL'],
  [43, 'Low Tom', 'tomL'], [41, 'Low Tom 2', 'tomL'],
  [39, 'Clap', 'clap'], [37, 'Rim', 'stick'], [40, 'Snare 2', 'snare'], [38, 'Snare', 'snare'],
  [36, 'Kick', 'kick'], [35, 'Kick 2', 'kick'],
].map(([note, name, voice]) => ({ note, name, voice }));

export const drumName = (note) => DRUM_NOTES.find((d) => d.note === note)?.name || `Note ${note}`;

// Own samples, one per drum note: { name, left, right } at 44.1 kHz. A note with a
// sample plays the sample; a note without one plays the synth voice.
const samples = new Map();
export const getSample = (note) => samples.get(note) || null;
export function setSample(note, sample) {
  if (sample) samples.set(note, sample);
  else samples.delete(note);
}

/** Play a MIDI drum note on a context (the live one by default). velocity is 1..127. */
export function drumNote(note, when, velocity = 100, ac = audioContext()) {
  const s = samples.get(note);
  if (!s) return drumHit(DRUM_NOTES.find((d) => d.note === note)?.voice || 'stick', when, Math.min(1, velocity / 115), ac);
  const buf = ac.createBuffer(2, s.left.length, RATE);
  buf.copyToChannel(s.left, 0);
  buf.copyToChannel(s.right, 1);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const gain = ac.createGain();
  gain.gain.value = (velocity / 127) ** 1.5;
  src.connect(gain).connect(ac.destination);
  src.start(when);
}

/**
 * Render measures of drum notes to a stereo loop. The ring-out after the last
 * measure is mixed back into the start, so the loop repeats without a gap.
 */
export async function renderDrumLoop(measures, measureTicks, tempo) {
  const secPerTick = 60 / tempo / 96;
  const frames = Math.round(measures.length * measureTicks * secPerTick * RATE);
  const tail = RATE * 4;
  const off = new OfflineAudioContext(2, frames + tail, RATE);
  measures.forEach((notes, m) => {
    for (const n of notes) drumNote(n.note, (m * measureTicks + n.tick) * secPerTick, n.velocity, off);
  });
  const done = await off.startRendering();
  const out = [0, 1].map((c) => {
    const all = done.getChannelData(c);
    const loop = all.slice(0, frames);
    for (let i = frames; i < all.length; i++) loop[(i - frames) % frames] += all[i];
    return loop;
  });
  let peak = 0;
  for (const ch of out) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 0.98) for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= 0.98 / peak;
  return { left: out[0], right: out[1], peak };
}

let noise = null;
function noiseBuffer(ac) {
  if (noise) return noise;
  noise = ac.createBuffer(1, RATE, RATE);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

export function drumHit(id, when, velocity = 0.8, ac = audioContext()) {
  const out = ac.createGain();
  out.gain.value = velocity;
  out.connect(ac.destination);
  const env = (peak, decay) => {
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + decay);
    g.connect(out);
    return g;
  };
  const tone = (type, f0, f1, decay, peak = 1) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + decay);
    o.connect(env(peak, decay));
    o.start(when);
    o.stop(when + decay + 0.02);
  };
  const hiss = (filterType, freq, decay, peak = 1) => {
    const s = ac.createBufferSource();
    s.buffer = noiseBuffer(ac);
    const f = ac.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    s.connect(f).connect(env(peak, decay));
    s.start(when, Math.random() * 0.5);
    s.stop(when + decay + 0.02);
  };
  switch (id) {
    case 'kick': tone('sine', 150, 42, 0.28, 1.2); break;
    case 'snare': tone('triangle', 220, 150, 0.12, 0.6); hiss('highpass', 1500, 0.18, 0.7); break;
    case 'stick': tone('square', 1700, 1500, 0.03, 0.3); hiss('bandpass', 2500, 0.03, 0.4); break;
    case 'clap': hiss('bandpass', 1300, 0.16, 0.9); break;
    case 'chh': hiss('highpass', 8000, 0.05, 0.45); break;
    case 'ohh': hiss('highpass', 7500, 0.3, 0.4); break;
    case 'tomL': tone('sine', 150, 90, 0.3, 0.9); break;
    case 'tomH': tone('sine', 260, 170, 0.22, 0.8); break;
    case 'ride': hiss('bandpass', 6000, 0.5, 0.3); tone('square', 5200, 5100, 0.2, 0.05); break;
    case 'crash': hiss('highpass', 5000, 0.9, 0.5); break;
    case 'cow': tone('square', 800, 790, 0.14, 0.3); tone('square', 540, 535, 0.14, 0.3); break;
    default: break;
  }
}
