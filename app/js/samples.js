// Own drum samples, kept in the app (IndexedDB) so they are still there after a restart.
// The looper itself cannot load drum samples: its kits are part of the firmware.
// Samples are used for the preview and to render a rhythm as a loop for a track.

import * as audio from './audio.js';
import { RATE } from './wav.js';

const MAX_SECONDS = 10;
const names = new Map(); // note -> file name

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('rc600-editor', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('samples');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('samples', mode);
    const result = fn(tx.objectStore('samples'));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function use(note, name, bytes) {
  const { left, right } = await audio.decodeToStereo(bytes);
  const n = Math.min(left.length, RATE * MAX_SECONDS);
  audio.setSample(note, { name, left: left.slice(0, n), right: right.slice(0, n) });
  names.set(note, name);
}

export const sampleName = (note) => names.get(note) || null;
export const sampleCount = () => names.size;

/** Assign a sample file to a drum note and keep it. */
export async function assignSample(note, name, bytes) {
  await use(note, name, bytes);
  await store('readwrite', (s) => s.put({ name, bytes }, note)).catch(() => {});
}

export async function clearSample(note) {
  audio.setSample(note, null);
  names.delete(note);
  await store('readwrite', (s) => s.delete(note)).catch(() => {});
}

/** Load the kept samples. Called once at start. */
export async function restoreSamples() {
  const keys = (await store('readonly', (s) => s.getAllKeys()).catch(() => [])) || [];
  for (const note of keys) {
    const item = await store('readonly', (s) => s.get(note)).catch(() => null);
    if (item) await use(note, item.name, item.bytes).catch(() => {});
  }
  return names.size;
}
