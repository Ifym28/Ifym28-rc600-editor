const { contextBridge, ipcRenderer } = require('electron');

const names = [
  'findVolumes', 'pickFolder', 'list', 'read', 'write', 'mkdir', 'remove', 'snapshot',
  'backup', 'pickBackup', 'restore', 'saveFile', 'openFile', 'eject', 'reveal',
];

const api = { platform: process.platform };
for (const name of names) api[name] = (...args) => ipcRenderer.invoke(`rc600:${name}`, ...args);

contextBridge.exposeInMainWorld('rc600Native', api);
