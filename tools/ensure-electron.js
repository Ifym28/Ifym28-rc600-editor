// Electron downloads its app binary in an install script. When npm skips install
// scripts, the download was cut off, or ELECTRON_SKIP_BINARY_DOWNLOAD is set,
// the binary is missing and "electron ." fails with "Electron failed to install
// correctly". This runs the download again and checks that it worked.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, '..', 'node_modules', 'electron');
const installed = () => {
  try {
    const exe = fs.readFileSync(path.join(dir, 'path.txt'), 'utf-8');
    return fs.existsSync(path.join(dir, 'dist', exe));
  } catch {
    return false;
  }
};

if (!fs.existsSync(path.join(dir, 'install.js'))) {
  console.error('Electron is not installed. Run "npm install" first.');
  process.exit(1);
}
if (installed()) process.exit(0);

console.log('The Electron binary is missing. Downloading it now (about 100 MB)...');
const skip = process.env.ELECTRON_SKIP_BINARY_DOWNLOAD;
if (skip) {
  console.log(`Note: ELECTRON_SKIP_BINARY_DOWNLOAD is set to "${skip}" in your environment.`);
  console.log('It stops Electron from downloading. It is ignored for this download.');
}
const env = { ...process.env };
delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
const run = spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit', env });

if (run.status !== 0 || !installed()) {
  console.error('\nThe Electron download did not complete.');
  console.error('Try again with a fresh copy:');
  console.error('  rm -rf node_modules/electron && npm install && npm start');
  console.error('If it still fails, send the messages printed above.');
  process.exit(1);
}
console.log('Electron is ready.');
if (skip) {
  console.log('To stop this from happening again, remove ELECTRON_SKIP_BINARY_DOWNLOAD');
  console.log('from your shell profile (for example ~/.zshrc).');
}
