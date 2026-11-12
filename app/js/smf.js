// Standard MIDI File writer for drum parts (format 0, channel 10, 96 ticks per quarter note).

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

/**
 * measures: list of measures, each a list of { tick, note, velocity } with the
 * tick counted from the start of its measure.
 */
export function measuresToSmf({ tempo, beats = 4, unit = 4, measures }) {
  const measureTicks = (beats * 384) / unit;
  const total = measures.length * measureTicks;
  const events = [];
  measures.forEach((notes, m) => notes.forEach((n) => {
    const at = m * measureTicks + n.tick;
    events.push([at, 1, 0x99, n.note, n.velocity]);
    events.push([Math.min(at + 10, total), 0, 0x89, n.note, 0]);
  }));
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const usPerBeat = Math.round(60000000 / tempo);
  const track = [0, 0xff, 0x51, 3, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255];
  track.push(0, 0xff, 0x58, 4, beats, Math.log2(unit), 24, 8);
  let last = 0;
  for (const [t, , status, note, vel] of events) {
    track.push(...varLen(t - last), status, note, vel);
    last = t;
  }
  track.push(...varLen(total - last), 0xff, 0x2f, 0);
  const len = track.length;
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255,
    ...track,
  ]);
}
