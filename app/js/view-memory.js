// Memory editor: memory list, section list, and the editor for the chosen section.

import * as rc from './rc0.js';
import { S, mem, memName, selectSlot, go } from './store.js';
import { h, label, panel, btn, paramControl, sectionPanel, pips } from './ui.js';
import { TRACK, SECTIONS, panLabel } from './params.js';

const SECTION_LIST = [
  ['info', 'Info', 'Summary', '情報'],
  ['tracks', 'Loop', 'Tracks', 'ループ'],
  ['ctl', 'Rec + Play', 'Loop behaviour', '制御'],
  ['rhythm', 'Rhythm', 'Pattern and kit', 'リズム'],
  ['assigns', 'Assigns', 'Sources', 'アサイン'],
  ['input', 'Input', 'Setup and EQ', '入力'],
  ['output', 'Output', 'Main + sub', '出力'],
  ['mixer', 'Mixer', 'Levels', 'ミキサー'],
  ['ifx', 'Input FX', 'Bank editor', 'FX'],
  ['tfx', 'Track FX', 'Bank editor', 'FX'],
  ['pedals', 'Pedals', 'Ctl and exp', 'ペダル'],
];

const ui = { fxBank: 'A', fxType: {} };

const ctx = () => ({
  // The pattern list depends on the genre, so a genre change resets the pattern and redraws.
  onChange: (sec, tag) => {
    if (sec?.name === 'RHYTHM' && tag === 'A') {
      rc.setNum(sec, 'B', 0);
      S.render();
    } else S.refreshChrome();
  },
  genre: () => rc.getNum(rc.section(S.doc, 'mem', 'RHYTHM'), 'A'),
});

export function memoryList(onPick) {
  return h('div', { class: 'list' }, S.device.memories.map((m, i) => {
    const slot = i + 1;
    const name = memName(slot);
    return h('button', {
      class: `item${slot === S.slot ? ' active' : ''}${m ? '' : ' empty'}`,
      onclick: () => (onPick ? onPick(slot) : selectSlot(slot)),
      disabled: !m,
    },
      h('div', { class: 'ix' }, String(slot).padStart(2, '0'), pips(m?.tracks)),
      h('div', { class: 't' }, m ? name || '(no name)' : 'no file'));
  }));
}

function trackCard(n) {
  const sec = rc.section(S.doc, 'mem', `TRACK${n}`);
  if (!sec) return null;
  const c = ctx();
  const loaded = rc.getNum(sec, 'X') > 0;
  const seconds = rc.getNum(sec, 'X') / 44100;
  const level = h('span', {}, `LEVEL ${rc.getNum(sec, 'D')}`);
  const pan = h('span', { class: 'code' }, panLabel(rc.getNum(sec, 'C')));
  c.onChange = () => {
    level.textContent = `LEVEL ${rc.getNum(sec, 'D')}`;
    pan.textContent = panLabel(rc.getNum(sec, 'C'));
    S.refreshChrome();
  };
  const more = h('details', {},
    h('summary', { class: 'code', style: { cursor: 'pointer', margin: '4px 0 8px' } }, 'SYNC / INPUT / RAW'),
    sec.fields.filter((f) => !'ABCDEFGH'.includes(f.tag)).map((f) => paramControl(sec, f.tag, c)));
  return panel(`track-card ${loaded ? '' : 'empty'}`,
    h('div', { class: 'head' },
      h('div', {}, label('トラック', `TRACK ${n}`, true), h('div', { class: 'title' }, level)),
      h('div', { style: { textAlign: 'right' } }, h('div', { class: 'n' }, `0${n}`), pan)),
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('span', { class: `badge ${loaded ? '' : 'off'}` }, loaded ? 'LOADED' : 'EMPTY'),
      loaded && h('span', { class: 'code' }, `${seconds.toFixed(2)} S`)),
    paramControl(sec, 'D', c),
    paramControl(sec, 'C', c),
    h('div', { class: 'row wrap', style: { marginBottom: '8px' } }, ['A', 'B', 'H'].map((tag) => {
      const chip = h('button', { class: `chip${rc.getNum(sec, tag) ? ' on' : ''}`, onclick: () => {
        rc.setNum(sec, tag, rc.getNum(sec, tag) ? 0 : 1);
        chip.classList.toggle('on', !!rc.getNum(sec, tag));
        chip.textContent = `${TRACK[tag].name}: ${rc.getNum(sec, tag) ? 'ON' : 'OFF'}`;
        S.refreshChrome();
      } }, `${TRACK[tag].name}: ${rc.getNum(sec, tag) ? 'ON' : 'OFF'}`);
      return chip;
    })),
    h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 8px' } }, paramControl(sec, 'E', c), paramControl(sec, 'F', c)),
    paramControl(sec, 'G', c),
    more);
}

function assignsTable() {
  const c = ctx();
  const tags = Object.keys(SECTIONS.ASSIGN);
  const rows = [];
  for (let n = 1; n <= 16; n++) {
    const sec = rc.section(S.doc, 'mem', `ASSIGN${n}`);
    if (!sec) continue;
    rows.push(h('tr', {}, h('td', { class: 'red' }, String(n).padStart(2, '0')), tags.map((tag) => {
      const def = SECTIONS.ASSIGN[tag];
      const v = rc.getNum(sec, tag);
      let cell;
      if (def.kind === 'bool') {
        cell = h('button', { class: `chip${v ? ' on' : ''}`, onclick: () => {
          rc.setNum(sec, tag, rc.getNum(sec, tag) ? 0 : 1);
          cell.classList.toggle('on', !!rc.getNum(sec, tag));
          cell.textContent = rc.getNum(sec, tag) ? 'ON' : 'OFF';
          c.onChange();
        } }, v ? 'ON' : 'OFF');
      } else if (def.options) {
        cell = h('select', { onchange: (e) => { rc.setNum(sec, tag, e.target.value); c.onChange(); } },
          def.options.map((o) => h('option', { value: o.value, selected: o.value === v }, o.label)));
      } else {
        cell = h('input', { type: 'number', min: def.min, max: def.max, value: v, onchange: (e) => {
          rc.setNum(sec, tag, Math.max(def.min, Math.min(def.max, Number(e.target.value) || 0)));
          e.target.value = rc.getNum(sec, tag);
          c.onChange();
        } });
      }
      return h('td', {}, cell);
    })));
  }
  return panel('flat', label('アサイン', 'ASSIGN 1 – 16'),
    h('table', { class: 'grid-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), tags.map((t) => h('th', {}, `${SECTIONS.ASSIGN[t].name} ·${t}`)))),
      h('tbody', {}, rows)),
    h('div', { class: 'note', style: { marginTop: '10px' } },
      'Source and Target are shown as the raw numbers stored in the memory file. The lists in the RC-600 Parameter Guide follow the same order, starting at 0.'));
}

function fxEditor(blockName) {
  const blk = rc.block(S.doc, blockName);
  if (!blk) return panel('flat', h('div', { class: 'note' }, `This memory file has no ${blockName} block.`));
  const c = ctx();
  const bank = ui.fxBank;
  // FX types in the order they appear in the file. The slot "Type" value is an index into this list.
  const types = blk.sections.map((s) => s.name).filter((n) => n.startsWith('AA_') && !n.endsWith('_SEQ') && !/_V\d+V\d+$/.test(n)).map((n) => n.slice(3));
  c.fxTypes = types;
  const slots = ['A', 'B', 'C', 'D'].map((letter) => {
    const slot = bank + letter;
    const sec = blk.byName.get(slot);
    if (!sec) return null;
    const key = `${blockName}.${slot}`;
    const typeName = () => ui.fxType[key] || types[rc.getNum(sec, 'C')] || types[0];
    const body = h('div', {});
    const drawParams = () => {
      const tsec = blk.byName.get(`${slot}_${typeName()}`);
      const seq = blk.byName.get(`${slot}_${typeName()}_SEQ`);
      body.replaceChildren(
        h('div', { class: 'field' },
          h('div', { class: 'k' }, 'Edit parameters of'),
          h('select', { onchange: (e) => { ui.fxType[key] = e.target.value; drawParams(); } },
            types.map((t) => h('option', { value: t, selected: t === typeName() }, t.replace(/_/g, ' '))))),
        tsec ? h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 10px' } }, tsec.fields.map((f) => paramControl(tsec, f.tag, c))) : h('div', { class: 'note' }, 'No stored parameters.'),
        seq ? h('details', {}, h('summary', { class: 'code', style: { cursor: 'pointer' } }, `STEP SEQUENCE (${seq.fields.length})`),
          h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 10px', marginTop: '8px' } }, seq.fields.map((f) => paramControl(seq, f.tag, c)))) : '');
    };
    const slotCtx = { ...c, onChange: (s, tag) => { if (tag === 'C') { delete ui.fxType[key]; drawParams(); } S.refreshChrome(); } };
    drawParams();
    return panel('',
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, label('スロット', `SLOT ${slot}`, true), h('span', { class: 'num red' }, slot)),
      sec.fields.map((f) => paramControl(sec, f.tag, slotCtx)),
      h('div', { class: 'hazard red-stripes', style: { height: '3px', margin: '4px 0 10px' } }),
      body);
  });
  return h('div', { class: 'stack' },
    panel('flat',
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('div', {}, label('エフェクト', blockName === 'ifx' ? 'INPUT FX' : 'TRACK FX', true),
          h('div', { class: 'tabs' }, ['A', 'B', 'C', 'D'].map((b) => btn(`Bank ${b}`, () => { ui.fxBank = b; S.render(); }, b === bank ? 'active' : '')))),
        h('div', { style: { minWidth: '520px' } }, h('div', { class: 'fields', style: { gridTemplateColumns: 'repeat(3, 1fr)' } }, (blk.byName.get(bank)?.fields || []).map((f) => paramControl(blk.byName.get(bank), f.tag, c))))),
      h('div', { class: 'note' }, `${types.length} effect types found in this file. Effect parameters are shown with their tag letter and raw value, in the order of the Parameter Guide.`)),
    h('div', { class: 'cards', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' } }, slots));
}

function groupOf(names, titles = {}) {
  const c = ctx();
  return h('div', { class: 'stack' }, names.map((n) => sectionPanel(rc.section(S.doc, 'mem', n), c, titles[n] || n.replace(/_/g, ' '))));
}

function sectionBody() {
  const c = ctx();
  const m = rc.block(S.doc, 'mem');
  const names = (re) => m.sections.map((s) => s.name).filter((n) => re.test(n));
  switch (S.section) {
    case 'info': {
      const changes = rc.changedFields(S.doc);
      const info = mem();
      return h('div', { class: 'stack' },
        panel('flat', label('情報', 'MEMORY FILE'),
          h('div', { class: 'stats' },
            h('div', { class: 'stat' }, h('div', { class: 'k' }, 'CURRENT COPY'), h('div', { class: 'v' }, rc.memoryFile(S.slot, info.current))),
            h('div', { class: 'stat' }, h('div', { class: 'k' }, 'SAVE COUNT'), h('div', { class: 'v' }, `A ${info.counts.A ?? '--'} · B ${info.counts.B ?? '--'}`)),
            h('div', { class: 'stat' }, h('div', { class: 'k' }, 'SECTIONS'), h('div', { class: 'v' }, S.doc.blocks.map((b) => `${b.name} ${b.sections.length}`).join(' · ')))),
          h('div', { class: 'note', style: { marginTop: '10px' } },
            'The looper keeps two copies of each memory. WRITE puts the new version in the older copy and raises its count, the same way the unit saves. The previous version stays on disk in the other file.')),
        sectionPanel(rc.section(S.doc, 'mem', 'MASTER'), c, 'MASTER', 'テンポ'),
        panel('flat', label('変更', `PENDING CHANGES (${changes.length})`),
          changes.length
            ? h('table', { class: 'grid-table' }, h('tbody', {}, changes.slice(0, 200).map((ch) =>
              h('tr', {}, h('td', { class: 'dim' }, ch.block), h('td', {}, ch.section), h('td', { class: 'red' }, ch.tag), h('td', { class: 'dim' }, ch.from), h('td', { class: 'amber' }, `→ ${ch.to}`)))))
            : h('div', { class: 'note' }, 'No pending changes.')));
    }
    case 'tracks':
      return h('div', { class: 'cards' }, [1, 2, 3, 4, 5, 6].map(trackCard));
    case 'ctl':
      return groupOf(['REC', 'PLAY'], { REC: 'REC', PLAY: 'PLAY' });
    case 'rhythm':
      return h('div', { class: 'stack' }, groupOf(['RHYTHM']),
        h('div', {}, btn('Open rhythm editor', () => go('rhythm'), '')));
    case 'assigns':
      return assignsTable();
    case 'input':
      return groupOf(['INPUT', ...names(/^EQ_(MIC|INST)/)]);
    case 'output':
      return groupOf(['OUTPUT', 'ROUTING', 'MASTER_FX', ...names(/^EQ_(MAIN|SUB)/)]);
    case 'mixer':
      return groupOf(['MIXER']);
    case 'ifx':
    case 'tfx':
      return fxEditor(S.section);
    case 'pedals':
      return groupOf(names(/^(ICTL|ECTL)/));
    default:
      return null;
  }
}

export function memoryView() {
  const current = SECTION_LIST.find((s) => s[0] === S.section) || SECTION_LIST[1];
  return h('div', { class: 'editor' },
    panel('tight scroll', label('メモリー', 'MEMORIES'), memoryList()),
    panel('tight', label('区分', 'SECTIONS'),
      h('div', { class: 'list' }, SECTION_LIST.map(([id, title, sub]) =>
        h('button', { class: `item${id === S.section ? ' active' : ''}`, onclick: () => go('memory', id) },
          h('div', { class: 't' }, title), h('div', { class: 'ix' }, sub))))),
    h('div', { class: 'stack' },
      panel('hot',
        h('div', { class: 'hero' },
          h('div', { class: 'grow' },
            label(current[3], 'MEMORY EDITOR', true),
            h('div', { class: 'title big' }, `${String(S.slot).padStart(2, '0')} · ${memName() || '(no name)'}`),
            h('div', { class: 'sub' }, `${current[1]} · ${mem().tracks.filter(Boolean).length} loops loaded`)),
          h('div', { style: { textAlign: 'right' } },
            h('div', { class: 'code' }, `RC-600 / MEM-${rc.pad3(S.slot)} / ${mem().current}`),
            h('div', { class: 'hazard' })))),
      sectionBody()));
}
