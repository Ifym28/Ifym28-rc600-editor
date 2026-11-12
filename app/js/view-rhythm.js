// Rhythm: the rhythm settings of the memory, and a step pattern composer with
// preview and Standard MIDI File export.

import * as rc from './rc0.js';
import { S, loadLocal, saveLocal } from './store.js';
import { h, label, panel, btn, toast, sectionPanel } from './ui.js';
import * as audio from './audio.js';
import { patternToSmf } from './smf.js';
import { GENRES, PATTERNS } from './rhythm-data.js';

const PARTS = ['Intro', 'Vari-A', 'Vari-B', 'Vari-C', 'Vari-D', 'Ending'];

const lane = (drum, level, hits, steps = 16) => ({ drum, level, mute: false, solo: false, cells: Array.from({ length: steps }, (_, i) => (hits.includes(i + 1) ? 1 : 0)) });

function preset(name, bpm, kick, snare, hat) {
  const parts = {};
  for (const p of PARTS) parts[p] = [lane('kick', 60, kick), lane('snare', 56, snare), lane('chh', 54, hat)];
  parts.Ending = [lane('kick', 60, [1]), lane('snare', 56, [1]), lane('crash', 50, [1])];
  parts['Vari-B'][2] = lane('ohh', 45, [3, 7, 11, 15]);
  return { name, bpm, beats: 4, parts };
}

const FACTORY = [
  preset('Alt Rock', 65, [1, 9], [5, 13], [1, 3, 5, 7, 9, 11, 13, 15]),
  preset('Bayou', 118, [1, 4, 9, 12], [5, 13], [1, 3, 5, 7, 9, 11, 13, 15]),
  preset('Blister', 182, [1, 3, 9, 11], [5, 13], [1, 5, 9, 13]),
  preset('Clint', 86, [1, 8, 11], [5, 13], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
  preset('Four Floor', 124, [1, 5, 9, 13], [5, 13], [3, 7, 11, 15]),
  preset('Half Time', 140, [1, 11], [9], [1, 3, 5, 7, 9, 11, 13, 15]),
];

const ui = { patterns: null, index: 0, part: 'Vari-A', playing: false, timer: 0, step: -1 };

const patterns = () => (ui.patterns ||= loadLocal('patterns', null) || structuredClone(FACTORY));
const current = () => patterns()[Math.min(ui.index, patterns().length - 1)];
const persist = () => saveLocal('patterns', patterns());
const stepsOf = (p) => p.beats * 4;

function fitSteps(p) {
  const n = stepsOf(p);
  for (const lanes of Object.values(p.parts)) for (const l of lanes) {
    while (l.cells.length < n) l.cells.push(0);
    l.cells.length = n;
  }
}

export function stopRhythm() {
  clearInterval(ui.timer);
  ui.playing = false;
  ui.step = -1;
}

function startPreview() {
  stopRhythm();
  const ac = audio.audioContext();
  ui.playing = true;
  let step = 0;
  let next = ac.currentTime + 0.06;
  ui.timer = setInterval(() => {
    const p = current();
    const lanes = p.parts[ui.part];
    const stepLen = 60 / p.bpm / 4;
    while (next < ac.currentTime + 0.12) {
      const anySolo = lanes.some((l) => l.solo);
      for (const l of lanes) {
        if (l.cells[step % stepsOf(p)] && !l.mute && (!anySolo || l.solo)) audio.drumHit(l.drum, next, l.level / 100);
      }
      const shown = step % stepsOf(p);
      setTimeout(() => {
        ui.step = shown;
        document.querySelectorAll('.step.now').forEach((el) => el.classList.remove('now'));
        document.querySelectorAll(`.step[data-i="${shown}"]`).forEach((el) => el.classList.add('now'));
      }, Math.max(0, (next - ac.currentTime) * 1000));
      next += stepLen;
      step++;
    }
  }, 25);
}

function laneRow(p, l, i) {
  const lanes = p.parts[ui.part];
  const n = stepsOf(p);
  const cells = h('div', { class: 'steps', style: { gridTemplateColumns: `repeat(${n}, 1fr)` } }, l.cells.map((on, s) => {
    const cell = h('button', { class: `step${s % 4 === 0 ? ' beat' : ''}${on ? ' on' : ''}`, 'data-i': s, onclick: () => {
      l.cells[s] = l.cells[s] ? 0 : 1;
      cell.classList.toggle('on', !!l.cells[s]);
      if (l.cells[s] && !ui.playing) audio.drumHit(l.drum, audio.audioContext().currentTime, l.level / 100);
      persist();
    } }, s + 1);
    return cell;
  }));
  const level = h('b', {}, l.level);
  const slider = h('input', { type: 'range', min: 0, max: 100, value: l.level, oninput: (e) => {
    l.level = Number(e.target.value);
    level.textContent = l.level;
    e.target.style.setProperty('--p', `${l.level}%`);
    persist();
  } });
  slider.style.setProperty('--p', `${l.level}%`);
  const redraw = () => { persist(); S.render(); };
  return h('div', { class: 'lane' },
    h('div', {},
      h('select', { onchange: (e) => { l.drum = e.target.value; persist(); } },
        audio.DRUMS.map((d) => h('option', { value: d.id, selected: d.id === l.drum }, d.name))),
      h('div', { class: 'row', style: { marginTop: '4px' } }, slider, h('span', { class: 'mono', style: { width: '26px', textAlign: 'right' } }, level)),
      h('div', { class: 'row', style: { marginTop: '4px', gap: '4px' } },
        btn('M', () => { l.mute = !l.mute; redraw(); }, `small ${l.mute ? 'on' : ''}`),
        btn('S', () => { l.solo = !l.solo; redraw(); }, `small ${l.solo ? 'active' : ''}`),
        btn('Clear', () => { l.cells.fill(0); redraw(); }, 'small'),
        btn('Random', () => { l.cells = l.cells.map((_, s) => (Math.random() < (s % 4 === 0 ? 0.6 : 0.2) ? 1 : 0)); redraw(); }, 'small'),
        btn('×', () => { lanes.splice(i, 1); redraw(); }, 'small ghost', { title: 'Remove lane', disabled: lanes.length <= 1 }))),
    cells);
}

export function rhythmView() {
  const p = current();
  fitSteps(p);
  const sec = rc.section(S.doc, 'mem', 'RHYTHM');
  const lanes = p.parts[ui.part];
  const genre = rc.getNum(sec, 'A');
  const memCtx = { genre: () => rc.getNum(sec, 'A'), onChange: (s, tag) => {
    if (tag === 'A') { rc.setNum(sec, 'B', 0); S.render(); } else S.refreshChrome();
  } };
  const redraw = () => { persist(); S.render(); };
  const exportSmf = async () => {
    const bytes = patternToSmf({ bpm: p.bpm, beats: p.beats, steps: stepsOf(p),
      lanes: lanes.filter((l) => !l.mute).map((l) => ({ note: audio.DRUMS.find((d) => d.id === l.drum).note, velocity: Math.max(1, Math.round(l.level * 1.27)), cells: l.cells })) }, 2);
    const name = `${p.name.replace(/[^\w-]+/g, '_')}_${ui.part}.mid`;
    if (await S.backend.saveFile(name, bytes)) toast(`Exported ${name}`);
  };
  return h('div', { class: 'two' },
    panel('tight', label('パターン', 'PATTERN LIBRARY'),
      h('div', { class: 'list' }, patterns().map((x, i) =>
        h('button', { class: `item${i === ui.index ? ' active' : ''}`, onclick: () => { ui.index = i; S.render(); } },
          h('div', { class: 'ix' }, `${i + 1})`), h('div', { class: 't' }, x.name), h('div', { class: 'ix' }, `${x.bpm} BPM (${x.beats}/4)`)))),
      h('div', { class: 'row wrap', style: { marginTop: '8px', gap: '4px' } },
        btn('New', () => { patterns().push(preset(`Pattern ${patterns().length + 1}`, 120, [1, 9], [5, 13], [1, 3, 5, 7, 9, 11, 13, 15])); ui.index = patterns().length - 1; redraw(); }, 'small'),
        btn('Copy', () => { patterns().push({ ...structuredClone(p), name: `${p.name} 2` }); ui.index = patterns().length - 1; redraw(); }, 'small'),
        btn('Delete', () => { patterns().splice(ui.index, 1); ui.index = 0; redraw(); }, 'small danger', { disabled: patterns().length <= 1 }))),
    h('div', { class: 'stack' },
      panel('hot',
        h('div', { class: 'hero' },
          h('div', { class: 'grow' },
            label('リズム', 'RHYTHM EDITOR', true),
            h('div', { class: 'title big' }, `${p.name} · ${ui.part}`),
            h('div', { class: 'sub' }, 'Step pattern composer with variation tabs, preview and MIDI file export.')),
          h('div', { class: 'row' },
            h('input', { type: 'text', value: p.name, style: { width: '140px' }, maxLength: 20, onchange: (e) => { p.name = e.target.value || 'Pattern'; redraw(); } }),
            h('select', { style: { width: '70px' }, onchange: (e) => { p.beats = Number(e.target.value); fitSteps(p); redraw(); } },
              [2, 3, 4, 5, 6, 7].map((b) => h('option', { value: b, selected: b === p.beats }, `${b}/4`))),
            h('input', { type: 'number', min: 40, max: 300, value: p.bpm, style: { width: '70px' }, onchange: (e) => { p.bpm = Math.max(40, Math.min(300, Number(e.target.value) || 120)); redraw(); } }),
            btn(ui.playing ? 'Stop' : 'Preview', () => { ui.playing ? stopRhythm() : startPreview(); S.render(); }, ui.playing ? 'active' : 'primary')))),
      panel('flat tight', h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('div', { class: 'tabs' }, PARTS.map((part) => btn(part, () => { ui.part = part; S.render(); }, part === ui.part ? 'active' : ''))),
        h('div', { class: 'row' },
          btn('Use memory tempo', () => { p.bpm = Math.round(rc.getNum(rc.section(S.doc, 'mem', 'MASTER'), 'A', 1200) / 10); redraw(); }, 'small'),
          btn('Export .mid', exportSmf, 'small warn')))),
      panel('flat', label('ステップ', `STEP LANES · ${stepsOf(p)} STEPS`),
        lanes.map((l, i) => laneRow(p, l, i)),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          btn('+ Add lane', () => { lanes.push(lane('clap', 50, [], stepsOf(p))); redraw(); }, 'small', { disabled: lanes.length >= 8 }),
          h('span', { class: 'note' }, 'The looper loads user rhythms through the BOSS RC Rhythm Converter, which reads the exported .mid file.'))),
      sectionPanel(sec, memCtx, `RHYTHM OF MEMORY ${String(S.slot).padStart(2, '0')} · ${GENRES[genre] ?? genre} / ${PATTERNS[genre]?.[rc.getNum(sec, 'B')] ?? rc.getNum(sec, 'B')}`, '設定')));
}
