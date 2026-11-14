// Operations on a connected RC-600 storage folder (the ROLAND folder).

import * as rc from './rc0.js';
import { join, bytesToText, textToBytes } from './backend.js';
import { TRACK_AUDIO_TAGS, samplesPerMeasure, beatsFromRhythm } from './params.js';
import { encodeRcWav } from './wav.js';
import { readRhythmFile, writeRhythmFile } from './rhythm-file.js';

const COUNT_RE = /<count>([0-9A-Fa-f]+)<\/count>/;

async function pool(items, size, fn) {
  let next = 0;
  const run = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

export class Device {
  constructor(backend, volume) {
    this.backend = backend;
    this.name = volume.name;
    this.root = volume.root;
    this.memories = []; // index = slot - 1; entries may be null
    this.waveCount = 0;
  }

  dataPath(file) {
    return join(this.root, 'DATA', file);
  }
  wavePath(slot, track) {
    return join(this.root, 'WAVE', rc.waveDir(slot, track), rc.waveFile(slot, track));
  }

  async readCount(file) {
    const tail = bytesToText(await this.backend.read(this.dataPath(file), -64, 64));
    const m = COUNT_RE.exec(tail);
    return m ? parseInt(m[1], 16) : null;
  }

  /** Read the A/B counts of a pair and return which copy is current. */
  async pairState(fileA, fileB, present) {
    const counts = {
      A: present.has(fileA) ? await this.readCount(fileA).catch(() => null) : null,
      B: present.has(fileB) ? await this.readCount(fileB).catch(() => null) : null,
    };
    if (counts.A == null && counts.B == null) return null;
    return { counts, current: rc.pickCurrent(counts.A, counts.B) };
  }

  async scan(onProgress) {
    const entries = await this.backend.list(join(this.root, 'DATA'));
    const present = new Set(entries.map((e) => e.name.toUpperCase()));
    this.memories = Array(99).fill(null);
    let done = 0;
    await pool([...Array(99).keys()].map((i) => i + 1), 8, async (slot) => {
      const state = await this.pairState(rc.memoryFile(slot, 'A'), rc.memoryFile(slot, 'B'), present);
      if (state) {
        const head = bytesToText(await this.backend.read(this.dataPath(rc.memoryFile(slot, state.current)), 0, 6144));
        this.memories[slot - 1] = { slot, ...state, ...rc.quickSummary(head) };
      }
      onProgress?.(++done);
    });
    this.systemState = await this.pairState('SYSTEM1.RC0', 'SYSTEM2.RC0', present);
    this.hasRhythmFile = present.has('RHYTHM.RC0');
    const waveDirs = await this.backend.list(join(this.root, 'WAVE')).catch(() => []);
    this.waveDirs = new Set(waveDirs.filter((e) => e.dir).map((e) => e.name));
    this.waveCount = this.waveDirs.size;
    return this.memories.filter(Boolean).length;
  }

  async loadMemory(slot) {
    const mem = this.memories[slot - 1];
    if (!mem) throw new Error(`Memory ${slot} has no file on this volume.`);
    const bytes = await this.backend.read(this.dataPath(rc.memoryFile(slot, mem.current)));
    return rc.parseRc0(bytesToText(bytes));
  }

  /** Write the edited memory as the new current copy. The previous copy stays on disk as the other file. */
  async saveMemory(slot, doc, opts = {}) {
    const mem = this.memories[slot - 1] || { slot, counts: { A: null, B: null }, current: 'B' };
    const next = Math.max(mem.counts.A ?? -1, mem.counts.B ?? -1, 0) + 1;
    const target = mem.current === 'A' ? 'B' : 'A';
    const text = rc.serialize(doc, { count: next, id: opts.id });
    rc.parseRc0(text); // refuse to write a file this app cannot read back
    await this.backend.write(this.dataPath(rc.memoryFile(slot, target)), textToBytes(text));
    mem.counts[target] = next;
    mem.current = target;
    Object.assign(mem, rc.quickSummary(text.slice(0, 6144)));
    this.memories[slot - 1] = mem;
    return rc.parseRc0(text);
  }

  async loadSystem() {
    if (!this.systemState) throw new Error('No SYSTEM file on this volume.');
    const file = this.systemState.current === 'A' ? 'SYSTEM1.RC0' : 'SYSTEM2.RC0';
    return rc.parseRc0(bytesToText(await this.backend.read(this.dataPath(file))));
  }

  async saveSystem(doc) {
    const s = this.systemState;
    const next = Math.max(s.counts.A ?? -1, s.counts.B ?? -1, 0) + 1;
    const target = s.current === 'A' ? 'B' : 'A';
    const text = rc.serialize(doc, { count: next });
    rc.parseRc0(text);
    await this.backend.write(this.dataPath(target === 'A' ? 'SYSTEM1.RC0' : 'SYSTEM2.RC0'), textToBytes(text));
    s.counts[target] = next;
    s.current = target;
    return rc.parseRc0(text);
  }

  // ------------------------------------------------------------- user rhythms

  /** Records of DATA/RHYTHM.RC0 as raw bytes. A missing file gives an empty list. */
  async loadRhythms() {
    if (!this.hasRhythmFile) return [];
    return readRhythmFile(await this.backend.read(this.dataPath('RHYTHM.RC0')));
  }

  /** Replace DATA/RHYTHM.RC0. The previous file is first copied to the app trash folder. */
  async saveRhythms(records) {
    const bytes = writeRhythmFile(records);
    readRhythmFile(bytes);
    if (this.hasRhythmFile) await this.backend.snapshot(this.dataPath('RHYTHM.RC0'));
    await this.backend.write(this.dataPath('RHYTHM.RC0'), bytes);
    this.hasRhythmFile = true;
  }

  // ------------------------------------------------------------- audio

  /** File info for the six tracks of a memory: [{ path, size } | null, ...]. */
  async trackFiles(slot) {
    const out = [];
    for (let t = 1; t <= 6; t++) {
      const dir = rc.waveDir(slot, t);
      let hit = null;
      if (this.waveDirs.has(dir)) {
        const files = await this.backend.list(join(this.root, 'WAVE', dir)).catch(() => []);
        const wav = files.find((f) => !f.dir && /\.wav$/i.test(f.name));
        if (wav) hit = { name: wav.name, path: join(this.root, 'WAVE', dir, wav.name), size: wav.size };
      }
      out.push(hit);
    }
    return out;
  }

  /**
   * Store stereo audio as the loop of a track and update the track tags in doc.
   * The caller saves the memory afterwards.
   */
  async putTrackAudio(slot, track, left, right, doc) {
    const dir = join(this.root, 'WAVE', rc.waveDir(slot, track));
    if (this.waveDirs.has(rc.waveDir(slot, track))) await this.backend.remove(dir);
    await this.backend.mkdir(dir);
    await this.backend.write(this.wavePath(slot, track), encodeRcWav(left, right));
    this.waveDirs.add(rc.waveDir(slot, track));
    this.waveCount = this.waveDirs.size;

    const frames = Math.min(left.length, right.length);
    const tempo10 = rc.getNum(rc.section(doc, 'mem', 'MASTER'), 'A', 1200);
    const beats = beatsFromRhythm(rc.getNum(rc.section(doc, 'mem', 'RHYTHM'), 'F', 2));
    const measures = Math.max(1, Math.round(frames / samplesPerMeasure(tempo10 / 10, beats)));
    const sec = rc.section(doc, 'mem', `TRACK${track}`);
    rc.setNum(sec, 'U', tempo10);
    rc.setNum(sec, 'V', Math.round(frames / measures));
    rc.setNum(sec, 'W', 1);
    rc.setNum(sec, 'X', frames);
    return { frames, measures };
  }

  async clearTrackAudio(slot, track, doc) {
    const name = rc.waveDir(slot, track);
    if (this.waveDirs.has(name)) await this.backend.remove(join(this.root, 'WAVE', name));
    this.waveDirs.delete(name);
    this.waveCount = this.waveDirs.size;
    const sec = rc.section(doc, 'mem', `TRACK${track}`);
    rc.setNum(sec, 'U', 1200);
    rc.setNum(sec, 'V', 88200);
    rc.setNum(sec, 'W', 0);
    rc.setNum(sec, 'X', 0);
  }

  // ------------------------------------------------------------- manager

  /** Move the loops of a memory slot to the app trash folder. */
  async clearSlotWaves(slot) {
    for (let t = 1; t <= 6; t++) {
      const dir = rc.waveDir(slot, t);
      if (!this.waveDirs.has(dir)) continue;
      await this.backend.remove(join(this.root, 'WAVE', dir));
      this.waveDirs.delete(dir);
    }
    this.waveCount = this.waveDirs.size;
  }

  async copyWaves(from, to) {
    for (let t = 1; t <= 6; t++) {
      const dst = rc.waveDir(to, t);
      if (this.waveDirs.has(dst)) {
        await this.backend.remove(join(this.root, 'WAVE', dst));
        this.waveDirs.delete(dst);
      }
    }
    const files = await this.trackFiles(from);
    for (let t = 1; t <= 6; t++) {
      if (!files[t - 1]) continue;
      const bytes = await this.backend.read(files[t - 1].path);
      await this.backend.mkdir(join(this.root, 'WAVE', rc.waveDir(to, t)));
      await this.backend.write(this.wavePath(to, t), bytes);
      this.waveDirs.add(rc.waveDir(to, t));
    }
    this.waveCount = this.waveDirs.size;
  }

  /**
   * Copy memory `from` over memory `to`.
   * withAudio = true copies the loops too. With false, the destination keeps its
   * own loops and the track tags that describe them.
   */
  async copyMemory(from, to, withAudio = true) {
    if (from === to) return;
    const src = await this.loadMemory(from);
    if (!withAudio && this.memories[to - 1]) {
      const dst = await this.loadMemory(to);
      for (let t = 1; t <= 6; t++) {
        const a = rc.section(src, 'mem', `TRACK${t}`);
        const b = rc.section(dst, 'mem', `TRACK${t}`);
        for (const tag of TRACK_AUDIO_TAGS) if (b?.byTag.has(tag)) rc.setNum(a, tag, rc.getNum(b, tag));
      }
    }
    if (withAudio) await this.copyWaves(from, to);
    await this.saveMemory(to, src, { id: to - 1 });
  }

  async swapMemories(a, b) {
    if (a === b) return;
    const docA = await this.loadMemory(a);
    const docB = await this.loadMemory(b);
    // Loops: move a -> temp (in memory), b -> a, temp -> b.
    const filesA = await this.trackFiles(a);
    const held = [];
    for (const f of filesA) held.push(f ? await this.backend.read(f.path) : null);
    await this.copyWaves(b, a);
    for (let t = 1; t <= 6; t++) {
      const dir = rc.waveDir(b, t);
      if (this.waveDirs.has(dir)) {
        await this.backend.remove(join(this.root, 'WAVE', dir));
        this.waveDirs.delete(dir);
      }
      if (held[t - 1]) {
        await this.backend.mkdir(join(this.root, 'WAVE', dir));
        await this.backend.write(this.wavePath(b, t), held[t - 1]);
        this.waveDirs.add(dir);
      }
    }
    this.waveCount = this.waveDirs.size;
    await this.saveMemory(a, docB, { id: a - 1 });
    await this.saveMemory(b, docA, { id: b - 1 });
  }
}
