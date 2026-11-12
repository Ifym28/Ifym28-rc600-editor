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

export const DRUMS = [
  { id: 'kick', name: 'High Bass Drum', note: 36 },
  { id: 'snare', name: 'Acoustic Snare', note: 38 },
  { id: 'stick', name: 'Side Stick', note: 37 },
  { id: 'clap', name: 'Hand Clap', note: 39 },
  { id: 'chh', name: 'Closed Hi-hat', note: 42 },
  { id: 'ohh', name: 'Open Hi-hat', note: 46 },
  { id: 'tomL', name: 'Low Tom', note: 45 },
  { id: 'tomH', name: 'High Tom', note: 50 },
  { id: 'ride', name: 'Ride Cymbal', note: 51 },
  { id: 'crash', name: 'Crash Cymbal', note: 49 },
  { id: 'cow', name: 'Cowbell', note: 56 },
];

let noise = null;
function noiseBuffer(ac) {
  if (noise) return noise;
  noise = ac.createBuffer(1, RATE, RATE);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

export function drumHit(id, when, velocity = 0.8) {
  const ac = audioContext();
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
