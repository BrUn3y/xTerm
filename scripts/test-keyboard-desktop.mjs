import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
const home = await mkdtemp(path.join(os.tmpdir(), 'xterm-keyboard-desktop-'));
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/keyboard-desktop';
const legacy = process.env.XTERM_EXPECT_LEGACY === '1';
const shell = process.env.XTERM_TEST_SHELL || '/bin/bash';
await mkdir(output, {recursive: true});
let application;
const errors = [];
let provider;
try {
  application = await electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'], cwd: process.cwd(),
    env: {...process.env, HOME: home, XDG_CONFIG_HOME: home, SHELL: shell, XTERM_DEV_URL: '', ELECTRON_RUN_AS_NODE: ''},
  });
  const page = await application.firstWindow();
  await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1480, 940));
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('Session connected', {exact: true}).waitFor();
  await application.evaluate(({ipcMain}) => {
    globalThis.keyboardWrites = [];
    // Observe the real IPC alongside its existing PTY handler; do not replace it.
    ipcMain.on('terminal:write', (_event, payload) => globalThis.keyboardWrites.push(payload));
  });
  await page.evaluate(() => {
    window.keyboardOutput = [];
    window.desktop.onData(event => window.keyboardOutput.push(event));
  });
  const writes = () => application.evaluate(() => globalThis.keyboardWrites);
  const clear = () => application.evaluate(() => {globalThis.keyboardWrites = [];});
  const data = () => page.evaluate(() => window.keyboardOutput.map(event => event.data).join(''));
  const untilOutput = text => page.waitForFunction(text => window.keyboardOutput.map(event => event.data).join('').includes(text), text);
  const input = page.locator('.xterm-helper-textarea').first();
  const command = async text => {await input.pressSequentially(text); await input.press('Enter');};
  const press = async (keys, expected) => {
    await clear();
    await input.press(keys);
    await page.waitForTimeout(100);
    assert.equal((await writes()).map(event => event.data).join(''), expected, keys);
  };
  const fixture = fileURLToPath(new URL('../tests/fixtures/keyboard-probe.cjs', import.meta.url));
  const probe = async flags => {
    await page.evaluate(() => {window.keyboardOutput = [];});
    await command(`node '${fixture}' ${flags}`);
    await untilOutput('PROBE_READY');
    await page.waitForTimeout(120);
  };
  const stopProbe = async () => {
    // Raw fixture exit via the real bridge, not a model-backed process.
    const id = (await writes()).at(-1).id;
    await page.evaluate(id => window.desktop.write(id, '\x03'), id);
    await page.waitForTimeout(150);
  };
  await press('Enter', '\r');
  await press('Shift+Enter', '\r');
  await command("printf 'SHELL_%s\\n' OK");
  await untilOutput('SHELL_OK\r\n');
  await command('sleep 30'); await input.press('Control+c');
  await command("printf 'INTERRUPT_%s\\n' OK"); await untilOutput('INTERRUPT_OK\r\n');
  if (process.env.XTERM_TEST_APPS === '1') {
    const editedFile = path.join(home, 'vim-keyboard.txt');
    await command(`vim.tiny -N -u NONE -n '${editedFile}'`);
    await page.waitForTimeout(300);
    await input.press('i'); await input.pressSequentially('vim_first');
    await input.press('Shift+Enter'); await input.pressSequentially('vim_second');
    await input.press('ArrowUp'); await page.waitForTimeout(100);
    await input.press('End'); await page.waitForTimeout(100);
    await input.pressSequentially('_edited');
    await input.press('Escape'); await input.pressSequentially(':wq'); await input.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(await readFile(editedFile, 'utf8'), 'vim_first_edited\nvim_second\n', 'Real Vim editing, arrows and Shift+Enter preserve legacy behavior');
    await command('top -d 1'); await page.waitForTimeout(400);
    await input.pressSequentially('q'); await page.waitForTimeout(200);
    await command("printf 'APP_RETURN_%s\\n' OK"); await untilOutput('APP_RETURN_OK\r\n');
    console.log(`PASS real ${shell}, Vim tiny and top interactive editing/exit`);
  }
  await probe(1);
  assert.equal((await writes()).some(event => event.data === '\x1b[?1u'), !legacy, 'Negotiation reply through real IPC');
  await press('Shift+Enter', legacy ? '\r' : '\x1b[13;2u');
  await untilOutput(legacy ? 'BYTES:0d' : 'BYTES:1b5b31333b3275');
  await press('Enter', '\r');
  await press('Control+c', legacy ? '\x03' : '\x1b[99;5u');
  await stopProbe();
  await press('Shift+Enter', '\r');

  if (!legacy) {
    for (const [mode, expected] of [
      ['nested', '\x1b[13;2u'], ['cleared', '\r'], ['set', '\x1b[13;2u'],
      ['unset', '\r'], ['alternate', '\r'], ['restored', '\x1b[13;2u'], ['reset', '\r'],
    ]) {
      await probe(mode);
      await press('Shift+Enter', expected);
      await stopProbe();
    }
    if (process.env.XTERM_TEST_STACK_RESTORE === '1') {
      await probe('restoreSet');
      await press('Shift+Enter', '\x1b[13;2u');
      await stopProbe();
    }
    await probe(11);
    await press('Enter', '\x1b[13u\x1b[13;1:3u');
    await press('Shift+Enter', '\x1b[57441;2u\x1b[13;2u\x1b[13;2:3u\x1b[57441;1:3u');
    await clear();
    await input.press('Control+Shift+f');
    await page.waitForTimeout(100);
    assert.ok(!(await writes()).some(event => event.data.includes('[102;')), 'Reserved app shortcut must not leak a key release');
    await stopProbe();
    await press('Enter', '\r');
    await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('app:command', 'split'));
    await page.waitForFunction(() => document.querySelectorAll('.xterm-helper-textarea').length === 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.terminal-pane')].every(element => element.querySelector('.shell-caption .live-dot')));
    await probe(1);
    const firstId = (await writes()).at(-1).id;
    const second = page.locator('.xterm-helper-textarea').nth(1);
    await clear(); await second.press('Shift+Enter'); await page.waitForTimeout(100);
    assert.equal((await writes()).length, 1);
    assert.equal((await writes())[0].data, '\r');
    assert.notEqual((await writes())[0].id, firstId);
    await press('Shift+Enter', '\x1b[13;2u');
    assert.equal((await writes())[0].id, firstId);
    await stopProbe();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', {name: 'Switch to dark mode', exact: true}).click();
      await page.screenshot({path: path.join(output, `native-${theme}.png`)});
    }
    await press('Control+Shift+f', '');
    await page.locator('button[title="Search terminal (\u2318 F)"]').click();
    await page.getByRole('textbox', {name: 'Search terminal', exact: true}).waitFor({timeout: 2000});
    await page.keyboard.press('Escape');
  }
  console.log(`PASS ${legacy ? 'baseline' : 'fixed'} native Electron: real IPC/PTYS, legacy ${shell} input, Ctrl+C, negotiated keys${legacy ? '' : ', all-key press/release and independent panes'}`);

  if (process.env.XTERM_TEST_CODEX === '1') {
    const codexHome = path.join(home, 'codex');
    const workspace = path.join(home, 'empty-workspace');
    await mkdir(codexHome);
    await mkdir(workspace);
    const requests = [];
    provider = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push({url: request.url, body: body ? JSON.parse(body) : null});
      response.writeHead(400, {'content-type': 'application/json'});
      response.end(JSON.stringify({error: {message: 'Intentional keyboard validation rejection: no model executes', type: 'invalid_request_error'}}));
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    await writeFile(path.join(codexHome, 'config.toml'), [
      'model = "keyboard-test"', 'model_provider = "keyboard-test"',
      '[model_providers.keyboard-test]', 'name = "Local keyboard validation (no model)"',
      `base_url = "http://127.0.0.1:${provider.address().port}/v1"`, 'wire_api = "responses"', 'requires_openai_auth = false',
      'request_max_retries = 0', 'stream_max_retries = 0',
      `[projects.${JSON.stringify(workspace)}]`, 'trust_level = "trusted"', '',
    ].join('\n'));
    const {stdout: version} = await exec('codex', ['--version']);
    await page.evaluate(() => {window.keyboardOutput = [];});
    await command(`CODEX_HOME='${codexHome}' codex --no-daemon --no-alt-screen -s read-only -C '${workspace}'`);
    await page.waitForTimeout(4000);
    await writeFile(path.join(output, 'codex-startup.txt'), await data());
    await page.screenshot({path: path.join(output, 'codex-startup.png')});
    const rows = () => page.locator('.terminal-pane').first().locator('.xterm-rows > div').allTextContents();
    const first = 'keyboard_first_20261124';
    const second = 'keyboard_second_20261124';
    await input.pressSequentially(first, {delay: 25});
    await input.press('Shift+Enter');
    await page.waitForTimeout(600);
    await input.pressSequentially(second, {delay: 25});
    await page.waitForTimeout(600);
    const composed = await rows();
    await writeFile(path.join(output, 'codex-composer.json'), JSON.stringify({version: version.trim(), legacy, rows: composed, requestsBeforeEnter: requests}, null, 2));
    await page.screenshot({path: path.join(output, 'codex-composer.png')});
    if (legacy) {
      assert.ok(requests.some(request => JSON.stringify(request.body).includes(first)), 'Baseline Shift+Enter submitted the first line');
      console.log(`REPRODUCED ${version.trim()}: baseline Shift+Enter submits first line to loopback rejection server.`);
    } else {
      assert.equal(requests.length, 0, 'Shift+Enter must not submit a model request');
      const index = composed.findIndex(row => row.includes(first));
      assert.ok(index >= 0 && composed[index + 1]?.includes(second), 'Real Codex composer contains adjacent distinct lines');
      await input.press('Backspace'); await input.pressSequentially('4', {delay: 25});
      await input.press('ArrowUp'); await input.press('End');
      await input.pressSequentially('_edited', {delay: 25});
      await page.waitForTimeout(300);
      const edited = await rows();
      assert.ok(edited.some(row => row.includes(first + '_edited')), 'First line remains editable');
      assert.ok(edited.some(row => row.includes(second)), 'Second line remains intact');
      await page.screenshot({path: path.join(output, 'codex-edited.png')});
      await input.press('Enter');
      const deadline = Date.now() + 10000;
      while (!requests.some(request => JSON.stringify(request.body).includes(first))) {
        if (Date.now() > deadline) throw new Error('Enter did not submit Codex input to the controlled loopback server');
        await page.waitForTimeout(50);
      }
      assert.ok(requests.some(request => JSON.stringify(request.body).includes(`${first}_edited\\n${second}`)), 'Enter submits both edited lines in one request');
      await writeFile(path.join(output, 'codex-submission.json'), JSON.stringify(requests, null, 2));
      console.log(`PASS real ${version.trim()} composer: Shift+Enter inserts newline without request, both lines editable, Enter submits edited multiline input to loopback rejection server. No model executed.`);
    }
  }
  assert.deepEqual(errors, []);
  const pkg = JSON.parse(await readFile('node_modules/@xterm/xterm/package.json', 'utf8'));
  console.log(`Environment: xTerm 0.4.0, xterm.js ${pkg.version}, ${os.type()} ${os.release()} ${os.arch()}`);
} finally {
  await application?.close();
  if (provider) await new Promise(resolve => provider.close(resolve));
  await rm(home, {recursive: true, force: true});
}
