const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createSessionManager} = require('../electron/sessions.cjs');
const {quote} = require('../electron/shell.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 6000;
  while (!await check()) { if (Date.now() > deadline) throw new Error(message); await delay(40); }
}

test('session manager publishes foreground harness metadata through a real PTY', {skip: !fs.existsSync('/bin/zsh'), timeout: 15000}, async t => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xterm-agent-pty-')));
  const originalZdotdir = process.env.ZDOTDIR;
  process.env.ZDOTDIR = home;
  let agent, exitCode;
  const sessions = createSessionManager({
    defaultCwd: () => home,
    version: () => 'test',
    send(channel, event) {
      if (event.id !== 'foreground') return;
      if (channel === 'terminal:agent') agent = event.agent;
      if (channel === 'terminal:exit') exitCode = event.exitCode;
    },
  });
  t.after(() => {
    sessions.destroyAll();
    if (originalZdotdir === undefined) delete process.env.ZDOTDIR;
    else process.env.ZDOTDIR = originalZdotdir;
    fs.rmSync(home, {recursive: true, force: true, maxRetries: 4, retryDelay: 25});
  });

  const fixture = path.join(home, 'codex.cjs');
  fs.writeFileSync(path.join(home, '.zshrc'), 'unset HISTFILE\n');
  fs.writeFileSync(fixture, `
process.stdout.write('\\x1b[33mGPT-6.1-Sol\\x1b[0m high · ~\\nWaiting for input\\n');
process.stdin.resume();
process.stdin.on('data', () => { process.stdout.write('Task completed\\n'); });
setInterval(() => {}, 1000);
`);
  const {id} = await sessions.create({id: 'foreground', shell: '/bin/zsh'});
  await until(() => sessions.get(id)?.atPrompt, 'Shell did not become ready');
  sessions.write(id, `node ${quote(fixture)} --model local/launch-model\r`);
  await until(async () => {
    await sessions.refreshAgents();
    return agent?.model === 'GPT-6.1-Sol' && agent.status === 'ready';
  }, 'Live harness model and ready status were not published');
  assert.equal(agent.provider, 'codex');
  assert.equal(agent.modelSource, 'reported');

  sessions.write(id, 'work\r');
  assert.equal(agent.status, 'working');
  await until(() => agent?.status === 'ready', 'Harness completion was not reported');
  sessions.write(id, '\x03');
  await until(() => agent === null, 'Agent card was not cleared after returning to the shell');
  sessions.write(id, 'exit 0\r');
  await until(() => exitCode !== undefined, 'Shell did not exit');
  assert.equal(exitCode, 0);
});
