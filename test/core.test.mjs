// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rc from '../app/js/rc0.js';
import { demoBackend, bytesToText, textToBytes } from '../app/js/backend.js';
import { Device } from '../app/js/device.js';
import { decodeWav, encodeRcWav, encodePcm16, wavInfo, mixTracks, resampleLinear } from '../app/js/wav.js';
import { measuresToSmf } from '../app/js/smf.js';

// The same shape as a file from the unit: tabs, digit and "#" tags, <count> after the root.
const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<database name="RC-600" revision="0">
<mem id="4">
<NAME>
${[...'Hello World '].map((c, i) => `\t<${'ABCDEFGHIJKL'[i]}>${c.charCodeAt(0)}</${'ABCDEFGHIJKL'[i]}>`).join('\n')}
</NAME>
<TRACK1>
\t<A>0</A>
\t<C>50</C>
\t<D>100</D>
\t<X>0</X>
</TRACK1>
<MASTER>
\t<A>1200</A>
</MASTER>
</mem>
<ifx id="4">
<AA_SEQ>
\t<0>1</0>
\t<9>2</9>
\t<#>3</#>
</AA_SEQ>
</ifx>
</database>
<count>00FF</count>
`;

test('rc0: parse and byte-exact round trip', () => {
  const doc = rc.parseRc0(SAMPLE);
  assert.equal(rc.serialize(doc), SAMPLE);
  assert.deepEqual(doc.blocks.map((b) => [b.name, b.id]), [['mem', 4], ['ifx', 4]]);
  assert.equal(rc.readName(doc), 'Hello World');
  assert.equal(rc.countOf(doc), 255);
  assert.equal(rc.getNum(rc.section(doc, 'ifx', 'AA_SEQ'), '#'), 3);
  assert.equal(rc.isDirty(doc), false);
});

test('rc0: an edit changes only the value, the count and the ids', () => {
  const doc = rc.parseRc0(SAMPLE);
  rc.setNum(rc.section(doc, 'mem', 'TRACK1'), 'D', 7);
  rc.writeName(doc, 'Dub é too long name');
  assert.equal(rc.isDirty(doc), true);
  const out = rc.serialize(doc, { count: 256, id: 11 });
  const expected = SAMPLE.replace('<D>100</D>', '<D>7</D>').replace('00FF', '0100').replaceAll('id="4"', 'id="11"');
  const again = rc.parseRc0(out);
  assert.equal(rc.readName(again), 'Dub   too lo');
  rc.writeName(again, 'Hello World');
  assert.equal(rc.serialize(again), expected);
  assert.equal(rc.setNum(rc.section(doc, 'mem', 'TRACK1'), 'Z', 1), false, 'fields are never added');
  assert.throws(() => rc.serialize(doc, { count: 0x10000 }), /FFFF/);
  rc.revert(doc);
  assert.equal(rc.serialize(doc), SAMPLE);
});

test('rc0: quick summary and A/B choice', () => {
  const s = rc.quickSummary(SAMPLE.slice(0, 600));
  assert.equal(s.name, 'Hello World');
  assert.equal(s.tempo, 120);
  assert.equal(rc.pickCurrent(5, 6), 'B');
  assert.equal(rc.pickCurrent(6, 5), 'A');
  assert.equal(rc.pickCurrent(null, 0), 'B');
  assert.equal(rc.memoryFile(7, 'A'), 'MEMORY007A.RC0');
  assert.equal(rc.waveFile(12, 3), '012_3.WAV');
});

test('wav: looper format header and decode', () => {
  const L = Float32Array.from([0, 0.5, -0.5, 1]);
  const R = Float32Array.from([0.25, 0, 0, -1]);
  const bytes = encodeRcWav(L, R);
  assert.equal(bytes.length, 56 + 32);
  const info = wavInfo(bytes);
  assert.deepEqual([info.format, info.channels, info.rate, info.bits, info.frames, info.dataOffset], [3, 2, 44100, 32, 4, 56]);
  const back = decodeWav(bytes);
  assert.deepEqual([...back.channels[0]], [...L]);
  assert.deepEqual([...back.channels[1]], [...R]);
  const pcm = decodeWav(encodePcm16(L, R));
  assert.ok(Math.abs(pcm.channels[0][1] - 0.5) < 1e-3);
  assert.equal(resampleLinear(new Float32Array(48000), 48000, 44100).length, 44100);
  const [mixL] = mixTracks([{ left: L, right: R, level: 1, pan: 0.5 }, { left: L.slice(0, 2), right: R.slice(0, 2), level: 2, pan: 0.5 }]);
  assert.deepEqual([...mixL], [0, 1.5, -0.5, 2]);
});

test('smf: header and track length', () => {
  const bytes = measuresToSmf({ tempo: 120, measures: [[0, 96, 192, 288, 380].map((tick) => ({ tick, note: 36, velocity: 100 }))] });
  assert.equal(bytesToText(bytes.subarray(0, 4)), 'MThd');
  assert.equal(bytesToText(bytes.subarray(14, 18)), 'MTrk');
  const len = new DataView(bytes.buffer).getUint32(18);
  assert.equal(bytes.length, 22 + len);
  assert.deepEqual([...bytes.subarray(-3)], [0xff, 0x2f, 0]);
});

test('device: scan, save with A/B rotation, audio, copy and swap', async () => {
  const backend = demoBackend();
  const [volume] = await backend.findVolumes();
  const dev = new Device(backend, volume);
  assert.equal(await dev.scan(), 99);
  assert.equal(dev.memories[0].name, 'NEON RUNNER');
  assert.deepEqual(dev.memories[0].tracks, [true, true, true, true, false, false]);
  assert.equal(dev.memories[0].current, 'A');

  // Save: goes to the other copy with count + 1, the old copy is untouched.
  const before = bytesToText(await backend.read(dev.dataPath('MEMORY001A.RC0')));
  let doc = await dev.loadMemory(1);
  rc.setNum(rc.section(doc, 'mem', 'TRACK1'), 'D', 42);
  doc = await dev.saveMemory(1, doc);
  assert.equal(rc.isDirty(doc), false);
  assert.deepEqual([dev.memories[0].current, dev.memories[0].counts.B], ['B', 2]);
  assert.equal(bytesToText(await backend.read(dev.dataPath('MEMORY001A.RC0'))), before);
  const fresh = new Device(backend, volume);
  await fresh.scan();
  assert.equal(fresh.memories[0].current, 'B');
  assert.equal(rc.getNum(rc.section(await fresh.loadMemory(1), 'mem', 'TRACK1'), 'D'), 42);

  // Import audio into an empty track: 2 measures at 96 BPM.
  const frames = 220500;
  await dev.putTrackAudio(1, 5, new Float32Array(frames), new Float32Array(frames), doc);
  doc = await dev.saveMemory(1, doc);
  const t5 = rc.section(doc, 'mem', 'TRACK5');
  assert.deepEqual(['U', 'V', 'W', 'X'].map((t) => rc.getNum(t5, t)), [960, 110250, 1, frames]);
  assert.equal((await dev.trackFiles(1))[4].size, 56 + frames * 8);
  await dev.clearTrackAudio(1, 5, doc);
  doc = await dev.saveMemory(1, doc);
  assert.equal((await dev.trackFiles(1))[4], null);
  assert.equal(rc.getNum(rc.section(doc, 'mem', 'TRACK5'), 'X'), 0);

  // Copy 1 -> 2 with loops: ids follow the slot, loops are renamed.
  await dev.copyMemory(1, 2, true);
  const two = await dev.loadMemory(2);
  assert.deepEqual(two.blocks.map((b) => b.id), [1, 1, 1]);
  assert.equal(rc.readName(two), 'NEON RUNNER');
  assert.equal((await dev.trackFiles(2))[0].name, '002_1.WAV');

  // Copy 3 -> 1 without loops: memory 1 keeps its loops and their tags.
  await dev.copyMemory(3, 1, false);
  const one = await dev.loadMemory(1);
  assert.equal(rc.readName(one), 'TOKYO DRIFT');
  assert.equal(rc.getNum(rc.section(one, 'mem', 'TRACK4'), 'X'), 220500);
  assert.equal((await dev.trackFiles(1)).filter(Boolean).length, 4);

  // Swap 3 <-> 7.
  await dev.swapMemories(3, 7);
  assert.equal(dev.memories[2].name, 'FUNK JAM');
  assert.equal(dev.memories[6].name, 'TOKYO DRIFT');
  assert.deepEqual((await dev.trackFiles(3)).map(Boolean), [true, false, true, false, false, false]);
  assert.deepEqual((await dev.trackFiles(7)).map(Boolean), [true, true, false, false, false, false]);
  assert.deepEqual((await dev.loadMemory(7)).blocks.map((b) => b.id), [6, 6, 6]);

  // System pair.
  let sys = await dev.loadSystem();
  rc.setNum(rc.section(sys, 'sys', 'USB'), 'D', 150);
  sys = await dev.saveSystem(sys);
  assert.equal(rc.getNum(rc.section(await dev.loadSystem(), 'sys', 'USB'), 'D'), 150);
  assert.equal(textToBytes('abc').length, 3);
});

test('rhythm file: record round trip and file layout', async () => {
  const { encodeRecord, decodeRecord, writeRhythmFile, readRhythmFile, RECORD_SIZE } = await import('../app/js/rhythm-file.js');
  const measure = [{ tick: 0, note: 36, velocity: 110 }, { tick: 192, note: 38, velocity: 100 }, { tick: 192, note: 42, velocity: 80 }];
  const rec = encodeRecord({ name: 'Trap Test', kit: 15, tempo: 140, parts: Array.from({ length: 10 }, (_, i) => (i === 1 ? [measure, measure] : [measure])) });
  assert.equal(rec.length, RECORD_SIZE);
  assert.equal(bytesToText(rec.subarray(0, 9)), 'TRAP^TEST');
  const d = decodeRecord(rec);
  assert.deepEqual([d.name, d.kit, d.tempo, d.beats, d.unit, d.notes.length, d.endTick], ['TRAP TEST', 15, 140, 4, 4, 33, 11 * 384]);
  assert.deepEqual(d.parts.slice(0, 3), [{ from: 0, measures: 1 }, { from: 1, measures: 2 }, { from: 3, measures: 1 }]);
  // Entry count includes the end marker; notes on the same tick are in rising note order.
  assert.equal(new DataView(rec.buffer).getUint16(36, true), 34);
  assert.deepEqual([...rec.subarray(184 + 4, 184 + 12)], [192, 0, 38, 100, 0, 0, 42, 80]);
  const file = writeRhythmFile([rec]);
  assert.equal(file.length, 12 + 50 * RECORD_SIZE);
  assert.equal(new DataView(file.buffer).getUint32(8, true), RECORD_SIZE);
  assert.deepEqual(readRhythmFile(file), [rec]);
  assert.throws(() => encodeRecord({ name: 'X', kit: 0, tempo: 120, parts: [[measure]] }), /10 parts/);
});

test('rhythm presets encode and survive a decode', async () => {
  const { PRESETS } = await import('../app/js/rhythm-presets.js');
  const { encodeRecord, decodeRecord } = await import('../app/js/rhythm-file.js');
  assert.equal(PRESETS.length, 6);
  for (const p of PRESETS) {
    const d = decodeRecord(encodeRecord(p));
    assert.equal(d.name, p.name);
    assert.equal(d.notes.length, p.parts.flat(2).length);
    assert.equal(d.endTick, p.parts.flat().length * 384);
  }
});

test('device: user rhythms are read and replaced as a whole file', async () => {
  const { encodeRecord, decodeRecord } = await import('../app/js/rhythm-file.js');
  const { PRESETS } = await import('../app/js/rhythm-presets.js');
  const backend = demoBackend();
  const dev = new Device(backend, (await backend.findVolumes())[0]);
  await dev.scan();
  const records = await dev.loadRhythms();
  assert.deepEqual(records.map((r) => decodeRecord(r).name), ['TRAP ATLANTA', 'TRAP DRILL', 'TRAP DARK']);
  await dev.saveRhythms([records[0], encodeRecord(PRESETS[5])]);
  const again = await dev.loadRhythms();
  assert.deepEqual(again.map((r) => decodeRecord(r).name), ['TRAP ATLANTA', 'TRAP SOUL']);
  assert.deepEqual(again[0], records[0]);
});

test('import: memories land in the chosen slot and user rhythms are matched by name', async () => {
  const { scanImport, applyImport, planRhythms } = await import('../app/js/importer.js');
  const { encodeRecord, decodeRecord } = await import('../app/js/rhythm-file.js');
  const { PRESETS } = await import('../app/js/rhythm-presets.js');
  const backend = demoBackend();
  const dev = new Device(backend, (await backend.findVolumes())[0]);
  await dev.scan();
  // Package: memory 3 uses user rhythm 2 (TRAP DARK) of a package rhythm file in another order.
  const pkgRhythms = [PRESETS[5], PRESETS[0], PRESETS[2]].map(encodeRecord);
  const mem = rc.parseRc0(bytesToText(await backend.read(dev.dataPath('MEMORY003A.RC0'))));
  rc.setNum(rc.section(mem, 'mem', 'RHYTHM'), 'A', 20);
  rc.setNum(rc.section(mem, 'mem', 'RHYTHM'), 'B', 2);
  rc.writeName(mem, 'PKG MEM');
  const root = '/Volumes/RC-600 (DEMO)/ROLAND/PKG';
  const { writeRhythmFile } = await import('../app/js/rhythm-file.js');
  await backend.write(`${root}/DATA/MEMORY003A.RC0`, textToBytes(rc.serialize(mem, { count: 5 })));
  await backend.write(`${root}/DATA/MEMORY003B.RC0`, textToBytes(rc.serialize(mem, { count: 2 }).replace('PKG', 'OLD')));
  await backend.write(`${root}/DATA/RHYTHM.RC0`, writeRhythmFile(pkgRhythms));

  const scan = await scanImport(backend, root);
  assert.deepEqual(scan.memories.map((m) => [m.slot, m.name, m.userRhythm, m.rhythmName]), [[3, 'PKG MEM', 2, 'TRAP DARK']]);

  // The looper has DRILL and ATLANTA: SOUL and DARK are added in package order, so DARK moves to index 3.
  await dev.saveRhythms([PRESETS[1], PRESETS[0]].map(encodeRecord));
  const plan = planRhythms(await dev.loadRhythms(), pkgRhythms);
  assert.deepEqual(plan.names, ['TRAP DRILL', 'TRAP ATLANTA', 'TRAP SOUL', 'TRAP DARK']);

  // Memory 7 has loops in the demo; import onto slot 7.
  assert.ok(dev.memories[6].tracks.some(Boolean));
  const out = await applyImport(dev, scan, [{ memory: scan.memories[0], to: 7 }]);
  assert.deepEqual(out.addedRhythms, ['TRAP SOUL', 'TRAP DARK']);
  const seven = await dev.loadMemory(7);
  assert.equal(rc.readName(seven), 'PKG MEM');
  assert.deepEqual(seven.blocks.map((b) => b.id), [6, 6, 6]);
  assert.equal(rc.getNum(rc.section(seven, 'mem', 'RHYTHM'), 'B'), 3);
  assert.deepEqual((await dev.trackFiles(7)).filter(Boolean), []);
  assert.deepEqual((await dev.loadRhythms()).map((r) => decodeRecord(r).name), plan.names);
});
