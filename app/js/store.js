// Application state and the actions that change it.

import * as rc from './rc0.js';
import { createBackend } from './backend.js';
import { Device } from './device.js';
import { toast, dialog, confirm } from './ui.js';
import * as midiLink from './midi.js';
import * as audio from './audio.js';

export const S = {
  backend: createBackend(),
  volumes: [],
  volume: null, // chosen entry of volumes
  device: null,
  slot: 1,
  doc: null, // parsed current memory, with pending edits
  sysDoc: null,
  view: 'overview',
  section: 'tracks',
  busy: 0,
  followMidi: true,
  lastBackup: null,
  render: () => {},
  refreshChrome: () => {},
};

export const dirty = () => !!S.doc && rc.isDirty(S.doc);
export const sysDirty = () => !!S.sysDoc && rc.isDirty(S.sysDoc);
export const mem = (slot = S.slot) => S.device?.memories[slot - 1] || null;
export const memName = (slot = S.slot) => (slot === S.slot && S.doc ? rc.readName(S.doc) : mem(slot)?.name) || '';

/** Run an async action with the busy bar and error reporting. */
export async function run(fn, okMessage) {
  S.busy++;
  S.refreshChrome();
  try {
    const result = await fn();
    if (okMessage) toast(typeof okMessage === 'function' ? okMessage(result) : okMessage);
    return result;
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), true);
    return undefined;
  } finally {
    S.busy--;
    S.render();
  }
}

export async function refreshVolumes() {
  S.volumes = await S.backend.findVolumes().catch(() => []);
  if (!S.volume || !S.volumes.some((v) => v.root === S.volume.root)) S.volume = S.volumes[0] || null;
  S.render();
}

export async function connectVolume(volume = S.volume) {
  if (!volume) return;
  if (!(await leaveCheck())) return;
  await run(async () => {
    audio.stopAll();
    const device = new Device(S.backend, volume);
    const count = await device.scan();
    if (!count) throw new Error('No MEMORY files found in ROLAND/DATA.');
    S.device = device;
    S.volume = volume;
    if (!S.volumes.some((v) => v.root === volume.root)) S.volumes.push(volume);
    S.doc = null;
    S.sysDoc = null;
    S.slot = device.memories.find(Boolean).slot;
    S.doc = await device.loadMemory(S.slot);
    return count;
  }, (count) => `Connected: ${count} memories, ${S.device.waveCount} loop folders`);
}

export async function browseFolder() {
  const volume = await S.backend.pickFolder().catch((e) => void toast(e.message, true));
  if (volume) await connectVolume(volume);
}

export async function disconnectVolume(eject) {
  if (!(await leaveCheck())) return;
  await run(async () => {
    audio.stopAll();
    const root = S.device?.root;
    S.device = null;
    S.doc = null;
    S.sysDoc = null;
    if (eject && root) await S.backend.eject(root);
  }, eject ? 'Volume ejected. It is safe to unplug the looper.' : 'Disconnected');
  await refreshVolumes();
}

/** Ask what to do with pending edits. Returns false when the user cancels. */
export async function leaveCheck() {
  if (!dirty() && !sysDirty()) return true;
  const what = [dirty() && `memory ${S.slot}`, sysDirty() && 'system settings'].filter(Boolean).join(' and ');
  const choice = await dialog({
    title: 'Unwritten changes',
    body: `There are changes to ${what} that are not written to the looper yet.`,
    buttons: [{ text: 'Discard', value: 'discard', cls: 'danger' }, { text: 'Write', value: 'write', cls: 'primary' }],
  });
  if (!choice) return false;
  if (choice === 'write') {
    if (dirty()) await writeMemory();
    if (sysDirty()) await writeSystem();
  } else {
    if (S.doc) rc.revert(S.doc);
    if (S.sysDoc) rc.revert(S.sysDoc);
  }
  return true;
}

export async function selectSlot(slot, { ask = true } = {}) {
  if (!S.device || slot === S.slot) return;
  if (!mem(slot)) return void toast(`Memory ${slot} has no file on this volume.`, true);
  if (ask && dirty()) {
    const keepSys = S.sysDoc;
    S.sysDoc = null; // only the memory matters here
    const ok = await leaveCheck();
    S.sysDoc = keepSys;
    if (!ok) return;
  }
  audio.stopAll();
  await run(async () => {
    S.doc = await S.device.loadMemory(slot);
    S.slot = slot;
    if (S.followMidi && midiLink.midi.output) midiLink.programChange(slot);
  });
}

export async function writeMemory() {
  if (!S.device || !S.doc) return;
  await run(async () => {
    S.doc = await S.device.saveMemory(S.slot, S.doc);
  }, () => `Memory ${S.slot} written (copy ${mem().current}, count ${mem().counts[mem().current].toString(16).toUpperCase().padStart(4, '0')})`);
}

export function revertMemory() {
  if (S.doc) rc.revert(S.doc);
  S.render();
}

export async function ensureSystem() {
  if (S.sysDoc || !S.device?.systemState) return;
  await run(async () => {
    S.sysDoc = await S.device.loadSystem();
  });
}

export async function writeSystem() {
  if (!S.device || !S.sysDoc) return;
  await run(async () => {
    S.sysDoc = await S.device.saveSystem(S.sysDoc);
  }, 'System settings written');
}

export async function saveBackup() {
  if (!S.device) return;
  const choice = await dialog({
    title: 'Save backup',
    jp: '保存',
    body: 'Settings only is fast (memory and system files).\nFull also copies every loop WAV and can take several minutes over USB.',
    buttons: [{ text: 'Full with loops', value: 'full', cls: '' }, { text: 'Settings only', value: 'data', cls: 'go' }],
  });
  if (!choice) return;
  await run(async () => {
    S.lastBackup = await S.backend.backup(S.device.root, { wave: choice === 'full' });
    return S.lastBackup;
  }, (b) => `Backup saved: ${b.path}`);
}

export async function loadBackup() {
  if (!S.device) return;
  const picked = await S.backend.pickBackup().catch((e) => void toast(e.message, true));
  if (!picked) return;
  const ok = await confirm('Restore backup',
    `This replaces all memory and system files on "${S.device.name}"${picked.wave ? ' and ALL loops' : ''} with the backup.\n\nPending edits are discarded.`,
    'Restore', 'danger');
  if (!ok) return;
  await run(async () => {
    audio.stopAll();
    await S.backend.restore(picked.path, S.device.root);
    await S.device.scan();
    S.sysDoc = null;
    S.doc = await S.device.loadMemory(S.slot);
  }, 'Backup restored');
}

export function go(view, section) {
  S.view = view;
  if (section) S.section = section;
  S.render();
}

// ---- small persistent settings (setlists, rhythm patterns) ----
export function loadLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`rc600.${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveLocal(key, value) {
  try {
    localStorage.setItem(`rc600.${key}`, JSON.stringify(value));
  } catch {
    /* storage may be unavailable; the data then lasts for this session only */
  }
}
