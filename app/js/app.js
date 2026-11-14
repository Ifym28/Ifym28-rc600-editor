// App shell: header modules, sidebar, and the smaller views.

import * as rc from './rc0.js';
import {
  S, dirty, sysDirty, mem, memName, run, refreshVolumes, connectVolume, browseFolder, disconnectVolume,
  selectSlot, writeMemory, revertMemory, ensureSystem, writeSystem, saveBackup, loadBackup, go, loadLocal, saveLocal, leaveCheck,
} from './store.js';
import { h, label, panel, btn, toast, confirm, pips, sectionPanel } from './ui.js';
import { memoryView } from './view-memory.js';
import { audioView, forgetAudio } from './view-audio.js';
import { rhythmView, stopRhythm, forgetRhythms, rhythmDirty } from './view-rhythm.js';
import { scanImport, applyImport } from './importer.js';
import * as midiLink from './midi.js';
import { midi } from './midi.js';
import * as audio from './audio.js';

const NAV = [
  ['SESSION', [
    ['overview', 'Overview', '概要 · status and snapshot'],
    ['memory', 'Memory Editor', 'メモリー · loop, mix, routing', 'tracks'],
    ['rhythm', 'Rhythm', 'リズム · pattern and lanes'],
    ['memory', 'Assigns', 'アサイン · sources and targets', 'assigns'],
  ]],
  ['SOUND DESIGN', [
    ['memory', 'Input FX', 'インプット · banks A-D', 'ifx'],
    ['memory', 'Track FX', 'トラック · banks A-D', 'tfx'],
    ['system', 'System', 'システム · levels and MIDI'],
  ]],
  ['LIBRARY', [
    ['audio', 'Audio', 'オーディオ · loop tools'],
    ['setlists', 'Setlists', 'セットリスト · show lists'],
    ['manager', 'Manager', 'マネージャー · copy and backup'],
  ]],
];

const root = document.getElementById('app');
const two = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------ header

function heroModule() {
  const sets = loadLocal('setlists', []);
  return panel('hot',
    label('ループステーション', 'BOSS RC-600 EDITOR', true),
    h('div', { class: 'title' }, 'Loop command deck'),
    h('div', { class: 'sub' }, 'Memories, loops, rhythm, setlists and backup in one cockpit.'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'MEMORY'), h('div', { class: 'v', id: 'hero-mem' }, S.device ? `${two(S.slot)} · ${memName() || '—'}` : '—')),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'LIBRARY'), h('div', { class: 'v' }, `${sets.length} setlist${sets.length === 1 ? '' : 's'}`)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'STATUS'), h('div', { class: 'v', id: 'hero-status' }, statusText()))));
}

const statusText = () => (!S.device ? 'Standby' : dirty() || sysDirty() ? 'Edits pending' : 'Ready');

function midiModule() {
  const on = !!midi.output;
  const select = h('select', { disabled: on },
    midi.outputs.length ? midi.outputs.map((o) => h('option', { value: o.id, selected: on ? o.id === midi.output.id : o === midiLink.preferredOutput() }, o.name))
      : h('option', {}, midi.access ? 'No MIDI ports found' : 'Press Refresh'));
  const scan = () => midiLink.refreshPorts().then(() => S.render()).catch((e) => toast(e.message, true));
  return panel('',
    h('div', { class: 'row' }, h('div', { class: 'grow' }, label('ミディ', 'USB MIDI', true), h('div', { class: 'title', style: { fontSize: '15px' } }, on ? midi.output.name : 'Not linked')), h('i', { class: `led ${on ? 'on' : ''}` })),
    h('div', { class: 'row', style: { margin: '8px 0' } }, select, btn('Refresh', scan, 'small')),
    h('div', { class: 'row' },
      on ? btn('Disconnect MIDI', () => midiLink.disconnect(), 'small danger')
        : btn('Connect MIDI', () => { try { midiLink.connect(select.value); toast('MIDI linked'); } catch (e) { toast(e.message, true); } }, 'small primary', { disabled: !midi.outputs.length }),
      h('label', { class: 'row note', title: 'Send a Program Change when a memory is selected here' },
        h('input', { type: 'checkbox', checked: S.followMidi, onchange: (e) => (S.followMidi = e.target.checked) }), 'Follow')),
    h('div', { class: 'note', id: 'midi-note', style: { marginTop: '6px' } }, on ? (midi.lastMessage ? `Last received: ${midi.lastMessage}` : 'Selecting a memory sends Program Change.') : 'Optional. Memory select and transport over USB MIDI.'));
}

function storageModule() {
  const d = S.device;
  const select = h('select', { onchange: (e) => (S.volume = S.volumes[Number(e.target.value)]) },
    S.volumes.length ? S.volumes.map((v, i) => h('option', { value: i, selected: v === S.volume }, v.name)) : h('option', {}, 'No RC-600 volume found'));
  return panel('',
    h('div', { class: 'row' }, h('div', { class: 'grow' }, label('ストレージ', 'RC-600 STORAGE', true), h('div', { class: 'title', style: { fontSize: '15px' } }, d ? 'Folder connected' : 'Not connected')), h('i', { class: `led ${d ? 'on' : 'warn'}` })),
    h('div', { class: 'row', style: { margin: '8px 0' } }, select, btn('Refresh', refreshVolumes, 'small')),
    h('div', { class: 'row wrap' },
      d && d.root === S.volume?.root ? btn('Eject', () => disconnectVolume(true), 'small warn') : btn('Connect volume', () => connectVolume(), 'small primary', { disabled: !S.volume }),
      btn('Browse', browseFolder, 'small'),
      btn('Manager', () => go('manager'), 'small', { disabled: !d })),
    h('div', { class: 'note', style: { marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
      d ? `${d.memories.filter(Boolean).length} memories from ${d.root} · ${d.waveCount} loop folders`
        : S.backend.kind === 'demo' ? 'Demo volume in memory. Nothing is written to disk.' : 'On the looper: MENU › USB › STORAGE › CONNECT.'));
}

function memoryModule() {
  const d = S.device;
  const name = h('input', { type: 'text', maxLength: 12, value: d ? memName() : '', disabled: !d, placeholder: 'NAME', spellcheck: false,
    oninput: (e) => {
      rc.writeName(S.doc, e.target.value);
      refreshChrome();
    } });
  return panel('',
    label('メモリー', 'CURRENT MEMORY', true),
    h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'code' }, 'SLOT'),
      h('select', { disabled: !d, onchange: (e) => selectSlot(Number(e.target.value)) },
        d ? d.memories.map((m, i) => m && h('option', { value: i + 1, selected: i + 1 === S.slot }, `${two(i + 1)}: ${i + 1 === S.slot ? memName() : m.name}`)) : h('option', {}, '—'))),
    name,
    h('div', { class: 'row wrap', style: { marginTop: '8px' } },
      btn('Write', writeMemory, 'small primary', { id: 'btn-write', disabled: !dirty(), title: 'Write this memory to the looper' }),
      btn('Revert', revertMemory, 'small', { id: 'btn-revert', disabled: !dirty() }),
      h('span', { class: 'grow' }),
      btn('Save backup', saveBackup, 'small go', { disabled: !d }),
      btn('Load backup', loadBackup, 'small', { disabled: !d })),
    h('div', { class: 'note', id: 'mem-note', style: { marginTop: '6px' } }, memNote()));
}

const memNote = () => (!S.device ? '99 memory slots · quick rename · backup' : dirty() ? `${rc.changedFields(S.doc).length} change(s) not written yet` : S.lastBackup ? `Last backup: ${S.lastBackup.path.split('/').pop()}` : 'No backup in this session yet');

/** Update the parts of the header that depend on pending edits, without a full redraw. */
function refreshChrome() {
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('btn-write', (el) => (el.disabled = !dirty()));
  set('btn-revert', (el) => (el.disabled = !dirty()));
  set('mem-note', (el) => { el.textContent = memNote(); el.classList.toggle('amber', dirty()); });
  set('hero-status', (el) => { el.textContent = statusText(); el.classList.toggle('amber', dirty() || sysDirty()); });
  set('hero-mem', (el) => (el.textContent = S.device ? `${two(S.slot)} · ${memName() || '—'}` : '—'));
  set('btn-sys-write', (el) => (el.disabled = !sysDirty()));
  document.getElementById('busy')?.classList.toggle('hidden', !S.busy);
}

// ------------------------------------------------------------------ views

function overviewView() {
  const d = S.device;
  const used = d.memories.filter((m) => m?.tracks.some(Boolean)).length;
  const loops = d.memories.reduce((n, m) => n + (m ? m.tracks.filter(Boolean).length : 0), 0);
  const m = mem();
  return h('div', { class: 'stack' },
    panel('hot',
      h('div', { class: 'hero' },
        h('div', { class: 'grow' }, label('概要', 'OVERVIEW', true),
          h('div', { class: 'title big' }, `${two(S.slot)} · ${memName() || '(no name)'}`),
          h('div', { class: 'sub' }, `${m.tracks.filter(Boolean).length} loops · ${m.tempo ?? '--'} BPM · copy ${m.current} is current`)),
        h('div', { class: 'row' },
          btn('Edit memory', () => go('memory', 'tracks'), 'primary'),
          btn('Loop tools', () => go('audio')),
          midi.output && btn('▶ Start', () => midiLink.transportStart(), 'go'),
          midi.output && btn('■ Stop', () => midiLink.transportStop())))),
    h('div', { class: 'grid cols-3' },
      panel('flat', label('記憶', 'MEMORIES IN USE'), h('div', { class: 'num' }, `${used} / 99`), h('div', { class: 'note' }, 'Memories that hold at least one loop')),
      panel('flat', label('音声', 'LOOPS ON DISK'), h('div', { class: 'num' }, loops), h('div', { class: 'note' }, `${d.waveCount} folders in WAVE`)),
      panel('flat', label('接続', 'LINK'), h('div', { class: 'num' }, S.backend.kind === 'demo' ? 'DEMO' : 'USB'), h('div', { class: 'note', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.root))),
    panel('flat', label('メモリー', 'MEMORY MATRIX · 01 – 99'),
      h('div', { class: 'matrix' }, d.memories.map((x, i) =>
        h('button', { class: `cell${x?.tracks.some(Boolean) ? ' used' : ''}${i + 1 === S.slot ? ' active' : ''}`, disabled: !x,
          onclick: () => selectSlot(i + 1), ondblclick: () => go('memory', 'tracks'), title: 'Click to select, double-click to edit' },
          h('div', { class: 'n' }, two(i + 1), pips(x?.tracks)),
          h('div', { class: 't' }, x ? (i + 1 === S.slot ? memName() : x.name) || ' ' : '—'))))));
}

function systemView() {
  if (!S.device.systemState) return panel('flat', h('div', { class: 'note' }, 'This folder has no SYSTEM1.RC0 / SYSTEM2.RC0.'));
  if (!S.sysDoc) {
    if (S.sysTried === S.device) return panel('flat', h('div', { class: 'note' }, 'The system file could not be read.'));
    S.sysTried = S.device;
    ensureSystem();
    return panel('flat', h('div', { class: 'note' }, 'Reading system settings…'));
  }
  const ctx = { onChange: refreshChrome };
  const sys = S.sysDoc.blocks[0];
  const main = ['SETUP', 'COLOR', 'USB', 'MIDI', 'PREF', 'INPUT', 'OUTPUT', 'ROUTING', 'MIXER', 'MASTER_FX'];
  const rest = sys.sections.filter((s) => !main.includes(s.name));
  return h('div', { class: 'stack' },
    panel('hot', h('div', { class: 'hero' },
      h('div', { class: 'grow' }, label('システム', 'SYSTEM', true), h('div', { class: 'title big' }, 'Global settings'),
        h('div', { class: 'sub' }, `Current copy: SYSTEM${S.device.systemState.current === 'A' ? 1 : 2}.RC0 · the looper reads system settings at power-on.`)),
      h('div', { class: 'row' },
        btn('Write system', writeSystem, 'primary', { id: 'btn-sys-write', disabled: !sysDirty() }),
        btn('Revert', () => { rc.revert(S.sysDoc); S.render(); })))),
    main.map((n) => sectionPanel(sys.byName.get(n), ctx, n.replace(/_/g, ' '))),
    h('details', {}, h('summary', { class: 'code', style: { cursor: 'pointer', padding: '6px 0' } }, `PEDAL, CONTROL AND EQ SECTIONS (${rest.length})`),
      h('div', { class: 'stack', style: { marginTop: '8px' } }, rest.map((s) => sectionPanel(s, ctx, s.name.replace(/_/g, ' '))))));
}

const setUi = { index: 0 };
function setlistsView() {
  const lists = loadLocal('setlists', []);
  const save = () => { saveLocal('setlists', lists); S.render(); };
  const list = lists[Math.min(setUi.index, lists.length - 1)];
  const move = (i, by) => { const [x] = list.songs.splice(i, 1); list.songs.splice(i + by, 0, x); save(); };
  return h('div', { class: 'two' },
    panel('tight', label('セットリスト', 'SETLISTS'),
      h('div', { class: 'list' }, lists.map((l, i) => h('button', { class: `item${l === list ? ' active' : ''}`, onclick: () => { setUi.index = i; S.render(); } },
        h('div', { class: 't' }, l.name), h('div', { class: 'ix' }, `${l.songs.length} songs`)))),
      h('div', { class: 'row wrap', style: { marginTop: '8px', gap: '4px' } },
        btn('New', () => { lists.push({ name: `Setlist ${lists.length + 1}`, songs: [] }); setUi.index = lists.length - 1; save(); }, 'small primary'),
        btn('Import', async () => {
          const f = await S.backend.openFile(['json']);
          if (!f) return;
          try {
            const data = JSON.parse(new TextDecoder().decode(f.bytes));
            for (const l of [].concat(data)) if (l?.name && Array.isArray(l.songs)) lists.push({ name: String(l.name), songs: l.songs.filter((s) => s.slot >= 1 && s.slot <= 99).map((s) => ({ slot: s.slot, note: String(s.note || '') })) });
            save();
          } catch { toast('That file is not a setlist export.', true); }
        }, 'small'),
        btn('Export', () => S.backend.saveFile('rc600-setlists.json', new TextEncoder().encode(JSON.stringify(lists, null, 2))), 'small', { disabled: !lists.length }))),
    !list ? panel('flat', h('div', { class: 'empty-state' }, h('div', { class: 'big jp' }, 'セットリスト'), h('div', { class: 'sub', style: { marginTop: '10px' } }, 'Make a setlist to line up memories for a show. Setlists are stored in this app, not on the looper.')))
      : h('div', { class: 'stack' },
        panel('hot', h('div', { class: 'hero' },
          h('div', { class: 'grow' }, label('ライブ', 'SHOW LIST', true),
            h('input', { type: 'text', value: list.name, maxLength: 40, style: { font: '700 20px var(--display)', maxWidth: '420px' }, onchange: (e) => { list.name = e.target.value || 'Setlist'; save(); } }),
            h('div', { class: 'sub', style: { marginTop: '6px' } }, midi.output ? 'Go selects the memory here and on the looper (Program Change).' : 'Go selects the memory here. Link USB MIDI to switch the looper too.')),
          h('div', { class: 'row' },
            btn(`+ Add memory ${two(S.slot)}`, () => { list.songs.push({ slot: S.slot, note: '' }); save(); }, 'primary'),
            btn('Delete list', async () => { if (await confirm('Delete setlist', `"${list.name}" is removed from this app.`, 'Delete', 'danger')) { lists.splice(lists.indexOf(list), 1); setUi.index = 0; save(); } }, 'danger')))),
        panel('flat', label('曲順', `RUNNING ORDER · ${list.songs.length}`),
          list.songs.length ? h('table', { class: 'grid-table' }, h('tbody', {}, list.songs.map((song, i) =>
            h('tr', {},
              h('td', { class: 'red', style: { width: '34px' } }, two(i + 1)),
              h('td', { style: { width: '190px', font: '600 14px var(--display)', color: song.slot === S.slot ? 'var(--amber)' : '' } }, `${two(song.slot)} · ${memName(song.slot) || '(no name)'}`),
              h('td', { style: { width: '60px' } }, pips(mem(song.slot)?.tracks)),
              h('td', {}, h('input', { type: 'text', value: song.note, placeholder: 'Note (key, cue, capo…)', maxLength: 80, onchange: (e) => { song.note = e.target.value; saveLocal('setlists', lists); } })),
              h('td', { style: { width: '230px' } }, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end' } },
                btn('Go', () => selectSlot(song.slot), 'small primary'),
                btn('▲', () => move(i, -1), 'small', { disabled: i === 0 }),
                btn('▼', () => move(i, 1), 'small', { disabled: i === list.songs.length - 1 }),
                btn('×', () => { list.songs.splice(i, 1); save(); }, 'small ghost')))))))
            : h('div', { class: 'note' }, 'No songs yet. Select a memory, then press Add.'))));
}

const mgr = { from: 1, to: 2, audio: true };
const imp = { scan: null, picks: new Map() }; // slot in the package -> { on, to }

async function chooseImport() {
  const picked = await S.backend.pickImport().catch((e) => void toast(e.message, true));
  if (!picked) return;
  const scan = await run(() => scanImport(S.backend, picked.root));
  if (!scan) return;
  if (!scan.memories.length) return void toast('That folder has no memory files.', true);
  imp.scan = { ...scan, name: picked.name };
  imp.picks = new Map(scan.memories.map((m) => [m.slot, { on: true, to: m.slot }]));
  S.render();
}

async function runImport() {
  const d = S.device;
  const picks = imp.scan.memories.filter((m) => imp.picks.get(m.slot).on).map((m) => ({ memory: m, to: imp.picks.get(m.slot).to }));
  if (!picks.length) return void toast('Tick at least one memory.', true);
  const targets = picks.map((p) => p.to);
  if (new Set(targets).size !== targets.length) return void toast('Two memories go to the same slot.', true);
  if (rhythmDirty()) return void toast('Write or revert your rhythm edits first (Rhythm view).', true);
  if (!(await leaveCheck())) return;
  const lines = picks.map((p) => {
    const cur = d.memories[p.to - 1];
    const loops = cur ? cur.tracks.filter(Boolean).length : 0;
    return `${two(p.to)}: "${p.memory.name}" replaces "${cur ? memName(p.to) : 'empty'}"${loops ? `, ${loops} loop(s) go to the trash folder` : ''}`;
  });
  const ok = await confirm('Import memories', `${lines.join('\n')}\n\nA settings backup is saved first. New user rhythms are added after yours; yours are kept.`, 'Import', 'warn');
  if (!ok) return;
  await run(async () => {
    audio.stopAll();
    S.lastBackup = await S.backend.backup(d.root, { wave: false });
    const out = await applyImport(d, imp.scan, picks);
    forgetAudio();
    forgetRhythms();
    S.doc = await d.loadMemory(S.slot);
    imp.scan = null;
    for (const r of out.results) if (r.note) toast(`Memory ${r.to}: ${r.note}`, true);
    return out;
  }, (out) => `Imported ${out.results.length} memory(s)${out.addedRhythms.length ? ` and ${out.addedRhythms.length} user rhythm(s)` : ''}. Backup: ${S.lastBackup.path.split('/').pop()}`);
}

function importPanel() {
  const d = S.device;
  if (!imp.scan) {
    return panel('flat', label('読込', 'IMPORT'),
      h('div', { class: 'note', style: { marginBottom: '10px' } },
        'Copy memories and user rhythms from another ROLAND folder onto this looper, for example the unzipped RC600-setup package. You choose the destination slot of each memory.'),
      btn('Import from folder…', chooseImport, 'primary'));
  }
  const s = imp.scan;
  return panel('hot', label('読込', `IMPORT FROM ${s.name.toUpperCase()}`),
    h('div', { class: 'table-scroll' }, h('table', { class: 'grid-table' },
      h('thead', {}, h('tr', {}, ['', 'In package', 'Name', 'BPM', 'Rhythm', 'To slot', 'Replaces'].map((x) => h('th', {}, x)))),
      h('tbody', {}, s.memories.map((m) => {
        const pick = imp.picks.get(m.slot);
        const cur = d.memories[pick.to - 1];
        const loops = cur ? cur.tracks.filter(Boolean).length : 0;
        return h('tr', {},
          h('td', {}, h('input', { type: 'checkbox', checked: pick.on, onchange: (e) => { pick.on = e.target.checked; S.render(); } })),
          h('td', { class: 'red' }, two(m.slot)),
          h('td', { style: { whiteSpace: 'pre' } }, m.name),
          h('td', {}, m.tempo),
          h('td', { class: 'dim' }, m.rhythmName ? `USER: ${m.rhythmName}` : m.userRhythm != null ? 'USER (missing)' : 'built-in'),
          h('td', {}, h('select', { style: { width: '84px' }, onchange: (e) => { pick.to = Number(e.target.value); S.render(); } },
            Array.from({ length: 99 }, (_, i) => h('option', { value: i + 1, selected: pick.to === i + 1 }, two(i + 1))))),
          h('td', { class: loops ? 'amber' : 'dim' }, cur ? `${memName(pick.to) || '(no name)'}${loops ? ` · ${loops} loop(s)` : ''}` : 'empty'));
      })))),
    h('div', { class: 'note', style: { margin: '10px 0' } },
      s.rhythms.length ? `The package has ${s.rhythms.length} user rhythm(s). Those not on the looper yet are added after yours, and each memory is pointed to its rhythm by name.` : 'The package has no user rhythms.'),
    h('div', { class: 'row' }, btn('Import', runImport, 'warn'), btn('Cancel', () => { imp.scan = null; S.render(); }, 'ghost')));
}

function managerView() {
  const d = S.device;
  const slotSelect = (key) => h('select', { onchange: (e) => { mgr[key] = Number(e.target.value); S.render(); } },
    d.memories.map((m, i) => m && h('option', { value: i + 1, selected: mgr[key] === i + 1 }, `${two(i + 1)}: ${memName(i + 1)}`)));
  const act = async (kind) => {
    const { from, to } = mgr;
    if (from === to) return void toast('Choose two different memories.', true);
    if (!(await leaveCheck())) return;
    const text = kind === 'copy'
      ? `Memory ${two(to)} "${memName(to)}" is overwritten with memory ${two(from)} "${memName(from)}"${mgr.audio ? ', loops included' : '. Its own loops stay'}.`
      : `Memories ${two(from)} and ${two(to)} trade places, loops included.`;
    if (!(await confirm(kind === 'copy' ? 'Copy memory' : 'Swap memories', `${text}\n\nSave a backup first if you are not sure.`, kind === 'copy' ? 'Copy' : 'Swap', 'warn'))) return;
    await run(async () => {
      audio.stopAll();
      if (kind === 'copy') await d.copyMemory(from, to, mgr.audio);
      else await d.swapMemories(from, to);
      forgetAudio();
      S.doc = await d.loadMemory(S.slot);
    }, kind === 'copy' ? `Memory ${two(from)} copied to ${two(to)}` : `Memories ${two(from)} and ${two(to)} swapped`);
  };
  return h('div', { class: 'stack' },
    panel('hot', h('div', { class: 'hero' },
      h('div', { class: 'grow' }, label('マネージャー', 'MANAGER', true), h('div', { class: 'title big' }, 'Bulk copy and backup'),
        h('div', { class: 'sub' }, 'Reorder memories for a show, duplicate a setup, and keep the looper backed up.')),
      h('div', { style: { textAlign: 'right' } }, h('div', { class: 'code' }, d.root), h('div', { class: 'hazard' })))),
    h('div', { class: 'grid', style: { gridTemplateColumns: '1.3fr 1fr' } },
      panel('flat', label('複製', 'COPY / SWAP MEMORY'),
        h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr', gap: '0 12px' } },
          h('div', { class: 'field' }, h('div', { class: 'k' }, 'From'), slotSelect('from')),
          h('div', { class: 'field' }, h('div', { class: 'k' }, 'To'), slotSelect('to'))),
        h('label', { class: 'row note', style: { margin: '4px 0 12px' } },
          h('input', { type: 'checkbox', checked: mgr.audio, onchange: (e) => (mgr.audio = e.target.checked) }), 'Copy the loops (WAV files) with the settings'),
        h('div', { class: 'row' }, btn('Copy  →', () => act('copy'), 'warn'), btn('Swap  ⇄', () => act('swap')),
          h('span', { class: 'grow' }), btn('Use current as From', () => { mgr.from = S.slot; S.render(); }, 'small ghost'))),
      panel('flat', label('保存', 'BACKUP'),
        h('div', { class: 'note', style: { marginBottom: '10px' } }, S.backend.kind === 'demo' ? 'Demo backups are kept in memory only.' : 'Backups go to Documents/RC-600 Backups, one dated folder each. Deleted or replaced loops go to the app trash folder first.'),
        h('div', { class: 'row wrap' }, btn('Save backup', saveBackup, 'go'), btn('Load backup', loadBackup),
          btn('Show in Finder', () => S.backend.reveal(`${d.root}/DATA`), 'ghost', { disabled: S.backend.kind === 'demo' })),
        h('div', { class: 'note', style: { marginTop: '10px' } }, S.lastBackup ? `Last: ${S.lastBackup.path}` : 'No backup in this session yet.'))),
    importPanel(),
    panel('flat', label('一覧', 'MEMORY FILES'),
      h('div', { style: { maxHeight: '340px', overflow: 'auto' } },
        h('table', { class: 'grid-table' },
          h('thead', {}, h('tr', {}, ['#', 'Name', 'Loops', 'BPM', 'Current file', 'Count A', 'Count B', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, d.memories.filter(Boolean).map((m) => h('tr', {},
            h('td', { class: 'red' }, two(m.slot)), h('td', { style: { whiteSpace: 'pre' } }, memName(m.slot)), h('td', {}, pips(m.tracks)), h('td', {}, m.tempo ?? ''),
            h('td', { class: 'dim' }, rc.memoryFile(m.slot, m.current)), h('td', { class: m.current === 'A' ? '' : 'dim' }, m.counts.A ?? '—'), h('td', { class: m.current === 'B' ? '' : 'dim' }, m.counts.B ?? '—'),
            h('td', {}, btn('Select', () => selectSlot(m.slot), 'small ghost')))))))));
}

function standbyView() {
  return panel('flat', h('div', { class: 'empty-state' },
    h('div', { class: 'hazard', style: { height: '8px', maxWidth: '420px', margin: '0 auto 22px' } }),
    h('div', { class: 'big jp' }, '待機中'),
    h('div', { class: 'title', style: { marginTop: '12px' } }, 'Awaiting RC-600 storage'),
    h('div', { class: 'sub', style: { margin: '10px auto 18px', maxWidth: '520px' } },
      S.backend.kind === 'demo'
        ? 'This is the demo build running in a browser. Connect the demo volume to explore the editor. Nothing is written to disk.'
        : 'Connect the looper by USB, then on the unit choose MENU › USB › STORAGE › CONNECT. The volume appears here. You can also browse to a copy of the ROLAND folder.'),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      btn(S.volume ? `Connect ${S.volume.name}` : 'No volume found', () => connectVolume(), 'primary', { disabled: !S.volume }),
      btn('Browse', browseFolder), btn('Refresh', refreshVolumes, 'ghost'))));
}

const VIEWS = { overview: overviewView, memory: memoryView, rhythm: rhythmView, system: systemView, audio: audioView, setlists: setlistsView, manager: managerView };

// ------------------------------------------------------------------ render

let lastView = '';
function render() {
  const mainOld = root.querySelector('.main');
  const key = `${S.view}/${S.section}`;
  const scroll = key === lastView && mainOld ? mainOld.scrollTop : 0;
  const listOld = root.querySelector('.editor > .scroll');
  const listScroll = listOld ? listOld.scrollTop : null;
  const focusId = document.activeElement?.id;
  if (S.view !== 'rhythm') stopRhythm();
  lastView = key;

  let n = 0;
  const nav = h('div', { class: 'nav' }, NAV.map(([group, items]) => [
    h('div', { class: 'group' }, group),
    items.map(([view, title, sub, section]) => h('button', {
      class: S.view === view && (!section || S.section === section || (view === 'memory' && title === 'Memory Editor' && !['assigns', 'ifx', 'tfx'].includes(S.section))) ? 'active' : '',
      onclick: () => go(view, section),
    }, h('span', { class: 'ix' }, two(++n)), h('span', { class: 't' }, title), h('span', { class: 's' }, sub))),
  ]));

  const main = h('div', { class: 'main' }, S.device && S.doc ? VIEWS[S.view]() : standbyView());
  root.replaceChildren(
    h('div', { class: 'titlebar' }, h('i', { class: 'hazard' }), 'RC-600 EDITOR  //  ループ指令室  //  UNIT-06', h('i', { class: 'hazard' })),
    h('div', { class: 'header' }, heroModule(), midiModule(), storageModule(), memoryModule()),
    h('div', { class: 'body' }, panel('tight sidebar', nav), main),
    h('div', { class: `busy${S.busy ? '' : ' hidden'}`, id: 'busy' }));
  main.scrollTop = scroll;
  const list = root.querySelector('.editor > .scroll');
  if (list) {
    if (listScroll != null) list.scrollTop = listScroll;
    else list.querySelector('.item.active')?.scrollIntoView({ block: 'center' });
  }
  if (focusId) document.getElementById(focusId)?.focus();
  refreshChrome();
}

S.render = render;
S.refreshChrome = refreshChrome;
midi.onChange = render;
midi.onMessage = () => {
  const el = document.getElementById('midi-note');
  if (el) el.textContent = `Last received: ${midi.lastMessage}`;
};

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (S.view === 'system' && sysDirty()) writeSystem();
    else if (dirty()) writeMemory();
  }
});
render();
refreshVolumes();

if (S.backend.kind === 'native') {
  midiLink.refreshPorts().then(render).catch(() => {});
  // Notice when the looper is plugged in or removed while no volume is connected.
  setInterval(async () => {
    if (S.device || S.busy || document.querySelector('.modal-back')) return;
    const found = await S.backend.findVolumes().catch(() => null);
    if (found && JSON.stringify(found) !== JSON.stringify(S.volumes)) refreshVolumes();
  }, 4000);
}
