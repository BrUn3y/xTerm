import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {_electron} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {quote} = require('../electron/shell.cjs');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/ssh-desktop';
await fs.mkdir(output, {recursive: true});
const directory = await fs.mkdtemp(path.join(process.getuid() === 0 ? '/root' : os.userInfo().homedir, '.xterm-ssh-desktop-'));
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const key = path.join(directory, 'client'), hostKey = path.join(directory, 'host');
const config = path.join(directory, 'client.conf');
const username = os.userInfo().username;
let app, server, serverLog = '';
try {
  await exec('ssh-keygen', ['-q','-t','ed25519','-N','','-f',key]);
  await exec('ssh-keygen', ['-q','-t','ed25519','-N','','-f',hostKey]);
  await fs.writeFile(path.join(directory, 'authorized_keys'), await fs.readFile(key + '.pub'), {mode: 0o600});
  await fs.writeFile(path.join(directory, 'known_hosts'), `[127.0.0.1]:${port} ${await fs.readFile(hostKey + '.pub', 'utf8')}`);
  const serverConfig = path.join(directory, 'sshd.conf');
  await fs.writeFile(serverConfig, [
    `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${hostKey}`, `PidFile ${directory}/sshd.pid`,
    `AuthorizedKeysFile ${directory}/authorized_keys`, 'PasswordAuthentication no', 'KbdInteractiveAuthentication no',
    'PubkeyAuthentication yes', 'PermitRootLogin prohibit-password', 'UsePAM no', 'StrictModes yes', 'LogLevel VERBOSE',
  ].join('\n'));
  await fs.writeFile(config, [
    'Host controlled-alias', ' HostName 127.0.0.1', ` User ${username}`, ` Port ${port}`,
    ` IdentityFile ${key}`, ' IdentitiesOnly yes', ' BatchMode yes', ' StrictHostKeyChecking yes',
    ` UserKnownHostsFile ${directory}/known_hosts`, ' GlobalKnownHostsFile /dev/null',
  ].join('\n'));
  server = spawn('/usr/sbin/sshd', ['-D','-e','-f',serverConfig], {stdio: ['ignore','ignore','pipe']});
  server.stderr.on('data', data => {serverLog += data;});
  const deadline = Date.now() + 5000;
  while (!serverLog.includes('Server listening')) {
    if (Date.now() > deadline) throw new Error('Controlled server did not start');
    await delay(40);
  }
  const env = {...process.env, HOME: directory, SHELL: '/bin/bash', XTERM_START_HIDDEN: '1', XDG_CONFIG_HOME: directory + '/config'};
  delete env.ELECTRON_RUN_AS_NODE; delete env.XTERM_DEV_URL;
  app = await _electron.launch({executablePath: require('electron'), args: ['--no-sandbox', '.'], env});
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('Session connected', {exact: true}).waitFor();
  await page.waitForTimeout(300);
  const card = page.getByRole('region', {name: 'SSH connection', exact: true});
  const initialCwd = await page.locator('.breadcrumb').textContent();
  const remote = `printf '\\033]777;xterm-agent;{"name":"Remote Harness","model":"local/test","status":"ready"}\\007'; printf '\\033]7;file://remote/tmp\\007\\033]133;A\\007'; printf 'REMOTE_READY\\n'; read answer`;
  await page.locator('textarea.xterm-helper-textarea').first().focus();
  await page.keyboard.insertText(`ssh -F ${quote(config)} controlled-alias ${quote(remote)}`);
  await page.keyboard.press('Enter');
  await card.getByRole('heading', {name: 'controlled-alias', exact: true}).waitFor();
  await card.getByText('Remote Harness', {exact: true}).waitFor();
  await page.waitForTimeout(1300);
  assert.equal(await card.getByRole('status').textContent(), 'Unknown');
  assert.equal(await card.locator('dt', {hasText: 'Destination IP'}).evaluate(element => element.nextElementSibling.textContent), `127.0.0.1:${port}`);
  assert.equal(await card.locator('dt', {hasText: 'Remote hostname'}).evaluate(element => element.nextElementSibling.textContent), 'Not reported');
  assert.equal(await page.locator('.breadcrumb').textContent(), initialCwd, 'Remote OSC cwd cannot change local file context');
  assert.match(serverLog, /Accepted publickey/, 'Server, not process existence, proves test authentication');
  for (const theme of ['light','dark']) {
    if (theme === 'dark') await page.getByRole('button', {name: 'Switch to dark mode', exact: true}).click();
    await page.screenshot({path: path.join(output, `${theme}.png`)});
  }
  await page.getByRole('button', {name: 'Split pane (⌘ D). Click again to change orientation.', exact: true}).click();
  await page.locator('.terminal-pane').nth(1).locator('textarea.xterm-helper-textarea').waitFor();
  await page.waitForTimeout(200);
  await card.waitFor({state: 'detached'});
  await page.locator('.terminal-pane').first().click();
  await card.getByRole('heading', {name: 'controlled-alias', exact: true}).waitFor();
  await card.getByText('Remote Harness', {exact: true}).waitFor();
  await page.locator('textarea.xterm-helper-textarea').first().focus();
  await page.keyboard.insertText('done');
  await page.keyboard.press('Enter');
  await card.waitFor({state: 'detached'});
  await page.locator('.poster').waitFor();
  // Authentication failure must return to the local card, not retain an endpoint.
  await page.keyboard.insertText(`ssh -F ${quote(config)} -l xterm_nonexistent_test_user controlled-alias`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1600);
  await page.locator('.poster').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS native Electron/Linux: controlled SSH alias, PID-owned endpoint, Unknown auth, remote OSC isolation, harness coexistence, Light/Dark, active split pane, normal exit and auth-failure cleanup.');
} catch (error) {
  console.error('Controlled server log:', serverLog);
  throw error;
} finally {
  if (app) await app.close();
  if (server) {server.kill('SIGTERM'); await delay(150);}
  await fs.rm(directory, {recursive: true, force: true, maxRetries: 4, retryDelay: 50});
}
