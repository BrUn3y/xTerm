import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const home = await mkdtemp(path.join(os.tmpdir(), 'xterm-clipboard-'));
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/clipboard-desktop';
const baseline = process.env.XTERM_EXPECT_CLIPBOARD_BUG === '1';
await mkdir(output, {recursive: true});
let application;
const errors = [];
try {
  application = await electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'],
    cwd: process.env.XTERM_TEST_APP_ROOT || process.cwd(),
    env: {...process.env, HOME: home, XDG_CONFIG_HOME: home, SHELL: '/bin/bash', XTERM_DEV_URL: '', ELECTRON_RUN_AS_NODE: ''},
  });
  const page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('Session connected', {exact: true}).waitFor();
  await application.evaluate(({ipcMain}) => {
    globalThis.clipboardWrites = [];
    ipcMain.on('terminal:write', (_event, payload) => globalThis.clipboardWrites.push(payload));
  });
  await page.evaluate(() => {
    window.clipboardOutput = [];
    window.desktop.onData(event => window.clipboardOutput.push(event));
  });
  const input = page.locator('.xterm-helper-textarea').first();
  const writes = () => application.evaluate(() => globalThis.clipboardWrites);
  const clear = () => application.evaluate(() => {globalThis.clipboardWrites = [];});
  const textClipboard = text => application.evaluate(({clipboard}, text) => clipboard.writeText(text), text);
  const untilOutput = text => page.waitForFunction(text =>
    window.clipboardOutput.map(event => event.data).join('').includes(text), text);
  const command = async text => {await input.pressSequentially(text); await input.press('Enter');};
  const fixture = fileURLToPath(new URL('../tests/fixtures/keyboard-probe.cjs', import.meta.url));
  const startProbe = async mode => {
    await page.evaluate(() => {window.clipboardOutput = [];});
    await command(`node '${fixture}' ${mode}`);
    await untilOutput('PROBE_READY');
    await page.waitForTimeout(150);
    await clear();
  };
  const stopProbe = async () => {
    const id = (await writes()).at(-1).id;
    await page.evaluate(id => window.desktop.write(id, '\x03'), id);
    await page.waitForTimeout(150);
  };
  // All-key mode may report modifier-only events. Never discard V events.
  const bytes = async () => (await writes()).map(event => event.data).join('')
    .replace(/\x1b\[574(?:4[1-9]|50)(?:;[0-9:]+)?u/g, '');
  const paste = async (keys, text) => {
    await textClipboard(text);
    await clear();
    await input.press(keys);
    await page.waitForTimeout(250);
  };
  const bracketed = text => `\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`;

  await startProbe('paste1');
  await paste('Control+Shift+v', 'clipboard_plain_text');
  if (baseline) {
    assert.match(await bytes(), /\x1b\[118;6u/, 'Baseline leaks Ctrl+Shift+V to the harness');
    assert.ok(!(await bytes()).includes('clipboard_plain_text'), 'Baseline does not paste copied text');
    console.log('REPRODUCED baseline: Ctrl+Shift+V emits a Kitty V shortcut instead of clipboard text.');
  } else {
    assert.equal(await bytes(), bracketed('clipboard_plain_text'));
    await untilOutput(`BYTES:${Buffer.from(bracketed('clipboard_plain_text')).toString('hex')}`);
    await stopProbe();
    for (const mode of ['paste0', 'paste1', 'paste11']) {
      await startProbe(mode);
      for (const keys of ['Control+Shift+v', 'Meta+v', 'Meta+Shift+v']) {
        for (const text of ['plain text', 'first line\r\nsecond line\nthird line', 'Espa\u00f1ol \u2713 \u65e5\u672c\u8a9e']) {
          await paste(keys, text);
          assert.equal(await bytes(), bracketed(text), `${mode} ${keys}: exactly one bracketed text paste`);
        }
      }
      await paste('Control+v', 'must_not_be_pasted');
      assert.ok(!(await bytes()).includes('must_not_be_pasted'), 'Ctrl+V remains a process key');
      assert.ok((await bytes()).includes(mode === 'paste0' ? '\x16' : '\x1b[118;5u'));
      await paste('Control+Shift+v', '');
      assert.equal(await bytes(), '', 'Empty clipboard sends no text or V shortcut');
      await application.evaluate(({clipboard, nativeImage}) => {
        clipboard.write({image: nativeImage.createFromDataURL(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V0AAAAASUVORK5CYII=',
        )});
      });
      await clear();
      await input.press('Control+Shift+v');
      await page.waitForTimeout(250);
      assert.equal(await bytes(), '', 'Image-only clipboard must not become a text-paste shortcut');
      await textClipboard('native_menu_paste');
      await clear();
      await input.focus();
      await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.paste());
      await page.waitForTimeout(250);
      assert.equal(await bytes(), bracketed('native_menu_paste'), 'Native Edit > Paste still uses the DOM paste path');
      await stopProbe();
    }
    await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('app:command', 'split'));
    await page.waitForFunction(() => document.querySelectorAll('.xterm-helper-textarea').length === 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.terminal-pane')]
      .every(element => element.querySelector('.shell-caption .live-dot')));
    await startProbe('paste1');
    await paste('Control+Shift+v', 'first_pane');
    const firstId = (await writes()).find(event => event.data.includes('first_pane')).id;
    await textClipboard('second_pane');
    await clear();
    await page.locator('.xterm-helper-textarea').nth(1).press('Control+Shift+v');
    await page.waitForTimeout(250);
    assert.equal((await writes()).length, 1);
    assert.notEqual((await writes())[0].id, firstId, 'Paste is scoped to the focused pane');
    assert.ok((await writes())[0].data.includes('second_pane'));
    await paste('Control+Shift+v', 'first_pane_again');
    assert.equal((await writes())[0].id, firstId);
    await application.evaluate(({ipcMain, clipboard}) => {
      ipcMain.removeHandler('clipboard:read-text');
      ipcMain.handle('clipboard:read-text', () => {
        const text = clipboard.readText();
        return new Promise(resolve => setTimeout(() => resolve(text), 300));
      });
    });
    await textClipboard('late_paste_must_not_cross_panes');
    await clear();
    await input.press('Control+Shift+v');
    await page.locator('.xterm-helper-textarea').nth(1).focus();
    await page.waitForTimeout(450);
    assert.equal((await writes()).length, 0, 'A delayed clipboard result cannot paste after focus moves');
    await application.evaluate(({ipcMain, clipboard}) => {
      ipcMain.removeHandler('clipboard:read-text');
      ipcMain.handle('clipboard:read-text', () => clipboard.readText());
    });
    await paste('Control+Shift+v', 'first_pane_after_focus');
    await stopProbe();
    await application.evaluate(({ipcMain}) => {
      ipcMain.removeHandler('clipboard:read-text');
      ipcMain.handle('clipboard:read-text', () => {throw new Error('Controlled clipboard read failure');});
    });
    await clear();
    await input.press('Control+Shift+v');
    await page.getByText('Could not read clipboard text.', {exact: true}).waitFor();
    assert.equal((await writes()).length, 0, 'Read failure must not fall back to a harness V shortcut');
    await page.getByRole('button', {name: 'Dismiss drop message'}).click();
    await application.evaluate(({ipcMain, clipboard}) => {
      ipcMain.removeHandler('clipboard:read-text');
      ipcMain.handle('clipboard:read-text', () => clipboard.readText());
    });
    await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('app:command', 'search'));
    const search = page.getByRole('textbox', {name: 'Search terminal', exact: true});
    await search.waitFor();
    await search.focus();
    await textClipboard('native_field');
    await clear();
    await search.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
    await page.waitForTimeout(250);
    assert.equal(await search.inputValue(), 'native_field', 'Text fields retain native paste');
    assert.equal((await writes()).length, 0, 'Text-field paste does not write to a terminal');
    await page.keyboard.press('Escape');
    await page.screenshot({path: path.join(output, 'clipboard-desktop.png')});
    console.log('PASS real Electron clipboard/IPC/PTY: text, multiline, Unicode, empty/image-only, native paste, process Ctrl+V, Kitty press/release, independent panes, delayed/failing reads and text fields.');
  }
  assert.deepEqual(errors, []);
} finally {
  await application?.close();
  await rm(home, {recursive: true, force: true});
}
