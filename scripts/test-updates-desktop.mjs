import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(os.tmpdir(), 'xterm-desktop-updates-'));
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/update-desktop';
await mkdir(output, { recursive: true });
let application;
try {
  application = await electron.launch({
    executablePath: process.env.XTERM_DESKTOP_TEST_EXECUTABLE || undefined,
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), ...(process.env.XTERM_DESKTOP_TEST_EXECUTABLE ? [] : ['.'])],
    env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: directory, SHELL: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
      XTERM_DEV_URL: '', APPIMAGE: '', ELECTRON_RUN_AS_NODE: '' },
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => window.desktop && document.querySelector('.terminal-pane'));
  await page.getByText('Session connected', { exact: true }).waitFor();
  const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.sandbox, true);
  const state = await page.evaluate(() => window.desktop.updateState());
  assert.equal(state.status, 'unavailable');
  for (const action of ['check', 'download', 'restart']) {
    assert.equal((await page.evaluate(action => window.desktop.updateAction(action), action)).status, 'unavailable');
  }
  const rejected = await page.evaluate(async () => {
    try { await window.desktop.updateAction({ action: 'download', url: 'https://evil.test' }); return false; }
    catch { return true; }
  });
  assert.equal(rejected, true);
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByText('Updates unavailable', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'native-unavailable-light.png') });
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'native-unavailable-dark.png') });
  const session = await page.evaluate(async () => {
    const info = await window.desktop.info();
    return window.desktop.createTerminal({ id: 'update-smoke', cwd: info.home, shell: info.shell, cols: 80, rows: 24 });
  });
  assert.ok(session.pid > 0);
  const outputPromise = page.evaluate(() => new Promise(resolve => {
    const unsubscribe = window.desktop.onData(({ id, data }) => {
      if (id === 'update-smoke' && data.includes('XTERM_UPDATER_TERMINAL_OK')) { unsubscribe(); resolve(true); }
    });
    window.desktop.write('update-smoke', "printf 'XTERM_UPDATER_TERMINAL_OK\\n'\r");
  }));
  assert.equal(await outputPromise, true);
  await page.evaluate(() => window.desktop.closeTerminal('update-smoke'));
  console.log(`PASS native Electron (${process.env.XTERM_DESKTOP_TEST_EXECUTABLE ? 'packaged directory' : 'development'}): isolated home, sandboxed bridge, unavailable updates, invalid IPC rejection, Light/Dark and live bash PTY`);
  console.log('No packaged upgrade, code signature or notarization was tested.');
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
