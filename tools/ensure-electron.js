// Makes sure the Electron app binary is in node_modules/electron/dist.
//
// Electron downloads its binary in an install script. That script does not run
// when npm blocks install scripts (newer npm asks you to approve them), when
// ELECTRON_SKIP_BINARY_DOWNLOAD is set, or when the download was cut off. Then
// "electron ." fails with "Electron failed to install correctly".
//
// Route 1: run Electron's own installer.
// Route 2: if that fails, download the zip from GitHub with curl, check its
//          SHA-256 against the list shipped with the electron package, and unzip it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, '..', 'node_modules', 'electron');
const dist = path.join(dir, 'dist');
const exeFor = (platform) => ({ darwin: 'Electron.app/Contents/MacOS/Electron', linux: 'electron', win32: 'electron.exe' })[platform];

function installed() {
  try {
    const exe = fs.readFileSync(path.join(dir, 'path.txt'), 'utf-8');
    return fs.existsSync(path.join(dist, exe));
  } catch {
    return false;
  }
}

function describe(run) {
  if (run.error) return `could not start: ${run.error.message}`;
  if (run.signal) return `stopped by signal ${run.signal}`;
  return `exit code ${run.status}`;
}

function routeInstaller() {
  const env = { ...process.env };
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  const run = spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit', env });
  if (installed()) return true;
  console.log(`Electron's installer did not install it (${describe(run)}${run.status === 0 ? ', and it printed no error' : ''}).`);
  return false;
}

function routeCurl() {
  const { version } = require(path.join(dir, 'package.json'));
  const platform = process.platform;
  const arch = process.arch;
  const file = `electron-v${version}-${platform}-${arch}.zip`;
  const expected = require(path.join(dir, 'checksums.json'))[file];
  if (!expected || !exeFor(platform)) {
    console.log(`No Electron build is listed for ${platform}-${arch}.`);
    return false;
  }
  const url = `https://github.com/electron/electron/releases/download/v${version}/${file}`;
  const zip = path.join(os.tmpdir(), file);
  console.log(`\nDownloading ${url}`);
  const get = spawnSync('curl', ['-fL', '--retry', '3', '-o', zip, url], { stdio: 'inherit' });
  if (get.status !== 0) {
    console.log(`The download failed (curl: ${describe(get)}).`);
    return false;
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if (actual !== expected) {
    console.log(`The downloaded file is damaged or not the right one (SHA-256 ${actual}, expected ${expected}).`);
    fs.rmSync(zip, { force: true });
    return false;
  }
  console.log('Checksum OK. Unpacking...');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  // ditto keeps the macOS app bundle intact (links, permissions, signature).
  const unpack = platform === 'darwin'
    ? spawnSync('ditto', ['-x', '-k', zip, dist], { stdio: 'inherit' })
    : spawnSync('unzip', ['-q', '-o', zip, '-d', dist], { stdio: 'inherit' });
  fs.rmSync(zip, { force: true });
  if (unpack.status !== 0) {
    console.log(`Unpacking failed (${describe(unpack)}).`);
    return false;
  }
  fs.writeFileSync(path.join(dir, 'path.txt'), exeFor(platform));
  return installed();
}

if (!fs.existsSync(path.join(dir, 'package.json'))) {
  console.error('Electron is not installed. Run "npm install" first.');
  process.exit(1);
}
if (installed()) process.exit(0);

console.log('The Electron binary is missing. Downloading it now (about 100 MB)...');
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  console.log(`Note: ELECTRON_SKIP_BINARY_DOWNLOAD is set to "${process.env.ELECTRON_SKIP_BINARY_DOWNLOAD}". It is ignored here.`);
}
if (routeInstaller() || routeCurl()) {
  console.log('Electron is ready.');
  process.exit(0);
}
console.error('\nElectron could not be installed. Send the messages above.');
process.exit(1);
