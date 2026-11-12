// Storage backends.
//  - native: the Electron main process (real files on the RC-600 volume).
//  - demo:   an in-memory volume with generated memories and loops, so the app
//            can be tried without the looper connected.

import { encodeRcWav, RATE } from './wav.js';
import { memoryFile, waveDir, waveFile } from './rc0.js';

export const join = (...parts) => parts.join('/').replace(/\/+/g, '/');

export function bytesToText(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return out;
}

export function textToBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
  return out;
}

function nativeBackend(native) {
  const u8 = (b) => (b instanceof Uint8Array ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
  return {
    kind: 'native',
    ...native,
    read: async (p, start, length) => u8(await native.read(p, start, length)),
    openFile: async (ext) => {
      const r = await native.openFile(ext);
      return r && { name: r.name, bytes: u8(r.bytes) };
    },
  };
}

// ---------------------------------------------------------------- demo data

const sec = (name, values) => `<${name}>\n${values.map((v, i) => `\t<${String.fromCharCode(65 + i)}>${v}</${String.fromCharCode(65 + i)}>`).join('\n')}\n</${name}>\n`;

const FX_TYPES = ['LPF', 'PHASER', 'FLANGER', 'LOFI', 'DIST', 'DELAY', 'TAPE_ECHO', 'CHORUS', 'REVERB'];

function fxBlock(tag, id) {
  let out = `<${tag} id="${id}">\n${sec('SETUP', [0])}`;
  for (const bank of 'ABCD') {
    out += sec(bank, [1, 1, 0]);
    for (const slot of 'ABCD') {
      out += sec(bank + slot, [0, 0, 'ABCD'.indexOf(slot), 0]);
      for (const type of FX_TYPES) out += sec(`${bank}${slot}_${type}`, type === 'REVERB' ? [20, 50, 0, 50, 50] : [50, 50, 50, 50]);
    }
  }
  return `${out}</${tag}>\n`;
}

function demoMemory(slot, name, tracks, tempo, genre) {
  const id = slot - 1;
  const spm = Math.round((RATE * 240) / tempo);
  let out = `<?xml version="1.0" encoding="utf-8"?>\n<database name="RC-600" revision="0">\n<mem id="${id}">\n`;
  out += sec('NAME', [...name.padEnd(12, ' ')].map((c) => c.charCodeAt(0)));
  for (let t = 1; t <= 6; t++) {
    const tr = tracks[t - 1];
    out += sec(`TRACK${t}`, [0, 0, tr?.pan ?? 50, tr?.level ?? 100, 0, 0, 0, 1, 0, tr ? 9 : 1, 0, 1, 1, 1, 1, 0, 127,
      tr ? tr.measures : 1, tr ? 2 : 0, 0, tr ? tempo * 10 : 1200, tr ? spm : 88200, tr ? 1 : 0, tr ? spm * tr.measures : 0, 2]);
  }
  out += sec('MASTER', [tempo * 10, spm, 0, 0]);
  out += sec('REC', [0, 0, 0, 50, 0, 63]);
  out += sec('PLAY', [0, 5, 5, 63, 63, 0, 0, 1]);
  out += sec('RHYTHM', [genre, 0, 0, 0, 4, 2, 1, 0, 0, 1, 0, 1, 1]);
  for (let a = 1; a <= 16; a++) out += sec(`ASSIGN${a}`, [a <= 2 ? 1 : 0, a <= 2 ? 48 + a : 0, 0, 0, 0, 127, a <= 2 ? 770 + a : 0, 0, 127, 1]);
  out += sec('INPUT', [0, 0, 0, 0, 0, 1, 1, 0, 40, 0, 40, 40, 40]);
  out += sec('OUTPUT', [0, 1, 1, 1]);
  out += sec('ROUTING', [63, 63, 63, 63, 63, 63, 63, 127, 127, 127, 127, 127, 127, 127, 0, 1, 0, 0, 1]);
  out += sec('MIXER', Array(22).fill(100));
  out += sec('MASTER_FX', [0, 0, 0]);
  out += `</mem>\n${fxBlock('ifx', id)}${fxBlock('tfx', id)}</database>\n<count>0001</count>\n`;
  return out;
}

function demoSystem() {
  let out = '<?xml version="1.0" encoding="utf-8"?>\n<database name="RC-600" revision="0">\n<sys>\n';
  out += sec('SETUP', [0, 0, 98, 1, 0, 2, 0, 1, 5, 1, 116, 118, 116, 1, 0, 0, 271, 0, 0, 0, 1, 1]);
  out += sec('COLOR', [1, 2, 3, 7, 4]);
  out += sec('USB', [1, 0, 0, 100, 100]);
  out += sec('MIDI', [0, 0, 9, 0, 16, 0, 1, 1, 0, 0, 0]).replace(/\t<B>.*\n/, '');
  out += sec('PREF', Array(20).fill(1));
  return `${out}</sys>\n</database>\n<count>0001</count>\n`;
}

// Small synthesized loops so the Audio view has something to play.
function demoLoop(kind, tempo, measures) {
  const frames = Math.round((RATE * 240) / tempo) * measures;
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  const beat = (RATE * 60) / tempo;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (at, len, fn, pan = 0.5) => {
    const start = Math.round(at);
    for (let i = 0; i < len && start + i < frames; i++) {
      const v = fn(i / RATE, i / len);
      L[start + i] += v * (1 - pan) * 1.4;
      R[start + i] += v * pan * 1.4;
    }
  };
  const steps = measures * 16;
  for (let s = 0; s < steps; s++) {
    const at = (s * beat) / 4;
    if (kind === 'drums') {
      if (s % 8 === 0 || s % 16 === 10) add(at, 9000, (t, p) => Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-t * 30)) * t) * (1 - p) ** 2 * 0.9);
      if (s % 8 === 4) add(at, 7000, (t, p) => (rnd() * 0.5 + Math.sin(2 * Math.PI * 190 * t) * 0.3) * (1 - p) ** 3 * 0.7);
      if (s % 2 === 0) add(at, 1800, (t, p) => rnd() * (1 - p) ** 4 * 0.22, 0.62);
    } else if (kind === 'bass') {
      const notes = [41.2, 0, 41.2, 0, 0, 49, 0, 41.2, 55, 0, 0, 55, 49, 0, 36.7, 0];
      const f = notes[s % 16];
      if (f) add(at, beat / 2.2, (t, p) => Math.tanh(Math.sin(2 * Math.PI * f * t) * 2.2) * (1 - p) * 0.5);
    } else if (kind === 'chords') {
      if (s % 16 === 0) {
        const chord = [[164.8, 196, 246.9], [146.8, 185, 220]][Math.floor(s / 16) % 2];
        for (const f of chord) add(at, beat * 3.6, (t, p) => (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.sin(Math.PI * p) * 0.12, 0.35 + (f % 3) * 0.1);
      }
    } else if (kind === 'lead') {
      const notes = [0, 0, 659, 0, 587, 0, 0, 494, 0, 0, 440, 0, 494, 0, 0, 0];
      const f = notes[(s + Math.floor(s / 16) * 3) % 16];
      if (f) add(at, beat / 1.6, (t, p) => Math.sin(2 * Math.PI * f * t + Math.sin(2 * Math.PI * 5 * t) * 0.4) * (1 - p) ** 1.5 * 0.2, 0.7);
    }
  }
  return encodeRcWav(L, R);
}

function buildDemoFiles() {
  const files = new Map();
  const names = ['NEON RUNNER', 'Memory02', 'TOKYO DRIFT', 'Memory04', 'AMBIENT PAD', 'Memory06', 'FUNK JAM', 'Memory08'];
  const plans = {
    1: { tempo: 96, genre: 10, tracks: [{ kind: 'drums', measures: 2, level: 95 }, { kind: 'bass', measures: 2, level: 110, pan: 50 }, { kind: 'chords', measures: 2, level: 100, pan: 40 }, { kind: 'lead', measures: 2, level: 60, pan: 62 }] },
    3: { tempo: 128, genre: 18, tracks: [{ kind: 'drums', measures: 1, level: 100 }, { kind: 'bass', measures: 1, level: 100 }] },
    7: { tempo: 108, genre: 7, tracks: [{ kind: 'drums', measures: 2, level: 100 }, null, { kind: 'chords', measures: 2, level: 80 }] },
  };
  for (let slot = 1; slot <= 99; slot++) {
    const plan = plans[slot] || { tempo: 120, genre: 10, tracks: [] };
    const name = names[slot - 1] || `Memory${String(slot).padStart(2, '0')}`;
    const text = demoMemory(slot, name, plan.tracks, plan.tempo, plan.genre);
    files.set(`DATA/${memoryFile(slot, 'A')}`, textToBytes(text));
    files.set(`DATA/${memoryFile(slot, 'B')}`, textToBytes(text.replace('<count>0001', '<count>0000')));
    plan.tracks.forEach((tr, i) => {
      if (tr) files.set(`WAVE/${waveDir(slot, i + 1)}/${waveFile(slot, i + 1)}`, demoLoop(tr.kind, plan.tempo, tr.measures));
    });
  }
  const sys = demoSystem();
  files.set('DATA/SYSTEM1.RC0', textToBytes(sys));
  files.set('DATA/SYSTEM2.RC0', textToBytes(sys.replace('<count>0001', '<count>0000')));
  return files;
}

export function demoBackend() {
  const ROOT = '/Volumes/RC-600 (DEMO)/ROLAND';
  let files = null;
  const backups = [];
  const rel = (p) => {
    if (!p.startsWith(ROOT)) throw new Error(`Path is outside the demo volume: ${p}`);
    return p.slice(ROOT.length + 1);
  };
  const ensure = () => (files ||= buildDemoFiles());

  const download = (name, bytes) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return {
    kind: 'demo',
    platform: 'demo',
    findVolumes: async () => [{ name: 'RC-600 (DEMO)', root: ROOT }],
    pickFolder: async () => ({ name: 'RC-600 (DEMO)', root: ROOT }),
    async list(dir) {
      const base = rel(dir);
      const prefix = base ? `${base}/` : '';
      const seen = new Map();
      for (const [path, bytes] of ensure()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash < 0) seen.set(rest, { name: rest, dir: false, size: bytes.length });
        else seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), dir: true, size: 0 });
      }
      return [...seen.values()];
    },
    async read(p, start, length) {
      const bytes = ensure().get(rel(p));
      if (!bytes) throw new Error(`File not found: ${p}`);
      if (start == null) return bytes.slice();
      const from = start < 0 ? Math.max(0, bytes.length + start) : start;
      return bytes.slice(from, from + (length ?? bytes.length));
    },
    async write(p, bytes) {
      ensure().set(rel(p), new Uint8Array(bytes));
      return true;
    },
    mkdir: async () => true,
    async remove(p) {
      const key = rel(p);
      let hit = false;
      for (const path of [...ensure().keys()]) {
        if (path === key || path.startsWith(key + '/')) hit = ensure().delete(path) || hit;
      }
      return hit;
    },
    async backup(_root, opts = {}) {
      const snap = new Map();
      for (const [path, bytes] of ensure()) if (opts.wave || path.startsWith('DATA/')) snap.set(path, bytes);
      backups.push({ snap, wave: !!opts.wave });
      return { path: `demo backup #${backups.length} (kept in memory)`, wave: !!opts.wave };
    },
    async pickBackup() {
      if (!backups.length) throw new Error('No demo backup yet. Use Save Backup first.');
      return { path: String(backups.length - 1), wave: backups[backups.length - 1].wave };
    },
    async restore(id) {
      const { snap, wave } = backups[Number(id)];
      if (wave) for (const path of [...files.keys()]) if (path.startsWith('WAVE/')) files.delete(path);
      for (const [path, bytes] of snap) files.set(path, bytes);
      return { wave };
    },
    async saveFile(name, bytes) {
      download(name, bytes);
      return true;
    },
    openFile: (extensions) =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        if (extensions) input.accept = extensions.map((e) => `.${e}`).join(',');
        input.onchange = async () => {
          const f = input.files[0];
          resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
        };
        input.oncancel = () => resolve(null);
        input.click();
      }),
    eject: async () => true,
    reveal: async () => true,
  };
}

export function createBackend() {
  return window.rc600Native ? nativeBackend(window.rc600Native) : demoBackend();
}
