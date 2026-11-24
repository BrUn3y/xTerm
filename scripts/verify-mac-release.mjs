import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

assert.equal(process.platform, 'darwin', 'macOS is required to verify release bundles');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const output = path.resolve(process.argv[2] || 'release');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'xterm-release-'));
const mount = path.join(temporary, 'dmg');
let mounted = false;
const run = (command, args, options = {}) => execFileSync(command, args, {stdio: 'inherit', ...options});

function verify(app, format) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  for (const [key, expected] of [
    ['CFBundleShortVersionString', version], ['CFBundleIdentifier', 'studio.xterm.desktop'],
  ]) {
    assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(app, 'Contents/Info.plist')],
      {encoding: 'utf8'}).trim(), expected);
  }
  const executable = path.join(app, 'Contents/MacOS/xTerm');
  assert.ok(statSync(executable).mode & 0o111, 'The application binary must be executable');
  run(process.execPath, ['scripts/test-clipboard-desktop.mjs'], {
    env: {...process.env, XTERM_DESKTOP_TEST_EXECUTABLE: executable,
      XTERM_UI_TEST_OUTPUT: path.join(output, `verification-${format}`)},
  });
  console.log(`PASS ${format}: bundle signature, version, startup, native PTY and clipboard regressions`);
}

try {
  run('/usr/bin/ditto', ['-x', '-k', path.join(output, `xTerm-${version}-arm64-mac.zip`), path.join(temporary, 'zip')]);
  verify(path.join(temporary, 'zip/xTerm.app'), 'zip');
  run('/usr/bin/hdiutil', ['attach', path.join(output, `xTerm-${version}-arm64.dmg`), '-readonly', '-nobrowse', '-mountpoint', mount]);
  mounted = true;
  verify(path.join(mount, 'xTerm.app'), 'dmg');
} finally {
  if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
  rmSync(temporary, {recursive: true, force: true});
}
