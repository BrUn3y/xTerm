import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { RemoteMode } from '../electron/remote.cjs';
import { TerminalState } from '../electron/terminal-state.cjs';

const events = new EventEmitter();
const terminal = {id: 'fixture', cwd: '/workspace/example', shell: 'zsh'};
const writes = [];
terminal.screen = new TerminalState(84, 24, event => events.emit('screen', terminal.id, event), () => {});
const output = data => terminal.screen.enqueue({type: 'output', data});
const mode = new RemoteMode({
  sessions: {
    events,
    get: id => id === terminal.id ? terminal : undefined,
    setController: (id, client) => {
      terminal.controller = client;
      events.emit('metadata', id);
    },
    write: (_id, data) => {writes.push(data); return true;},
  },
  notify: () => {},
  assets: path.resolve('dist/remote'),
  power: {start: () => 1, stop: () => {}},
  setupOriginAllowed: /^http:\/\/127\.0\.0\.1:\d+$/,
  tunnel: port => ({connected: Promise.resolve(`http://127.0.0.1:${port}`), stop: () => {}}),
});
let browser;
try {
  output('\x1b[32mShared before pairing · café 日本語\x1b[0m\r\n\x1b[?2004h> ');
  const state = await mode.start({ids: [terminal.id], provider: 'cloudflare', permission: 'commands', hours: 1});
  assert.equal(state.status, 'active', state.message);
  browser = await chromium.launch();
  const page = await browser.newPage(devices['iPhone 14']);
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const button = name => page.getByRole('button', {name, exact: true});
  await page.goto(state.invitation.link);
  const screen = page.locator('.xterm-rows');
  await screen.getByText(/Shared before pairing/).waitFor();
  assert.equal(new URL(page.url()).hash, '');
  const dimensions = await page.locator('.mobile-terminal-scroll').evaluate(element => [element.clientWidth, element.scrollWidth]);
  assert.ok(dimensions[1] > dimensions[0], 'Keep canonical width and allow horizontal scrolling');
  await button('Take control').click();
  await button('Keyboard').click();
  await page.keyboard.insertText('é');
  await button('Paste').click();
  await page.getByRole('textbox', {name: 'Text to paste'}).fill('literal 日本語');
  await button('Send paste').click();
  await button('Enter').click();
  await button('Ctrl+C').click();
  await button('Up').click();
  await page.waitForFunction(() => document.body.innerText.includes('Keyboard control'));
  assert.deepEqual(writes, ['é', '\x1b[200~literal 日本語\x1b[201~', '\r', '\x03', '\x1b[A']);

  mode.access.client.ws.terminate();
  await page.getByText('Reconnecting', {exact: true}).waitFor();
  output('\r\nUpdated during reconnect');
  await screen.getByText(/Updated during reconnect/).waitFor();
  await button('Take control').waitFor();
  assert.equal(writes.length, 5);
  assert.equal(mode.state().expiresAt, state.expiresAt);
  await button('Disable Remote Mode').click();
  await page.getByText('Remote Mode disabled.', {exact: true}).waitFor();
  assert.equal(mode.state().status, 'disabled');
  assert.deepEqual(pageErrors, []);
  console.log('PASS mobile browser pairing, canonical terminal width, text composition, paste, touch keys, reconnection, and shutdown.');
} finally {
  mode.stop();
  terminal.screen.dispose();
  await browser?.close();
}
