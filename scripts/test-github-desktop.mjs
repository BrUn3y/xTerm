import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const home = await mkdtemp(path.join(os.tmpdir(), 'xterm-github-desktop-'));
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/github-desktop';
await mkdir(output, {recursive: true});
let application;
try {
  const alpha = path.join(home, 'alpha'), nested = path.join(alpha, 'src', 'nested');
  const beta = path.join(home, 'beta'), plain = path.join(home, 'plain'), other = path.join(home, 'other'), empty = path.join(home, 'empty');
  await mkdir(nested, {recursive: true});
  for (const cwd of [beta, plain, other, empty]) await mkdir(cwd);
  for (const [cwd, remote] of [[alpha, 'https://github.com/test-owner/alpha.git'], [beta, 'git@github.com:test-owner/beta.git'],
    [other, 'https://gitlab.com/test-owner/other.git'], [empty, null]]) {
    await exec('git', ['init', '--initial-branch=main'], {cwd});
    if (remote) await exec('git', ['remote', 'add', 'origin', remote], {cwd});
  }
  application = await electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'], cwd: process.cwd(),
    env: {...process.env, HOME: home, XDG_CONFIG_HOME: home, SHELL: '/bin/bash', XTERM_DEV_URL: '', ELECTRON_RUN_AS_NODE: ''},
  });
  const page = await application.firstWindow();
  await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1480, 940));
  await page.getByText('Session connected', {exact: true}).waitFor();
  const preferences = await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.sandbox, true);
  for (const cwd of [plain, other, empty, path.join(home, 'missing')]) {
    const result = await page.evaluate(cwd => window.desktop.gitInfo(cwd), cwd);
    assert.equal(result?.github || null, null);
  }
  await application.evaluate(({shell}) => {
    globalThis.githubExternalCalls = [];
    shell.openExternal = async url => {globalThis.githubExternalCalls.push(url);};
  });
  const terminalInput = page.locator('.xterm-helper-textarea').first();
  await terminalInput.pressSequentially(`cd -- '${nested}'`);
  await terminalInput.press('Enter');
  const alphaButton = page.getByRole('button', {name: 'Open test-owner/alpha on GitHub', exact: true});
  await alphaButton.waitFor();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', {name: 'Switch to dark mode', exact: true}).click();
    await page.waitForTimeout(200);
    await page.locator('.theme-toggle').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter');
    await page.screenshot({path: path.join(output, `native-${theme}.png`)});
  }
  assert.deepEqual(await application.evaluate(() => globalThis.githubExternalCalls),
    ['https://github.com/test-owner/alpha', 'https://github.com/test-owner/alpha']);
  await page.evaluate(() => window.desktop.openExternal('javascript:alert(1)'));
  assert.equal((await application.evaluate(() => globalThis.githubExternalCalls)).length, 2, 'External IPC rejects non-web schemes');
  await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('app:command', 'split'));
  await page.waitForFunction(() => document.querySelectorAll('.xterm-helper-textarea').length === 2);
  await page.waitForFunction(() => [...document.querySelectorAll('.terminal-pane')].every(element => element.querySelector('.shell-caption .live-dot')));
  const second = page.locator('.xterm-helper-textarea').nth(1);
  await second.pressSequentially(`cd -- '${beta}'`); await second.press('Enter');
  await page.getByRole('button', {name: 'Open test-owner/beta on GitHub', exact: true}).waitFor();
  await page.locator('.terminal-pane').first().click();
  await alphaButton.waitFor();
  await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('app:command', 'new-tab'));
  await page.waitForFunction(() => document.querySelectorAll('.xterm-helper-textarea').length === 3);
  await page.waitForFunction(() => [...document.querySelectorAll('.terminal-pane')].every(element => element.querySelector('.shell-caption .live-dot')));
  const third = page.locator('.xterm-helper-textarea').nth(2);
  await third.pressSequentially(`cd -- '${other}'`); await third.press('Enter');
  await page.locator('.github-link').waitFor({state: 'detached'});
  await page.getByRole('tab').first().click(); await alphaButton.waitFor();
  await terminalInput.pressSequentially(`cd -- '${plain}'`); await terminalInput.press('Enter');
  await page.locator('.github-link').waitFor({state: 'detached'});
  console.log('PASS native Linux Electron: real Git and bash PTY cwd, nested HTTPS/SSH repos, split panes, tabs, non-GitHub/plain/empty/missing folders, Light/Dark keyboard activation and sandboxed external IPC');
  console.log('shell.openExternal target was intercepted after the real IPC; no host default browser or macOS was launched.');
} finally {
  await application?.close();
  await rm(home, {recursive: true, force: true});
}
