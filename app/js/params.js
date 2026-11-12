// Names for the lettered tags in the RC0 files.
//
// Roland does not document the file format. The names below follow the RC-600
// Parameter Guide and community mapping work. A tag that is not listed here is
// shown in the editor with its letter and raw number, so nothing is hidden.
//
// kinds:  bool | int (min, max) | enum (options) | bits (bit names)
// fmt:    pan (0..100, 50 = center) | tempo (value / 10)

import { GENRES, KITS } from './rhythm-data.js';

const en = (...labels) => labels.map((label, value) => ({ value, label }));
const range = (from, to, label = (n) => String(n), offset = 0) => {
  const out = [];
  for (let n = from; n <= to; n++) out.push({ value: n + offset, label: label(n) });
  return out;
};

const FADE = [...en('1/32', '1/16', '1/8', '1/4'), ...range(1, 64, (n) => `${n} MEAS`, 3)];
// Stored as the position in this list: 0 = 2/4, 2 = 4/4, 6 = 5/8.
const BEATS = en('2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '5/8', '6/8', '7/8', '8/8', '9/8', '10/8', '11/8', '12/8', '13/8', '14/8', '15/8');
const MIDI_CH = range(1, 16, (n) => `CH ${n}`, -1);
const INPUT_BITS = ['MIC 1', 'MIC 2', 'INST 1 L', 'INST 1 R', 'INST 2 L', 'INST 2 R', 'RHYTHM'];
const OUTS = ['MAIN L', 'MAIN R', 'SUB 1 L', 'SUB 1 R', 'SUB 2 L', 'SUB 2 R', 'PHONES'];
const TRACK_BITS = ['TRACK 1', 'TRACK 2', 'TRACK 3', 'TRACK 4', 'TRACK 5', 'TRACK 6'];

export const TRACK = {
  A: { name: 'Reverse', kind: 'bool' },
  B: { name: '1-Shot', kind: 'bool' },
  C: { name: 'Pan', kind: 'int', min: 0, max: 100, fmt: 'pan' },
  D: { name: 'Play Level', kind: 'int', min: 0, max: 200 },
  E: { name: 'Start Mode', kind: 'enum', options: en('IMMEDIATE', 'FADE') },
  F: { name: 'Stop Mode', kind: 'enum', options: en('IMMEDIATE', 'FADE', 'LOOP END') },
  G: { name: 'Dub Mode', kind: 'enum', options: en('OVERDUB', 'REPLACE 1', 'REPLACE 2') },
  H: { name: 'FX', kind: 'bool' },
  I: { name: 'Play Mode', kind: 'enum', options: en('MULTI', 'SINGLE') },
  J: { name: 'Measure (0 AUTO, 1 FREE)', kind: 'int', min: 0, max: 99999 },
  L: { name: 'Loop Sync', kind: 'bool' },
  M: { name: 'Tempo Sync', kind: 'bool' },
  N: { name: 'Tempo Sync Mode', kind: 'enum', options: en('PITCH', 'XFADE') },
  O: { name: 'Tempo Sync Speed', kind: 'enum', options: en('HALF', 'NORMAL', 'DOUBLE') },
  P: { name: 'Bounce In', kind: 'bool' },
  Q: { name: 'Input', kind: 'bits', bits: INPUT_BITS },
  S: { name: 'Measures Recorded', kind: 'int', min: 0, max: 99999, audio: true },
  U: { name: 'Recorded Tempo', kind: 'int', min: 400, max: 3000, fmt: 'tempo', audio: true },
  V: { name: 'Samples per Measure', kind: 'int', min: 0, max: 99999999, audio: true },
  X: { name: 'Length (samples)', kind: 'int', min: 0, max: 999999999, audio: true },
};
// These TRACK tags describe the recorded audio. A memory copy to another slot keeps them with the WAV files.
export const TRACK_AUDIO_TAGS = ['J', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];

const EQ = {
  A: { name: 'Switch', kind: 'bool' },
  B: { name: 'Lo Gain', kind: 'int', min: 0, max: 40 },
  C: { name: 'Hi Gain', kind: 'int', min: 0, max: 40 },
  F: { name: 'Lo-Mid Gain', kind: 'int', min: 0, max: 40 },
  I: { name: 'Hi-Mid Gain', kind: 'int', min: 0, max: 40 },
  J: { name: 'Level', kind: 'int', min: 0, max: 40 },
};

export const SECTIONS = {
  MASTER: {
    A: { name: 'Tempo', kind: 'int', min: 400, max: 3000, fmt: 'tempo' },
    B: { name: 'Samples per Measure', kind: 'int', min: 0, max: 99999999 },
  },
  REC: {
    A: { name: 'Rec Action', kind: 'enum', options: en('REC → DUB', 'REC → PLAY') },
    B: { name: 'Quantize', kind: 'enum', options: en('OFF', 'MEASURE') },
    C: { name: 'Auto Rec', kind: 'bool' },
    D: { name: 'Auto Rec Sens', kind: 'int', min: 1, max: 100 },
    E: { name: 'Bounce', kind: 'bool' },
    F: { name: 'Bounce Tracks', kind: 'bits', bits: TRACK_BITS },
  },
  PLAY: {
    B: { name: 'Fade Time In', kind: 'enum', options: FADE },
    C: { name: 'Fade Time Out', kind: 'enum', options: FADE },
    D: { name: 'All Start Tracks', kind: 'bits', bits: TRACK_BITS },
    E: { name: 'All Stop Tracks', kind: 'bits', bits: TRACK_BITS },
    F: { name: 'Loop Length (0 = AUTO)', kind: 'int', min: 0, max: 25362 },
  },
  RHYTHM: {
    A: { name: 'Genre', kind: 'enum', options: en(...GENRES) },
    B: { name: 'Pattern', kind: 'pattern' },
    C: { name: 'Variation', kind: 'enum', options: en('A', 'B', 'C', 'D') },
    D: { name: 'Variation Change', kind: 'enum', options: en('MEASURE', 'LOOP END') },
    E: { name: 'Kit', kind: 'enum', options: en(...KITS) },
    F: { name: 'Beat', kind: 'enum', options: BEATS },
    G: { name: 'Fill', kind: 'bool' },
    H: { name: 'Intro on Rec', kind: 'bool' },
    I: { name: 'Intro on Play', kind: 'bool' },
    J: { name: 'Ending', kind: 'bool' },
    K: { name: 'Start Trigger', kind: 'enum', options: en('LOOP START', 'REC END', 'BEFORE LOOP') },
    L: { name: 'Stop Trigger', kind: 'enum', options: en('OFF', 'LOOP STOP', 'REC END') },
  },
  INPUT: {
    A: { name: 'MIC 1 Phantom', kind: 'bool' },
    B: { name: 'MIC 2 Phantom', kind: 'bool' },
    C: { name: 'INST 1 Gain', kind: 'enum', options: en('INST', 'LINE') },
    D: { name: 'INST 2 Gain', kind: 'enum', options: en('INST', 'LINE') },
    E: { name: 'MIC Stereo Link', kind: 'bool' },
    F: { name: 'INST 1 Stereo Link', kind: 'bool' },
    G: { name: 'INST 2 Stereo Link', kind: 'bool' },
    H: { name: 'MIC 1 Comp', kind: 'int', min: 0, max: 100 },
    I: { name: 'MIC 1 Noise Supp', kind: 'int', min: 0, max: 100 },
    J: { name: 'MIC 2 Comp', kind: 'int', min: 0, max: 100 },
    K: { name: 'MIC 2 Noise Supp', kind: 'int', min: 0, max: 100 },
    L: { name: 'INST 1 Noise Supp', kind: 'int', min: 0, max: 100 },
    M: { name: 'INST 2 Noise Supp', kind: 'int', min: 0, max: 100 },
  },
  OUTPUT: {
    A: { name: 'Output Knob', kind: 'int', min: 0, max: 7 },
    B: { name: 'MAIN Stereo Link', kind: 'bool' },
    C: { name: 'SUB 1 Stereo Link', kind: 'bool' },
    D: { name: 'SUB 2 Stereo Link', kind: 'bool' },
  },
  ROUTING: {
    ...Object.fromEntries(OUTS.map((o, i) => ['ABCDEFG'[i], { name: `Tracks to ${o}`, kind: 'bits', bits: TRACK_BITS }])),
    ...Object.fromEntries(OUTS.map((o, i) => ['HIJKLMN'[i], { name: `Inputs to ${o}`, kind: 'bits', bits: INPUT_BITS }])),
  },
  MIXER: Object.fromEntries([
    ...['MIC 1', 'MIC 2', 'INST 1 L', 'INST 1 R', 'INST 2 L', 'INST 2 R'].flatMap((n, i) => [
      ['ABCDEFGHIJKL'[2 * i], { name: `${n} Level`, kind: 'int', min: 0, max: 200 }],
      ['ABCDEFGHIJKL'[2 * i + 1], { name: `${n} Mute`, kind: 'bool' }],
    ]),
    ...[...OUTS.slice(0, 6), 'Loop', 'Rhythm', 'Phones', 'Master'].map((n, i) => ['MNOPQRSTUV'[i], { name: `${n} Level`, kind: 'int', min: 0, max: 200 }]),
  ]),
  MASTER_FX: {
    A: { name: 'Comp', kind: 'int', min: 0, max: 40 },
    B: { name: 'Reverb', kind: 'int', min: 0, max: 40 },
    C: { name: 'Insert', kind: 'int', min: 0, max: 7 },
  },
  ASSIGN: {
    A: { name: 'Switch', kind: 'bool' },
    B: { name: 'Source', kind: 'int', min: 0, max: 255 },
    E: { name: 'Act Low', kind: 'int', min: 0, max: 127 },
    F: { name: 'Act High', kind: 'int', min: 0, max: 127 },
    G: { name: 'Target', kind: 'int', min: 0, max: 2047 },
    I: { name: 'Target Min', kind: 'int', min: 0, max: 200 },
    J: { name: 'Target Max', kind: 'int', min: 0, max: 200 },
  },
  PEDAL: {
    A: { name: 'Function', kind: 'int', min: 0, max: 216 },
  },
  FX_BANK: {
    A: { name: 'Switch', kind: 'bool' },
    B: { name: 'Mode', kind: 'enum', options: en('SINGLE', 'MULTI') },
    C: { name: 'FX Target', kind: 'enum', options: en('A', 'B', 'C', 'D') },
  },
  FX_SLOT: {
    A: { name: 'Switch', kind: 'bool' },
    B: { name: 'Switch Mode', kind: 'enum', options: en('TOGGLE', 'MOMENT') },
    C: { name: 'Type', kind: 'fxtype' },
    D: { name: 'Insert (0 = ALL)', kind: 'int', min: 0, max: 6 },
  },
  // system file
  USB: {
    A: { name: 'Storage', kind: 'int', min: 0, max: 1 },
    B: { name: 'Audio Mode', kind: 'int', min: 0, max: 1 },
    C: { name: 'Routing', kind: 'int', min: 0, max: 3 },
    D: { name: 'Input Level', kind: 'int', min: 0, max: 200 },
    E: { name: 'Output Level', kind: 'int', min: 0, max: 200 },
  },
  MIDI: {
    A: { name: 'Rx Control CH', kind: 'enum', options: MIDI_CH },
    C: { name: 'Rx Rhythm CH', kind: 'enum', options: MIDI_CH },
    D: { name: 'Rx Voice CH', kind: 'enum', options: MIDI_CH },
    E: { name: 'Tx CH', kind: 'int', min: 0, max: 16 },
    F: { name: 'Sync Clock', kind: 'enum', options: en('AUTO', 'INTERNAL') },
    G: { name: 'Clock Out', kind: 'bool' },
    H: { name: 'Start', kind: 'int', min: 0, max: 2 },
    I: { name: 'Program Change Out', kind: 'bool' },
    J: { name: 'Thru MIDI In', kind: 'int', min: 0, max: 3 },
    K: { name: 'Thru USB In', kind: 'int', min: 0, max: 3 },
  },
  SETUP: {
    A: { name: 'Memory Extent Min', kind: 'int', min: 0, max: 98 },
    B: { name: 'Display Mode', kind: 'int', min: 0, max: 7 },
    C: { name: 'Memory Extent Max', kind: 'int', min: 0, max: 98 },
    D: { name: 'Loop Indicator', kind: 'int', min: 0, max: 3 },
    E: { name: 'Orb Indicator', kind: 'int', min: 0, max: 3 },
    H: { name: 'Auto Off', kind: 'bool' },
    I: { name: 'Contrast', kind: 'int', min: 0, max: 10 },
  },
  COLOR: {
    A: { name: 'Rec Colour', kind: 'int', min: 0, max: 7 },
    B: { name: 'Play Colour', kind: 'int', min: 0, max: 7 },
    C: { name: 'Dub Colour', kind: 'int', min: 0, max: 7 },
    D: { name: 'Stop Colour', kind: 'int', min: 0, max: 7 },
    E: { name: 'Blank Colour', kind: 'int', min: 0, max: 7 },
  },
};

/** Parameter definitions for a section name ("TRACK3", "ASSIGN12", "EQ_MIC1", ...). */
export function defsFor(sectionName) {
  if (/^TRACK\d$/.test(sectionName)) return TRACK;
  if (/^ASSIGN\d+$/.test(sectionName)) return SECTIONS.ASSIGN;
  if (/^EQ_/.test(sectionName)) return EQ;
  if (/^ICTL\d_PEDAL\d$/.test(sectionName)) return SECTIONS.PEDAL;
  if (/^[A-D]$/.test(sectionName)) return SECTIONS.FX_BANK;
  if (/^[A-D][A-D]$/.test(sectionName)) return SECTIONS.FX_SLOT;
  return SECTIONS[sectionName] || {};
}

export function panLabel(v) {
  if (v === 50) return 'CENTER';
  return v < 50 ? `L${50 - v}` : `R${v - 50}`;
}

export function formatValue(def, value) {
  if (!def) return String(value);
  if (def.fmt === 'pan') return panLabel(value);
  if (def.fmt === 'tempo') return (value / 10).toFixed(1);
  if (def.kind === 'bool') return value ? 'ON' : 'OFF';
  if (def.kind === 'enum') return def.options.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

/** Samples in one measure at a tempo (bpm) and a number of beats per measure. */
export const samplesPerMeasure = (bpm, beats = 4) => Math.round((44100 * 60 * beats) / bpm);

/** Quarter notes per measure from the RHYTHM "Beat" value (0..5 = 2/4..7/4, 6..16 = 5/8..15/8). */
export function beatsFromRhythm(value) {
  if (value >= 0 && value <= 5) return value + 2;
  if (value >= 6 && value <= 16) return (value - 1) / 2;
  return 4;
}
