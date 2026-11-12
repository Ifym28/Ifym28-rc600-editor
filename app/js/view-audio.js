// Audio manager: preview, import, export, copy, paste, delete and bounce of the track loops.

import * as rc from './rc0.js';
import { S, run, memName, mem } from './store.js';
import { h, label, panel, btn, toast, confirm, dialog, drawWave } from './ui.js';
import * as audio from './audio.js';
import { decodeWav, toStereo, encodePcm16, encodeRcWav, peaks, mixTracks, RATE } from './wav.js';

const cache = new Map(); // "slot_track" -> { left, right, peaks }
const ui = { files: null, filesFor: null, useLevels: true, bounce: new Set(), clipboard: null, raf: 0 };

export function forgetAudio() {
  cache.clear();
  ui.files = null;
  ui.filesFor = null;
}

const keyOf = (track, slot = S.slot) => `${slot}_${track}`;
const trackSec = (track) => rc.section(S.doc, 'mem', `TRACK${track}`);

async function loadTrack(track) {
  const key = keyOf(track);
  if (cache.has(key)) return cache.get(key);
  const file = ui.files?.[track - 1];
  if (!file) return null;
  const bytes = await S.backend.read(file.path);
  const [left, right] = toStereo(decodeWav(bytes).channels);
  const entry = { left, right, peaks: peaks(left, 400) };
  cache.set(key, entry);
  return entry;
}

function mixParams(track) {
  const sec = trackSec(track);
  return ui.useLevels ? { level: rc.getNum(sec, 'D', 100) / 100, pan: rc.getNum(sec, 'C', 50) / 100 } : { level: 1, pan: 0.5 };
}

async function playTrack(track, when) {
  const a = await loadTrack(track);
  if (!a) return;
  audio.play(keyOf(track), a.left, a.right, { ...mixParams(track), when });
}

async function playAll() {
  await run(async () => {
    audio.stopAll();
    const when = audio.audioContext().currentTime + 0.15;
    const loaded = [];
    for (let t = 1; t <= 6; t++) if (ui.files?.[t - 1]) loaded.push(loadTrack(t).then(() => t));
    for (const t of await Promise.all(loaded)) await playTrack(t, when);
  });
}

/** Write audio to a track, then write the memory so the looper sees the new loop. */
async function storeTrack(track, left, right, what) {
  await run(async () => {
    audio.stop(keyOf(track));
    const { frames, measures } = await S.device.putTrackAudio(S.slot, track, left, right, S.doc);
    S.doc = await S.device.saveMemory(S.slot, S.doc);
    cache.set(keyOf(track), { left, right, peaks: peaks(left, 400) });
    ui.files = null;
    return { frames, measures };
  }, ({ frames, measures }) => `${what} → track ${track}: ${(frames / RATE).toFixed(2)} s, ${measures} measure${measures > 1 ? 's' : ''}. Memory written.`);
}

/** Used by other views: put a rendered loop on a track of the current memory, after a confirm if it is in use. */
export async function putLoop(track, left, right, what) {
  if (S.device.waveDirs.has(rc.waveDir(S.slot, track))
    && !(await confirm(`Replace track ${track}`, `Track ${track} of memory ${S.slot} already holds a loop. The old WAV is moved to the app trash folder and replaced.`, 'Replace', 'warn'))) return false;
  await storeTrack(track, left, right, what);
  return true;
}

async function overwriteOk(track) {
  if (!ui.files?.[track - 1]) return true;
  return confirm(`Replace track ${track}`, `Track ${track} of memory ${S.slot} already holds a loop. The old WAV is moved to the app trash folder and replaced.`, 'Replace', 'warn');
}

async function importTrack(track) {
  const file = await S.backend.openFile(['wav', 'aif', 'aiff', 'mp3', 'm4a', 'flac', 'ogg']);
  if (!file || !(await overwriteOk(track))) return;
  const decoded = await run(() => audio.decodeToStereo(file.bytes));
  if (!decoded) return;
  if (decoded.left.length < RATE * 0.35) return void toast('The file is shorter than 0.35 s, which the looper does not accept.', true);
  await storeTrack(track, decoded.left, decoded.right, file.name);
}

async function exportTrack(track) {
  const a = await run(() => loadTrack(track));
  if (!a) return;
  const choice = await dialog({
    title: `Export track ${track}`, jp: '書出',
    body: '32-bit float is the looper format, bit for bit.\n16-bit PCM opens in every audio program.',
    buttons: [{ text: '16-bit PCM', value: 16, cls: '' }, { text: '32-bit float', value: 32, cls: 'primary' }],
  });
  if (!choice) return;
  const bytes = choice === 32 ? encodeRcWav(a.left, a.right) : encodePcm16(a.left, a.right);
  const name = `${rc.pad3(S.slot)}_${(memName() || 'memory').replace(/[^\w-]+/g, '_')}_T${track}.wav`;
  if (await S.backend.saveFile(name, bytes)) toast(`Exported ${name}`);
}

async function deleteTrack(track) {
  if (!(await confirm(`Delete track ${track}`, `The loop of track ${track} in memory ${S.slot} is removed from the looper. A copy goes to the app trash folder.`, 'Delete', 'danger'))) return;
  await run(async () => {
    audio.stop(keyOf(track));
    await S.device.clearTrackAudio(S.slot, track, S.doc);
    S.doc = await S.device.saveMemory(S.slot, S.doc);
    cache.delete(keyOf(track));
    ui.bounce.delete(track);
    ui.files = null;
  }, `Track ${track} cleared. Memory written.`);
}

async function bounce(target) {
  const tracks = [...ui.bounce].filter((t) => ui.files?.[t - 1]).sort();
  if (!tracks.length) return;
  const parts = await run(async () => {
    const out = [];
    for (const t of tracks) out.push({ ...(await loadTrack(t)), ...mixParams(t) });
    return out;
  });
  if (!parts) return;
  const [left, right] = mixTracks(parts);
  if (target) {
    if (!(await overwriteOk(target))) return;
    await storeTrack(target, left, right, `Bounce of ${tracks.join('+')}`);
  } else {
    const name = `${rc.pad3(S.slot)}_bounce_${tracks.join('-')}.wav`;
    if (await S.backend.saveFile(name, encodeRcWav(left, right))) toast(`Bounce saved: ${name}`);
  }
}

function trackRow(track) {
  const file = ui.files?.[track - 1];
  const sec = trackSec(track);
  const key = keyOf(track);
  const canvas = h('canvas', { class: 'wave', 'data-track': track });
  const status = h('div', { class: 'note', style: { marginTop: '3px' } }, file ? 'Press Play to preview' : 'No loop on this track');
  if (file) {
    loadTrack(track).then((a) => {
      if (!a || !canvas.isConnected) return;
      drawWave(canvas, a.peaks, audio.position(key));
      status.textContent = `${(a.left.length / RATE).toFixed(2)} s · ${a.left.length} samples · file tag X = ${rc.getNum(sec, 'X')}`;
      if (a.left.length !== rc.getNum(sec, 'X')) status.append(h('span', { class: 'amber' }, '  length differs from the memory file'));
    }).catch((e) => (status.textContent = `Cannot read WAV: ${e.message}`));
  } else queueMicrotask(() => drawWave(canvas, null));
  const playing = audio.isPlaying(key);
  return panel(file ? '' : 'flat',
    h('div', { class: 'track-row' },
      h('div', {}, label('トラック', 'TRACK', true), h('div', { class: `n ${file ? 'red' : 'dim'}` }, `0${track}`), h('span', { class: `badge ${file ? '' : 'off'}` }, file ? 'LOADED' : 'EMPTY')),
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'title', style: { fontSize: '15px' } }, file ? file.name : '———'),
        h('div', { class: 'code' }, `WAVE/${rc.waveDir(S.slot, track)}/`),
        h('div', { class: 'code' }, file ? `${(file.size / 1048576).toFixed(2)} MB` : 'EMPTY SLOT')),
      h('div', { style: { minWidth: 0 } }, canvas, status),
      h('div', { class: 'row wrap actions' },
        btn('Play', () => run(() => playTrack(track)), `small ${playing ? 'active' : 'primary'}`, { disabled: !file }),
        btn('Stop', () => { audio.stop(key); S.render(); }, 'small', { disabled: !playing }),
        btn('Import', () => importTrack(track), 'small'),
        btn('Export', () => exportTrack(track), 'small', { disabled: !file }),
        btn('Copy', async () => {
          const a = await run(() => loadTrack(track));
          if (a) { ui.clipboard = { ...a, from: `M${S.slot} T${track}` }; toast(`Copied track ${track}`); S.render(); }
        }, 'small', { disabled: !file }),
        btn('Paste', async () => {
          if (await overwriteOk(track)) await storeTrack(track, ui.clipboard.left, ui.clipboard.right, `Paste of ${ui.clipboard.from}`);
        }, 'small', { disabled: !ui.clipboard }),
        btn('Delete', () => deleteTrack(track), 'small danger', { disabled: !file })),
      h('label', { class: 'col bounce', style: { alignItems: 'center', gap: '4px' } },
        h('span', { class: 'code' }, 'BOUNCE'),
        h('input', { type: 'checkbox', checked: ui.bounce.has(track), disabled: !file, onchange: (e) => { e.target.checked ? ui.bounce.add(track) : ui.bounce.delete(track); S.render(); } }),
        h('span', { class: 'code' }, `LV ${rc.getNum(sec, 'D')}`))));
}

function animate() {
  cancelAnimationFrame(ui.raf);
  const tick = () => {
    const canvases = document.querySelectorAll('canvas.wave[data-track]');
    if (!canvases.length) return;
    for (const c of canvases) {
      const key = keyOf(Number(c.dataset.track));
      const a = cache.get(key);
      if (a && audio.isPlaying(key)) drawWave(c, a.peaks, audio.position(key));
    }
    ui.raf = requestAnimationFrame(tick);
  };
  ui.raf = requestAnimationFrame(tick);
}

export function audioView() {
  if (ui.filesFor !== `${S.device.root}:${S.slot}` || !ui.files) {
    const want = `${S.device.root}:${S.slot}`;
    if (ui.filesFor !== want) ui.bounce.clear();
    ui.filesFor = want;
    ui.files = null;
    S.device.trackFiles(S.slot).then((files) => {
      if (ui.filesFor !== want) return;
      ui.files = files;
      S.render();
    }).catch((e) => toast(e.message, true));
    return panel('flat', h('div', { class: 'note' }, 'Reading loop folders…'));
  }
  const loaded = ui.files.filter(Boolean).length;
  const empty = [1, 2, 3, 4, 5, 6].filter((t) => !ui.files[t - 1]);
  const target = h('select', { style: { width: '190px' } },
    h('option', { value: 0 }, 'Export as WAV file'),
    [1, 2, 3, 4, 5, 6].map((t) => h('option', { value: t }, `To track ${t}${empty.includes(t) ? ' (empty)' : ' (replace)'}`)));
  queueMicrotask(animate);
  return h('div', { class: 'stack' },
    panel('hot',
      h('div', { class: 'hero' },
        h('div', { class: 'grow' },
          label('オーディオ', 'AUDIO MANAGER', true),
          h('div', { class: 'title big' }, `Memory ${String(S.slot).padStart(2, '0')} loop tools`),
          h('div', { class: 'sub' }, 'Track preview, import, export, clipboard and bounce.')),
        h('div', { style: { textAlign: 'right' } },
          h('span', { class: `badge ${loaded ? '' : 'off'}` }, `${loaded} TRACK${loaded === 1 ? '' : 'S'} LOADED`),
          h('div', { class: 'code', style: { marginTop: '6px' } }, `${S.device.root}/WAVE`),
          h('div', { class: 'code' }, ui.clipboard ? `CLIPBOARD: ${ui.clipboard.from}` : 'CLIPBOARD EMPTY')))),
    h('div', { class: 'grid cols-3' },
      panel('flat', label('状態', 'LOADED TRACKS'), h('div', { class: 'num' }, `${loaded} / 6`),
        h('div', { class: 'note' }, `44.1 kHz · stereo · 32-bit float · ${mem().tempo ?? '--'} BPM`)),
      panel('flat', label('再生', 'PLAY MODE'),
        h('div', { class: 'row' }, btn('Play all', playAll, 'primary small', { disabled: !loaded }), btn('Stop all', () => { audio.stopAll(); S.render(); }, 'small')),
        h('label', { class: 'row note', style: { marginTop: '8px' } },
          h('input', { type: 'checkbox', checked: ui.useLevels, onchange: (e) => (ui.useLevels = e.target.checked) }), 'Use track play level and pan')),
      panel('flat', label('合成', 'BOUNCE'), h('div', { class: 'num' }, `${ui.bounce.size} selected`),
        h('div', { class: 'row', style: { marginTop: '6px' } }, target,
          btn('Bounce', () => bounce(Number(target.value)), 'small warn', { disabled: !ui.bounce.size })))),
    [1, 2, 3, 4, 5, 6].map(trackRow));
}
