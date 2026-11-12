// Reader and writer for the user rhythm file ROLAND/DATA/RHYTHM.RC0 (binary).
//
// Layout, little-endian (checked against a file written by the unit):
//   bytes 0..7   "PTN_0000"
//   bytes 8..11  number of bytes in use = records * 40184
//   then 50 records of 40184 bytes; unused records are all zero.
// One record:
//   0..12    name, ASCII, zero padded ("^" stands for a space)
//   16       kit (u16)      18  tempo in BPM (u16)
//   20       beats per measure      21  beat unit (4 or 8)
//   24..183  ten parts of 16 bytes: first measure (u16), measures (u16),
//            8 zero bytes, number of note entries (u16), 2 zero bytes
//   184..    note entries of 4 bytes: ticks since the previous entry (u16,
//            96 per quarter note), note number, velocity.
//            The list ends with one entry of note 0 at the end of the last measure.
// Parts, in this order: Intro, A, Fill A, B, Fill B, C, Fill C, D, Fill D, Ending.
// Each part is a range of measures in the one shared note list.

export const RECORD_SIZE = 40184;
export const MAX_RECORDS = 50;
export const MAX_ENTRIES = 10000;
export const PPQ = 96;
export const PART_NAMES = ['Intro', 'A', 'Fill A', 'B', 'Fill B', 'C', 'Fill C', 'D', 'Fill D', 'Ending'];
const MAGIC = 'PTN_0000';

/** Split a RHYTHM.RC0 file into its used records (raw bytes, so they can be written back unchanged). */
export function readRhythmFile(bytes) {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 8)) !== MAGIC) throw new Error('Not an RC-600 RHYTHM.RC0 file');
  const used = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  const count = Math.min(MAX_RECORDS, Math.floor(used / RECORD_SIZE));
  const out = [];
  for (let i = 0; i < count; i++) out.push(bytes.slice(12 + i * RECORD_SIZE, 12 + (i + 1) * RECORD_SIZE));
  return out;
}

export function writeRhythmFile(records) {
  if (records.length > MAX_RECORDS) throw new Error(`The unit holds at most ${MAX_RECORDS} user rhythms`);
  const out = new Uint8Array(12 + MAX_RECORDS * RECORD_SIZE);
  for (let i = 0; i < 8; i++) out[i] = MAGIC.charCodeAt(i);
  new DataView(out.buffer).setUint32(8, records.length * RECORD_SIZE, true);
  records.forEach((r, i) => {
    if (r.length !== RECORD_SIZE) throw new Error('Rhythm record has the wrong size');
    out.set(r, 12 + i * RECORD_SIZE);
  });
  return out;
}

export function decodeRecord(rec) {
  const v = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  let name = '';
  for (let i = 0; i < 13 && rec[i]; i++) name += String.fromCharCode(rec[i]);
  const parts = PART_NAMES.map((_, i) => ({ from: v.getUint16(24 + i * 16, true), measures: v.getUint16(26 + i * 16, true) }));
  const count = Math.min(MAX_ENTRIES, v.getUint16(36, true));
  const notes = [];
  let tick = 0;
  for (let i = 0; i < count; i++) {
    tick += v.getUint16(184 + i * 4, true);
    const note = rec[186 + i * 4];
    if (note) notes.push({ tick, note, velocity: rec[187 + i * 4] });
  }
  return { name: name.replace(/\^/g, ' '), kit: v.getUint16(16, true), tempo: v.getUint16(18, true), beats: rec[20], unit: rec[21], parts, notes, endTick: tick };
}

/**
 * Build one record.
 * rhythm: { name, kit, tempo, beats (default 4), unit (default 4),
 *           parts: ten arrays of measures; a measure is a list of { tick, note, velocity },
 *                  tick counted from the start of that measure }
 */
export function encodeRecord(rhythm) {
  const beats = rhythm.beats ?? 4;
  const unit = rhythm.unit ?? 4;
  const measureTicks = (beats * PPQ * 4) / unit;
  if (rhythm.parts.length !== PART_NAMES.length) throw new Error('A rhythm needs exactly 10 parts');
  const rec = new Uint8Array(RECORD_SIZE);
  const v = new DataView(rec.buffer);
  const name = String(rhythm.name).toUpperCase().replace(/ /g, '^').replace(/[^A-Z0-9^\-+&]/g, '').slice(0, 12);
  for (let i = 0; i < name.length; i++) rec[i] = name.charCodeAt(i);
  v.setUint16(16, rhythm.kit, true);
  v.setUint16(18, Math.round(rhythm.tempo), true);
  rec[20] = beats;
  rec[21] = unit;

  const events = [];
  let measure = 0;
  const windows = rhythm.parts.map((part) => {
    if (!part.length) throw new Error('Every part needs at least one measure');
    const from = measure;
    for (const notes of part) {
      for (const n of notes) {
        if (n.tick < 0 || n.tick >= measureTicks) throw new Error(`Note outside its measure in "${rhythm.name}"`);
        events.push({ tick: measure * measureTicks + n.tick, note: n.note, velocity: n.velocity });
      }
      measure++;
    }
    return { from, measures: part.length };
  });
  events.sort((a, b) => a.tick - b.tick || a.note - b.note);
  events.push({ tick: measure * measureTicks, note: 0, velocity: 0 });
  if (events.length > MAX_ENTRIES) throw new Error('Too many notes for one rhythm');

  windows.forEach((w, i) => {
    v.setUint16(24 + i * 16, w.from, true);
    v.setUint16(26 + i * 16, w.measures, true);
    v.setUint16(36 + i * 16, events.length, true);
  });
  let last = 0;
  events.forEach((e, i) => {
    v.setUint16(184 + i * 4, e.tick - last, true);
    rec[186 + i * 4] = e.note;
    rec[187 + i * 4] = e.velocity;
    last = e.tick;
  });
  return rec;
}
