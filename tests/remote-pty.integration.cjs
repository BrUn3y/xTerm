const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {mkdtemp, rm, writeFile} = require('node:fs/promises');
const {setTimeout: delay} = require('node:timers/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {createSessionManager} = require('../electron/sessions.cjs');
const {RemoteMode} = require('../electron/remote.cjs');

test('Remote Mode shutdown leaves native sessions and their local keyboard working', {
  skip: process.platform === 'win32', timeout: 10000,
}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xterm-remote-native-'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html>');
  const messages = new EventEmitter();
  const outputs = new Map();
  const sessions = createSessionManager({
    send(channel, event) {
      if (channel !== 'terminal:data') return;
      outputs.set(event.id, (outputs.get(event.id) ?? '') + event.data);
      messages.emit('output');
    },
    defaultCwd: () => directory,
    version: () => 'test',
  });
  const mode = new RemoteMode({
    sessions, notify: () => {}, assets: directory, power: {start: () => 1, stop: () => {}},
    tunnel: () => ({connected: Promise.resolve('https://native-fixture.trycloudflare.com'), stop: () => {}}),
  });
  t.after(async () => {
    mode.stop();
    sessions.destroyAll();
    await rm(directory, {recursive: true, force: true});
  });
  const output = (id, text) => new Promise(resolve => {
    const check = () => {
      if (!outputs.get(id)?.includes(text)) return;
      messages.off('output', check);
      resolve();
    };
    messages.on('output', check);
    check();
  });
  const shared = await sessions.create({id: 'shared', shell: '/bin/bash', cols: 80, rows: 25});
  const local = await sessions.create({id: 'local', shell: '/bin/bash', cols: 80, rows: 25});
  assert.equal(sessions.write(shared.id, "printf 'BEFORE_%s\\n' READY\r"), true);
  await output(shared.id, 'BEFORE_READY');
  const state = await mode.start({provider: 'cloudflare', ids: [shared.id], permission: 'commands', hours: 1});
  assert.deepEqual(state.ids, [shared.id]);
  let snapshot;
  while (!(snapshot = sessions.get(shared.id).screen.snapshot()) || !snapshot.data.includes('BEFORE_READY')) await delay(5);

  const remoteController = {};
  sessions.setController(shared.id, remoteController);
  assert.equal(sessions.write(shared.id, 'ignored'), false);
  assert.equal(sessions.write(shared.id, "printf 'REMOTE_%s\\n' WORKS\r", remoteController), true);
  assert.equal(sessions.write(local.id, 'out of scope', remoteController), false);
  await output(shared.id, 'REMOTE_WORKS');
  sessions.setController(shared.id, null);
  mode.stop();
  assert.equal(sessions.get(shared.id).process.pid, shared.pid);
  assert.equal(sessions.get(local.id).process.pid, local.pid);
  assert.equal(sessions.write(shared.id, "printf 'AFTER_%s\\n' READY\r"), true);
  await output(shared.id, 'AFTER_READY');
});
