// Reader and writer for the RC-600 ".RC0" settings files.
//
// The files look like XML but are not valid XML: some tags are digits or "#",
// and a <count> element follows the root. So this module tokenizes the text
// itself. It records the position of every value, and a save replaces only the
// characters of the values that changed. All other bytes stay the same.
//
// Layout:  <database> -> block (<mem id="0">, <ifx>, <tfx>, <sys>)
//          -> section (<TRACK1>) -> field (<A>50</A>),  then <count>0013</count>.

const TOKEN = /<(\/?)([^\s<>\/]+)([^<>]*)>/g;

export function parseRc0(text) {
  const doc = { text, blocks: [], count: null };
  const stack = [];
  let block = null;
  let section = null;
  let field = null;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    const [raw, slash, name, attrs] = m;
    if (name.startsWith('?')) continue;
    if (!slash) {
      const depth = stack.length;
      stack.push(name);
      if (depth === 0 && name === 'count') {
        field = { tag: name, start: m.index + raw.length };
      } else if (depth === 1) {
        const id = /id="(\d+)"/.exec(attrs);
        block = { name, id: id ? Number(id[1]) : null, idPos: null, sections: [], byName: new Map() };
        if (id) {
          const at = m.index + raw.indexOf('id="') + 4;
          block.idPos = [at, at + id[1].length];
        }
        doc.blocks.push(block);
      } else if (depth === 2 && block) {
        section = { name, fields: [], byTag: new Map() };
        block.sections.push(section);
        block.byName.set(name, section);
      } else if (depth === 3 && section) {
        field = { tag: name, start: m.index + raw.length };
      }
    } else {
      const depth = stack.length - 1;
      if (stack[depth] !== name) throw new Error(`RC0: unexpected </${name}> at ${m.index}`);
      stack.pop();
      if (field && field.tag === name && (depth === 3 || (depth === 0 && name === 'count'))) {
        field.end = m.index;
        field.orig = text.slice(field.start, field.end);
        field.value = field.orig;
        if (depth === 0) doc.count = field;
        else {
          section.fields.push(field);
          section.byTag.set(name, field);
        }
      }
      field = null;
      if (depth === 2) section = null;
      if (depth === 1) block = null;
    }
  }
  if (!doc.blocks.length) throw new Error('RC0: no data block found');
  return doc;
}

export const block = (doc, name) => doc.blocks.find((b) => b.name === name) || null;
export const section = (doc, blockName, sectionName) => block(doc, blockName)?.byName.get(sectionName) || null;

export function getNum(sec, tag, fallback = 0) {
  const f = sec?.byTag.get(tag);
  if (!f) return fallback;
  const n = Number(f.value);
  return Number.isFinite(n) ? n : fallback;
}

/** Set a field value. Returns false if the field does not exist (fields are never added). */
export function setNum(sec, tag, value) {
  const f = sec?.byTag.get(tag);
  if (!f) return false;
  f.value = String(Math.round(Number(value)));
  return true;
}

export function isDirty(doc) {
  for (const b of doc.blocks) for (const s of b.sections) for (const f of s.fields) if (f.value !== f.orig) return true;
  return false;
}

export function changedFields(doc) {
  const out = [];
  for (const b of doc.blocks)
    for (const s of b.sections)
      for (const f of s.fields) if (f.value !== f.orig) out.push({ block: b.name, section: s.name, tag: f.tag, from: f.orig, to: f.value });
  return out;
}

export function revert(doc) {
  for (const b of doc.blocks) for (const s of b.sections) for (const f of s.fields) f.value = f.orig;
}

export const countOf = (doc) => (doc.count ? parseInt(doc.count.orig, 16) : 0);

/**
 * Build the file text with the current field values.
 * opts.count: new count number. opts.id: new id for the mem/ifx/tfx blocks.
 */
export function serialize(doc, opts = {}) {
  const edits = [];
  for (const b of doc.blocks) {
    if (opts.id != null && b.idPos) edits.push([b.idPos[0], b.idPos[1], String(opts.id)]);
    for (const s of b.sections) for (const f of s.fields) if (f.value !== f.orig) edits.push([f.start, f.end, f.value]);
  }
  if (opts.count != null) {
    if (!doc.count) throw new Error('RC0: file has no <count>');
    if (opts.count > 0xffff) throw new Error('RC0: save counter is at its maximum (FFFF)');
    const width = doc.count.orig.length;
    const upper = doc.count.orig === doc.count.orig.toUpperCase();
    let hex = opts.count.toString(16).padStart(width, '0');
    if (upper) hex = hex.toUpperCase();
    edits.push([doc.count.start, doc.count.end, hex]);
  }
  edits.sort((a, b) => b[0] - a[0]);
  let text = doc.text;
  for (const [s, e, v] of edits) text = text.slice(0, s) + v + text.slice(e);
  return text;
}

// ---- memory name: 12 characters, stored as ASCII codes in NAME A..L ----

const NAME_TAGS = 'ABCDEFGHIJKL';

export function readName(doc) {
  const sec = section(doc, 'mem', 'NAME');
  if (!sec) return '';
  let out = '';
  for (const t of NAME_TAGS) out += String.fromCharCode(getNum(sec, t, 32));
  return out.replace(/\s+$/, '');
}

export function cleanName(name) {
  return [...String(name)].map((c) => (c >= ' ' && c <= '~' ? c : ' ')).join('').slice(0, 12);
}

export function writeName(doc, name) {
  const sec = section(doc, 'mem', 'NAME');
  if (!sec) return;
  const padded = cleanName(name).padEnd(12, ' ');
  [...NAME_TAGS].forEach((t, i) => setNum(sec, t, padded.charCodeAt(i)));
}

/**
 * Fast summary from the first few KB of a memory file (name, tempo, track lengths).
 * The text may be cut off, so this does not use the tokenizer.
 */
export function quickSummary(head) {
  const sec = (name) => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(head);
    if (!m) return null;
    const map = {};
    for (const f of m[1].matchAll(/<([A-Z])>(-?\d+)<\/\1>/g)) map[f[1]] = Number(f[2]);
    return map;
  };
  const name = sec('NAME');
  let text = '';
  if (name) for (const t of NAME_TAGS) text += String.fromCharCode(name[t] ?? 32);
  const tracks = [];
  for (let i = 1; i <= 6; i++) tracks.push(sec(`TRACK${i}`)?.X > 0);
  const master = sec('MASTER');
  return { name: text.replace(/\s+$/, ''), tracks, tempo: master?.A ? master.A / 10 : null };
}

/** The unit loads the copy with the higher count and writes the next save over the other one. */
export function pickCurrent(countA, countB) {
  if (countA == null) return 'B';
  if (countB == null) return 'A';
  return countB > countA ? 'B' : 'A';
}

export const pad3 = (n) => String(n).padStart(3, '0');
export const memoryFile = (slot, copy) => `MEMORY${pad3(slot)}${copy}.RC0`;
export const waveDir = (slot, track) => `${pad3(slot)}_${track}`;
export const waveFile = (slot, track) => `${pad3(slot)}_${track}.WAV`;
