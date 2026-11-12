// Standard MIDI File writer for drum patterns (format 0, channel 10).

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

/**
 * pattern: { bpm, beats, steps, lanes: [{ note, velocity, cells: [0|1, ...] }] }
 * Steps are 16th notes.
 */
export function patternToSmf(pattern, bars = 1) {
  const ppq = 480;
  const stepTicks = ppq / 4;
  const events = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const lane of pattern.lanes) {
      lane.cells.forEach((on, i) => {
        if (!on) return;
        const t = (bar * pattern.steps + i) * stepTicks;
        events.push([t, 1, 0x99, lane.note, lane.velocity]);
        events.push([t + stepTicks - 10, 0, 0x89, lane.note, 0]);
      });
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const usPerBeat = Math.round(60000000 / pattern.bpm);
  const track = [0, 0xff, 0x51, 3, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255];
  track.push(0, 0xff, 0x58, 4, pattern.beats, 2, 24, 8);
  let last = 0;
  for (const [t, , status, note, vel] of events) {
    track.push(...varLen(t - last), status, note, vel);
    last = t;
  }
  const end = bars * pattern.steps * stepTicks;
  track.push(...varLen(Math.max(0, end - last)), 0xff, 0x2f, 0);
  const len = track.length;
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255,
    0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255,
    ...track,
  ]);
}
