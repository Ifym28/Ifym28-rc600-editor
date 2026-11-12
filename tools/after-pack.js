// electron-builder hook, run after the app bundle is assembled and before the .dmg is made.
//
// Without an Apple developer certificate, electron-builder does not sign the app.
// But packaging changes the Electron bundle, so the signature that Electron ships
// with is no longer valid. A Mac with Apple Silicon refuses to run arm64 code with
// an invalid signature: the app is killed at launch, before any window shows.
// (The Intel build still starts, because Intel code may run unsigned.)
//
// An ad hoc signature ("-") needs no certificate and makes the bundle valid again.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.platform !== 'darwin') {
    console.warn('  • ad hoc signing skipped: codesign exists only on macOS. This build will not start on Apple Silicon.');
    return;
  }
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad hoc signed and verified  app=${app}`);
};
