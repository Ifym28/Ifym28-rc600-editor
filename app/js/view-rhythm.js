// Rhythm: editor for the user rhythms of the looper (ROLAND/DATA/RHYTHM.RC0),
// and the rhythm settings of the current memory.
//
// The looper has fixed drum kits. What can be edited is which kit plays, how
// loud the rhythm is, and every hit of a user rhythm: its drum sound, its
// position and its velocity.

import * as rc from './rc0.js';
import { S, run } from './store.js';
import { h, label, panel, btn, toast, confirm, sectionPanel, paramControl } from './ui.js';
import * as audio from './audio.js';
import { measuresToSmf } from './smf.js';
import { KITS } from './rhythm-data.js';
import { decodeRecord, encodeRecord, PART_NAMES, MAX_RECORDS, MAX_ENTRIES } from './rhythm-file.js';
import { PRESETS } from './rhythm-presets.js';
import { samplesPerMeasure } from './params.js';
import { assignSample, clearSample, sampleName, sampleCount, restoreSamples } from './samples.js';
import { putLoop } from './view-audio.js';
import { encodeRcWav } from './wav.js';

const USER_GENRE = 20; // position of "User" in the genre list
const GRIDS = [[24, '1/16'], [12, '1/32'], [16, '1/16 triplet'], [8, '1/32 triplet']];
const VELOCITIES = [60, 90, 110, 125];
const DEFAULT_LANES = [46, 42, 39, 38, 36];

const ui = {
  loadedFor: null, list: null, error: null, index: 0, part: 1, measure: 0, grid: 24,
  playing: false, timer: 0, mute: new Set(), solo: new Set(), newVelocity: 100, lanes: new Map(), withTempo: true,
  repeat: 1, track: 6,
};

restoreSamples().then((n) => n && S.render()).catch(() => {});

const measureTicks = (r) => (r.beats * 384) / r.unit;

function toModel(raw) {
  const d = decodeRecord(raw);
  const mt = (d.beats * 384) / d.unit || 384;
  const parts = d.parts.map((p) => Array.from({ length: Math.max(1, p.measures) }, (_, k) =>
    d.notes.filter((n) => Math.floor(n.tick / mt) === p.from + k).map((n) => ({ tick: n.tick - (p.from + k) * mt, note: n.note, velocity: n.velocity }))));
  return { name: d.name, kit: d.kit, tempo: d.tempo, beats: d.beats || 4, unit: d.unit || 4, parts, raw, modified: false };
}

const fromPreset = (p) => ({ ...structuredClone(p), beats: 4, unit: 4, raw: null, modified: true });
const emptyRhythm = (n) => ({ name: `RHYTHM ${n}`, kit: 0, tempo: 120, beats: 4, unit: 4, parts: PART_NAMES.map(() => [[]]), raw: null, modified: true });

const current = () => ui.list?.[Math.min(ui.index, ui.list.length - 1)] || null;
export const rhythmDirty = () => !!ui.list && (ui.list.some((r) => r.modified) || ui.removed);

function touch(r) {
  r.modified = true;
  const b = document.getElementById('btn-rhy-write');
  if (b) b.disabled = false;
}

async function load() {
  const want = S.device;
  ui.loadedFor = want;
  ui.list = null;
  ui.error = null;
  ui.removed = false;
  try {
    const records = await want.loadRhythms();
    if (ui.loadedFor !== want) return;
    ui.list = records.map(toModel);
    ui.index = 0;
  } catch (e) {
    ui.error = e.message;
  }
  S.render();
}

export async function writeRhythms() {
  await run(async () => {
    const records = ui.list.map((r) => (r.modified || !r.raw ? encodeRecord(r) : r.raw));
    await S.device.saveRhythms(records);
    ui.list = records.map(toModel);
    ui.removed = false;
  }, () => `${ui.list.length} user rhythm(s) written to RHYTHM.RC0`);
}

export function forgetRhythms() {
  stopRhythm();
  ui.loadedFor = null;
  ui.list = null;
}

S.pending.push({ label: 'user rhythms', dirty: rhythmDirty, write: writeRhythms, discard: () => { ui.loadedFor = null; ui.list = null; } });

// ---------------------------------------------------------------- preview

export function stopRhythm() {
  clearInterval(ui.timer);
  ui.playing = false;
}

function startPreview() {
  stopRhythm();
  const r = current();
  if (!r) return;
  const ac = audio.audioContext();
  const mt = measureTicks(r);
  ui.playing = true;
  let origin = ac.currentTime + 0.08; // time of tick 0 of the current pass
  let cursor = 0; // next tick to schedule within the pass
  ui.timer = setInterval(() => {
    const part = r.parts[ui.part];
    const total = part.length * mt;
    const secPerTick = 60 / r.tempo / 96;
    const horizon = ac.currentTime + 0.15;
    for (;;) {
      const until = Math.min(total, (horizon - origin) / secPerTick);
      part.forEach((notes, m) => {
        for (const n of notes) {
          const t = m * mt + n.tick;
          if (t < cursor || t >= until) continue;
          if (ui.mute.has(n.note) || (ui.solo.size && !ui.solo.has(n.note))) continue;
          audio.drumNote(n.note, origin + t * secPerTick, n.velocity);
        }
      });
      cursor = until;
      if (until < total) break;
      origin += total * secPerTick;
      cursor = 0;
    }
    // playhead
    const now = ((ac.currentTime - origin) / secPerTick + total) % total;
    const step = Math.floor(now / mt) === ui.measure ? Math.floor((now % mt) / ui.grid) : -1;
    document.querySelectorAll('.step.now').forEach((el) => el.classList.remove('now'));
    if (step >= 0) document.querySelectorAll(`.step[data-i="${step}"]`).forEach((el) => el.classList.add('now'));
  }, 25);
}

// ---------------------------------------------------------------- grid

function laneNotes(r) {
  const used = new Set(r.parts.flat(2).map((n) => n.note));
  for (const n of ui.lanes.get(r) || DEFAULT_LANES) used.add(n);
  const order = audio.DRUM_NOTES.map((d) => d.note);
  return [...used].sort((a, b) => (order.indexOf(a) + 100) % 100 - (order.indexOf(b) + 100) % 100 || a - b);
}

function laneRow(r, note) {
  const mt = measureTicks(r);
  const notes = r.parts[ui.part][ui.measure];
  const steps = Math.floor(mt / ui.grid);
  const perBeat = Math.round(384 / r.unit / ui.grid);
  const cells = h('div', { class: 'steps', style: { gridTemplateColumns: `repeat(${steps}, 1fr)` } }, Array.from({ length: steps }, (_, i) => {
    const at = i * ui.grid;
    const exact = () => notes.find((n) => n.note === note && n.tick === at);
    const near = () => notes.some((n) => n.note === note && n.tick > at && n.tick < at + ui.grid);
    const cell = h('button', { class: 'step', 'data-i': i, title: 'Click: hit on or off. Shift-click or right-click: velocity.' });
    const paint = () => {
      const n = exact();
      cell.className = `step${i % perBeat === 0 ? ' beat' : ''}${n ? ' on' : near() ? ' part' : ''}`;
      cell.textContent = n ? `${n.velocity}${near() ? '+' : ''}` : steps <= 16 ? i + 1 : '';
      cell.style.opacity = n ? 0.45 + (0.55 * n.velocity) / 127 : '';
    };
    const cycle = () => {
      const n = exact();
      if (!n) return;
      n.velocity = VELOCITIES.find((v) => v > n.velocity) ?? VELOCITIES[0];
      audio.drumNote(note, audio.audioContext().currentTime, n.velocity);
      touch(r);
      paint();
    };
    cell.onclick = (e) => {
      if (e.shiftKey) return cycle();
      const n = exact();
      if (n) notes.splice(notes.indexOf(n), 1);
      else {
        notes.push({ tick: at, note, velocity: ui.newVelocity });
        if (!ui.playing) audio.drumNote(note, audio.audioContext().currentTime, ui.newVelocity);
      }
      touch(r);
      paint();
    };
    cell.oncontextmenu = (e) => { e.preventDefault(); cycle(); };
    paint();
    return cell;
  }));
  const count = notes.filter((n) => n.note === note).length;
  const flip = (set) => { set.has(note) ? set.delete(note) : set.add(note); S.render(); };
  return h('div', { class: 'lane' },
    h('div', {},
      h('select', { title: 'Drum sound of this lane. A change moves every hit of the lane, in all parts, to the new sound.', onchange: (e) => {
        const to = Number(e.target.value);
        for (const n of r.parts.flat(2)) if (n.note === note) n.note = to;
        ui.lanes.set(r, (ui.lanes.get(r) || DEFAULT_LANES).map((x) => (x === note ? to : x)));
        touch(r);
        S.render();
      } }, audio.DRUM_NOTES.map((d) => h('option', { value: d.note, selected: d.note === note }, `${d.name} · ${d.note}`)),
        !audio.DRUM_NOTES.some((d) => d.note === note) && h('option', { value: note, selected: true }, `Note ${note}`)),
      h('div', { class: 'row', style: { marginTop: '4px', gap: '4px' } },
        btn('M', () => flip(ui.mute), `small ${ui.mute.has(note) ? 'on' : ''}`, { title: 'Mute in the preview' }),
        btn('S', () => flip(ui.solo), `small ${ui.solo.has(note) ? 'active' : ''}`, { title: 'Solo in the preview' }),
        btn('Clear', () => { r.parts[ui.part][ui.measure] = notes.filter((n) => n.note !== note); touch(r); S.render(); }, 'small', { disabled: !count, title: `${count} hit(s) in this measure` }),
        btn(sampleName(note) ? 'Sample ✓' : 'Sample…', async () => {
          const f = await S.backend.openFile(['wav', 'aif', 'aiff', 'mp3', 'm4a', 'flac', 'ogg']);
          if (!f) return;
          await run(() => assignSample(note, f.name, f.bytes), `${f.name} is now the ${audio.drumName(note)} sample`);
          audio.drumNote(note, audio.audioContext().currentTime, 110);
        }, `small ${sampleName(note) ? 'on' : 'ghost'}`, { title: sampleName(note) ? `Own sample: ${sampleName(note)}` : 'Use your own sample for this drum sound (preview and loop render)' }),
        sampleName(note) && btn('×', async () => { await clearSample(note); S.render(); }, 'small ghost', { title: 'Back to the synth sound' }))),
    cells);
}

// ---------------------------------------------------------------- view

function useInMemory(r) {
  const sec = rc.section(S.doc, 'mem', 'RHYTHM');
  rc.setNum(sec, 'A', USER_GENRE);
  rc.setNum(sec, 'B', ui.list.indexOf(r));
  rc.setNum(sec, 'E', r.kit);
  if (ui.withTempo) {
    const master = rc.section(S.doc, 'mem', 'MASTER');
    rc.setNum(master, 'A', r.tempo * 10);
    rc.setNum(master, 'B', samplesPerMeasure(r.tempo, (r.beats * 4) / r.unit));
  }
  toast(`Memory ${S.slot} now uses "${r.name}". Press Write to store the memory.`);
  S.render();
}

function memoryPanel() {
  const sec = rc.section(S.doc, 'mem', 'RHYTHM');
  const mixer = rc.section(S.doc, 'mem', 'MIXER');
  const ctx = { genre: () => rc.getNum(sec, 'A'), onChange: (s, tag) => {
    if (s?.name === 'RHYTHM' && tag === 'A') { rc.setNum(sec, 'B', 0); S.render(); } else S.refreshChrome();
  } };
  const p = sectionPanel(sec, ctx, `RHYTHM OF MEMORY ${String(S.slot).padStart(2, '0')}`, '設定');
  const level = mixer && paramControl(mixer, 'T', ctx, { name: 'Rhythm Level', kind: 'int', min: 0, max: 200 });
  if (level) p.querySelector('.fields').prepend(level);
  if (rc.getNum(sec, 'A') === USER_GENRE && ui.list) {
    const r = ui.list[rc.getNum(sec, 'B')];
    p.append(h('div', { class: 'note' }, r ? `This memory plays the user rhythm "${r.name}".` : 'This memory points to a user rhythm that does not exist.'));
  }
  return p;
}

function renderPanel(r) {
  const part = r.parts[ui.part];
  const tempo = rc.getNum(rc.section(S.doc, 'mem', 'MASTER'), 'A', 1200) / 10;
  const render = () => {
    const measures = Array.from({ length: ui.repeat }, () => part).flat();
    return audio.renderDrumLoop(measures, measureTicks(r), tempo);
  };
  return panel('flat', label('サンプル', `OWN SAMPLES · ${sampleCount()} LOADED`),
    h('div', { class: 'note', style: { marginBottom: '10px' } },
      'The drum kits inside the looper are fixed and cannot be replaced. To play your own sounds, load a sample on each lane (Sample…), then render this part as a loop onto a track. The looper then plays it like any other loop, in sync with the memory tempo.'),
    h('div', { class: 'row wrap' },
      h('span', { class: 'code' }, 'REPEAT'),
      h('select', { style: { width: '74px' }, onchange: (e) => (ui.repeat = Number(e.target.value)) }, [1, 2, 4].map((n) => h('option', { value: n, selected: n === ui.repeat }, `${n} ×`))),
      h('span', { class: 'code' }, 'TO'),
      h('select', { style: { width: '150px' }, onchange: (e) => (ui.track = Number(e.target.value)) },
        [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: n === ui.track }, `Track ${n}${S.device.waveDirs.has(rc.waveDir(S.slot, n)) ? ' (in use)' : ' (empty)'}`))),
      btn('Render to track', async () => {
        stopRhythm();
        const loop = await run(render);
        if (loop) await putLoop(ui.track, loop.left, loop.right, `${r.name} ${PART_NAMES[ui.part]}`);
      }, 'small primary'),
      btn('Export WAV', async () => {
        const loop = await run(render);
        const name = `${r.name.replace(/[^\w-]+/g, '_')}_${PART_NAMES[ui.part].replace(' ', '_')}_${Math.round(tempo)}bpm.wav`;
        if (loop && (await S.backend.saveFile(name, encodeRcWav(loop.left, loop.right)))) toast(`Exported ${name}`);
      }, 'small'),
      h('span', { class: 'note' }, `${PART_NAMES[ui.part]}, ${part.length * ui.repeat} measure(s) at the memory tempo of ${tempo} BPM = ${((part.length * ui.repeat * measureTicks(r) * 60) / tempo / 96).toFixed(2)} s`)));
}

export function rhythmView() {
  if (ui.loadedFor !== S.device) {
    stopRhythm();
    load();
    return panel('flat', h('div', { class: 'note' }, 'Reading user rhythms…'));
  }
  if (ui.error) {
    return h('div', { class: 'stack' },
      panel('hot', label('警告', 'RHYTHM FILE'), h('div', { class: 'title' }, 'RHYTHM.RC0 could not be read'),
        h('div', { class: 'sub', style: { marginTop: '6px' } }, `${ui.error}. The file is left as it is and the rhythm editor is off.`)),
      memoryPanel());
  }
  if (!ui.list) return panel('flat', h('div', { class: 'note' }, 'Reading user rhythms…'));

  const r = current();
  const redraw = (model) => { if (model) touch(model); S.render(); };
  const add = (model) => {
    if (ui.list.length >= MAX_RECORDS) return void toast(`The looper holds at most ${MAX_RECORDS} user rhythms.`, true);
    ui.list.push(model);
    ui.index = ui.list.length - 1;
    ui.part = 1;
    ui.measure = 0;
    S.render();
  };
  const presetSelect = h('select', { onchange: (e) => { if (e.target.value !== '') add(fromPreset(PRESETS[Number(e.target.value)])); } },
    h('option', { value: '' }, '+ Add trap preset…'), PRESETS.map((p, i) => h('option', { value: i }, `${p.name} · ${p.tempo}`)));

  const listPanel = panel('tight', label('ユーザー', `USER RHYTHMS · ${ui.list.length}/${MAX_RECORDS}`),
    h('div', { class: 'list' }, ui.list.map((x, i) =>
      h('button', { class: `item${x === r ? ' active' : ''}`, onclick: () => { stopRhythm(); ui.index = i; ui.part = 1; ui.measure = 0; S.render(); } },
        h('div', { class: 'ix' }, `${String(i + 1).padStart(2, '0')}`, x.modified ? h('span', { class: 'amber' }, 'EDITED') : ''),
        h('div', { class: 't' }, x.name || '(no name)'),
        h('div', { class: 'ix' }, `${x.tempo} BPM · ${KITS[x.kit] ?? `KIT ${x.kit}`}`)))),
    !ui.list.length && h('div', { class: 'note' }, 'No user rhythms on the looper yet.'),
    h('div', { class: 'row wrap', style: { marginTop: '8px', gap: '4px' } },
      btn('New', () => add(emptyRhythm(ui.list.length + 1)), 'small'),
      btn('Copy', () => add({ ...structuredClone({ ...r, raw: null }), name: `${r.name}`.slice(0, 10) + ' 2', modified: true }), 'small', { disabled: !r }),
      btn('Delete', async () => {
        if (!(await confirm('Delete user rhythm', `"${r.name}" is removed. Rhythms after it move up one place, so memories that use them will point to a different rhythm.`, 'Delete', 'danger'))) return;
        stopRhythm();
        ui.list.splice(ui.index, 1);
        ui.index = Math.max(0, ui.index - 1);
        ui.removed = true;
        S.render();
      }, 'small danger', { disabled: !r })),
    h('div', { style: { marginTop: '6px' } }, presetSelect),
    h('div', { class: 'hazard red-stripes', style: { height: '3px', margin: '10px 0' } }),
    h('div', { class: 'row wrap', style: { gap: '4px' } },
      btn('Write rhythms', writeRhythms, 'small primary', { id: 'btn-rhy-write', disabled: !rhythmDirty(), title: 'Write all user rhythms to RHYTHM.RC0 on the looper' }),
      btn('Revert', () => { stopRhythm(); ui.loadedFor = null; S.render(); }, 'small', { disabled: !rhythmDirty() })),
    h('div', { class: 'note', style: { marginTop: '6px' } }, 'The previous RHYTHM.RC0 is copied to the app trash folder before each write.'));

  if (!r) {
    return h('div', { class: 'two' }, listPanel, h('div', { class: 'stack' },
      panel('flat', h('div', { class: 'empty-state' }, h('div', { class: 'big jp' }, 'リズム'),
        h('div', { class: 'sub', style: { marginTop: '10px' } }, 'Make a new rhythm or add a trap preset to start.'))),
      memoryPanel()));
  }

  ui.part = Math.min(ui.part, r.parts.length - 1);
  ui.measure = Math.min(ui.measure, r.parts[ui.part].length - 1);
  const part = r.parts[ui.part];
  const noteCount = r.parts.flat(2).length;
  const lanes = laneNotes(r);
  const unused = audio.DRUM_NOTES.filter((d) => !lanes.includes(d.note));

  return h('div', { class: 'two' }, listPanel,
    h('div', { class: 'stack' },
      panel('hot',
        h('div', { class: 'hero' },
          h('div', { class: 'grow' },
            label('リズム', 'USER RHYTHM EDITOR', true),
            h('div', { class: 'title big' }, `${r.name || '(no name)'} · ${PART_NAMES[ui.part]}`),
            h('div', { class: 'sub' }, `${noteCount} hits of ${MAX_ENTRIES - 1} · ${r.beats}/${r.unit} · the preview is a synth, the looper plays its own kit`)),
          h('div', { class: 'row' },
            h('input', { type: 'text', value: r.name, style: { width: '138px' }, maxLength: 12, spellcheck: false, title: 'Name, up to 12 characters',
              onchange: (e) => { r.name = e.target.value.toUpperCase().replace(/[^A-Z0-9 \-+&]/g, '').slice(0, 12) || 'RHYTHM'; redraw(r); } }),
            h('select', { style: { width: '128px' }, title: 'Drum kit of this rhythm', onchange: (e) => { r.kit = Number(e.target.value); redraw(r); } },
              KITS.map((k, i) => h('option', { value: i, selected: i === r.kit }, k))),
            h('input', { type: 'number', min: 40, max: 300, value: r.tempo, style: { width: '68px' }, title: 'Tempo', onchange: (e) => { r.tempo = Math.max(40, Math.min(300, Math.round(Number(e.target.value)) || 120)); redraw(r); } }),
            btn(ui.playing ? 'Stop' : 'Preview', () => { ui.playing ? stopRhythm() : startPreview(); S.render(); }, ui.playing ? 'active' : 'primary')))),
      panel('flat tight',
        h('div', { class: 'tabs' }, PART_NAMES.map((name, i) => btn(name, () => { ui.part = i; ui.measure = 0; S.render(); }, `small ${i === ui.part ? 'active' : ''}`))),
        h('div', { class: 'row wrap', style: { marginTop: '8px' } },
          h('span', { class: 'code' }, 'MEASURE'),
          part.map((_, m) => btn(String(m + 1), () => { ui.measure = m; S.render(); }, `small ${m === ui.measure ? 'active' : ''}`)),
          btn('+', () => { part.push(structuredClone(part[ui.measure])); ui.measure = part.length - 1; redraw(r); }, 'small', { title: 'Add a copy of this measure', disabled: part.length >= 16 }),
          btn('−', () => { part.splice(ui.measure, 1); redraw(r); }, 'small', { title: 'Remove this measure', disabled: part.length <= 1 }),
          h('span', { class: 'grow' }),
          h('span', { class: 'code' }, 'GRID'),
          h('select', { style: { width: '128px' }, onchange: (e) => { ui.grid = Number(e.target.value); S.render(); } },
            GRIDS.map(([g, name]) => h('option', { value: g, selected: g === ui.grid }, name))),
          h('span', { class: 'code' }, 'NEW HIT'),
          h('select', { style: { width: '104px' }, onchange: (e) => (ui.newVelocity = Number(e.target.value)) },
            [[60, 'Ghost 60'], [90, 'Soft 90'], [100, 'Normal 100'], [110, 'Hard 110'], [125, 'Accent 125']].map(([v, name]) => h('option', { value: v, selected: v === ui.newVelocity }, name))))),
      panel('flat', label('ステップ', `${PART_NAMES[ui.part].toUpperCase()} · MEASURE ${ui.measure + 1} OF ${part.length}`),
        lanes.map((note) => laneRow(r, note)),
        h('div', { class: 'row wrap', style: { marginTop: '10px' } },
          h('select', { style: { width: '170px' }, onchange: (e) => {
            if (e.target.value === '') return;
            ui.lanes.set(r, [...(ui.lanes.get(r) || DEFAULT_LANES), Number(e.target.value)]);
            S.render();
          } }, h('option', { value: '' }, '+ Add drum sound…'), unused.map((d) => h('option', { value: d.note }, `${d.name} · ${d.note}`))),
          btn('Clear measure', () => { part[ui.measure] = []; redraw(r); }, 'small'),
          btn('Export part .mid', async () => {
            const name = `${r.name.replace(/[^\w-]+/g, '_')}_${PART_NAMES[ui.part].replace(' ', '_')}.mid`;
            if (await S.backend.saveFile(name, measuresToSmf({ tempo: r.tempo, beats: r.beats, unit: r.unit, measures: part }))) toast(`Exported ${name}`);
          }, 'small'),
          h('span', { class: 'grow' }),
          h('label', { class: 'row note' }, h('input', { type: 'checkbox', checked: ui.withTempo, onchange: (e) => (ui.withTempo = e.target.checked) }), 'with tempo'),
          btn(`Use in memory ${String(S.slot).padStart(2, '0')}`, () => useInMemory(r), 'small warn', { title: 'Point the current memory to this rhythm and its kit' })),
        h('div', { class: 'note', style: { marginTop: '8px' } },
          'A striped cell, or a "+" after the number, means there is a hit off the chosen grid. Change the grid to see it. The number in a cell is the velocity. Not every looper kit has every sound; a missing one stays silent.')),
      renderPanel(r),
      memoryPanel()));
}
