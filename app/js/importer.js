// Import memories and user rhythms from another ROLAND folder, for example an
// unzipped setup package or a backup of another unit.

import * as rc from './rc0.js';
import { join, bytesToText } from './backend.js';
import { readRhythmFile, decodeRecord, MAX_RECORDS } from './rhythm-file.js';

const USER_GENRE = 20;
const MEMORY_RE = /^MEMORY(\d{3})([AB])\.RC0$/i;

/** Read what a ROLAND folder offers: memories (current copy of each pair) and user rhythms. */
export async function scanImport(backend, root) {
  const files = await backend.list(join(root, 'DATA'));
  const pairs = new Map();
  for (const f of files) {
    const m = MEMORY_RE.exec(f.name);
    if (!m || f.dir) continue;
    const slot = Number(m[1]);
    if (slot < 1 || slot > 99) continue;
    const text = bytesToText(await backend.read(join(root, 'DATA', f.name)));
    let doc;
    try {
      doc = rc.parseRc0(text);
    } catch {
      continue;
    }
    if (!rc.section(doc, 'mem', 'NAME')) continue;
    const prev = pairs.get(slot);
    if (!prev || rc.countOf(doc) > rc.countOf(prev.doc)) pairs.set(slot, { slot, file: f.name, doc });
  }
  const memories = [...pairs.values()].sort((a, b) => a.slot - b.slot).map((p) => {
    const rhythm = rc.section(p.doc, 'mem', 'RHYTHM');
    return {
      slot: p.slot,
      file: p.file,
      name: rc.readName(p.doc),
      tempo: rc.getNum(rc.section(p.doc, 'mem', 'MASTER'), 'A', 1200) / 10,
      userRhythm: rc.getNum(rhythm, 'A') === USER_GENRE ? rc.getNum(rhythm, 'B') : null,
      doc: p.doc,
    };
  });
  let rhythms = [];
  if (files.some((f) => f.name.toUpperCase() === 'RHYTHM.RC0')) {
    rhythms = readRhythmFile(await backend.read(join(root, 'DATA', 'RHYTHM.RC0')));
  }
  for (const m of memories) m.rhythmName = m.userRhythm != null && rhythms[m.userRhythm] ? decodeRecord(rhythms[m.userRhythm]).name : null;
  return { root, memories, rhythms };
}

/**
 * Plan the rhythm merge: rhythms of the source whose name is not on the device yet are added
 * at the end. Rhythms already on the device keep their place, so memories that use them still work.
 */
export function planRhythms(deviceRecords, sourceRecords) {
  const names = deviceRecords.map((r) => decodeRecord(r).name);
  const added = [];
  for (const r of sourceRecords) {
    const name = decodeRecord(r).name;
    if (names.includes(name)) continue;
    if (names.length >= MAX_RECORDS) break;
    names.push(name);
    added.push(r);
  }
  return { records: [...deviceRecords, ...added], names, added: added.map((r) => decodeRecord(r).name) };
}

/**
 * Import the chosen memories. picks: [{ memory (from scanImport), to: slot }].
 * Order: user rhythms first, then each memory, so a memory never points to a missing rhythm.
 */
export async function applyImport(device, scan, picks, { onStep } = {}) {
  const used = picks.some((p) => p.memory.userRhythm != null);
  let names = null;
  let added = [];
  if (used && scan.rhythms.length) {
    const plan = planRhythms(await device.loadRhythms(), scan.rhythms);
    if (plan.added.length) {
      onStep?.(`Adding ${plan.added.length} user rhythm(s)`);
      await device.saveRhythms(plan.records);
    }
    names = plan.names;
    added = plan.added;
  }
  const results = [];
  for (const { memory, to } of picks) {
    onStep?.(`Writing memory ${to}`);
    const doc = rc.parseRc0(rc.serialize(memory.doc));
    let note = '';
    if (memory.userRhythm != null) {
      const index = names && memory.rhythmName ? names.indexOf(memory.rhythmName) : -1;
      if (index >= 0) rc.setNum(rc.section(doc, 'mem', 'RHYTHM'), 'B', index);
      else note = 'its user rhythm was not found; select the rhythm by hand';
    }
    await device.clearSlotWaves(to);
    await device.saveMemory(to, doc, { id: to - 1 });
    results.push({ to, name: memory.name, note });
  }
  return { results, addedRhythms: added };
}
