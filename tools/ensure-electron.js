// Electron downloads its app binary in an install script. When npm skips install
// scripts, or the download was cut off, the binary is missing and "electron ."
// fails with "Electron failed to install correctly". This runs the download again.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = path.join(__dirname, '..', 'node_modules', 'electron');
if (!fs.existsSync(path.join(dir, 'install.js'))) {
  console.error('Electron is not installed. Run "npm install" first.');
  process.exit(1);
}
if (!fs.existsSync(path.join(dir, 'path.txt')) || !fs.existsSync(path.join(dir, 'dist'))) {
  console.log('The Electron binary is missing. Downloading it now (about 100 MB)...');
  execFileSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
}
