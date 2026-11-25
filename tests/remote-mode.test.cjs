const assert = require('node:assert/strict');
const {EventEmitter, once} = require('node:events');
const {mkdtemp, rm, writeFile} = require('node:fs/promises');
const {setTimeout: delay} = require('node:timers/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {Terminal} = require('@xterm/headless');
const {WebSocket} = require('ws');
const {AccessDeadline, RemoteAuth} = require('../electron/remote-auth.cjs');
const {RemoteMode} = require('../electron/remote.cjs');
const {TerminalState} = require('../electron/terminal-state.cjs');
const {startCloudflare} = require('../electron/tunnels/cloudflare.cjs');

const HOUR = 3600000;
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
const visible = terminal => {
  const buffer = terminal.buffer.active;
  return Array.from({length: terminal.rows}, (_, index) => buffer.getLine(buffer.baseY + index)?.translateToString(true));
};

test('invites expire independently, rotate, and are consumed once without extending access', () => {
  let now = 0;
  const deadline = new AccessDeadline(5, () => now, () => now);
  const auth = new RemoteAuth(deadline);
  const origin = 'https://example.trycloudflare.com';
  const token = () => new URLSearchParams(new URL(auth.invitation.link).hash.slice(1)).get('pair');
  auth.invite(origin);
  const original = token();
  auth.invite(origin);
  assert.equal(auth.pair(original, 'Phone'), null);
  const expired = token();
  now += 300_000;
  assert.equal(auth.pair(expired, 'Phone'), null);
  auth.invite(origin);
  const fresh = token();
  assert.match(fresh, /^[\w-]{43}$/);
  const cookie = auth.pair(fresh, 'Phone');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(auth.authorize(cookie.split(';')[0]), true);
  assert.equal(auth.authorize(`${cookie.split(';')[0]}; ${cookie.split(';')[0]}`), false);
  assert.equal(auth.pair(fresh, 'Second phone'), null);
  assert.throws(() => auth.invite(origin));
  auth.revoke();
  assert.equal(auth.authorize(cookie), false);
  now = 5 * HOUR - 2000;
  auth.invite(origin);
  assert.equal(auth.invitation.expiresAt, 5 * HOUR);
  now += 2000;
  assert.equal(auth.availableInvitation(), null);
});

test('elapsed time expires across suspension and clock jumps fail closed', () => {
  let wall = 1_000_000;
  let elapsed = 15_000;
  assert.throws(() => new AccessDeadline(5.1));
  assert.throws(() => new AccessDeadline(0));
  const deadline = new AccessDeadline(1, () => wall, () => elapsed);
  wall += HOUR - 30;
  elapsed += HOUR - 30;
  assert.equal(deadline.remaining(), 30);
  wall += 30;
  elapsed += 30;
  assert.equal(deadline.remaining(), 0);
  const adjusted = new AccessDeadline(5, () => wall, () => elapsed);
  wall -= 100_000;
  elapsed += 1;
  assert.equal(adjusted.remaining(), 0);
});

test('screen snapshots preserve existing normal and alternate buffers, Unicode, modes and ordered output', async () => {
  const updates = new EventEmitter();
  const screen = new TerminalState(18, 5, event => updates.emit('next', event), () => {});
  const client = new Terminal({cols: 18, rows: 5, allowProposedApi: true, vtExtensions: {kittyKeyboard: true}});
  try {
    const input = async data => {
      const event = once(updates, 'next');
      screen.enqueue({type: 'output', data});
      return (await event)[0];
    };
    await input('past output\r\nλ 日本語\r\n\x1b[32mANSI\x1b[0m');
    await input('\x1b[?1049h\x1b[?1h\x1b[?2004h\x1b[>1uTUI\x1b[3;5H');
    await input('\x1b[');
    assert.equal(screen.snapshot(), null);
    await input('1m🙂');
    const snapshot = screen.snapshot();
    await write(client, snapshot.data);
    assert.equal(client.buffer.active.type, 'alternate');
    assert.deepEqual(visible(client), visible(screen.terminal));
    assert.equal(client.buffer.active.cursorX, screen.terminal.buffer.active.cursorX);
    assert.equal(client.modes.applicationCursorKeysMode, true);
    assert.equal(client.modes.bracketedPasteMode, true);
    assert.equal(client._core.coreService.kittyKeyboard.flags, 1);
    const output = await input('\x1b[?1049l\r\nreturned');
    assert.equal(output.sequence, snapshot.sequence + 1);
    await write(client, output.data);
    assert.deepEqual(visible(client), visible(screen.terminal));
  } finally {
    screen.dispose();
    client.dispose();
  }
});

async function fixture(t, provider) {
  const assets = await mkdtemp(path.join(os.tmpdir(), 'xterm-remote-test-'));
  await writeFile(path.join(assets, 'index.html'), '<!doctype html><title>Remote fixture</title>');
  const events = new EventEmitter();
  const writes = [];
  const blockers = new Set();
  const shared = {id: 'shared', cwd: '/sandbox/shared', shell: 'bash'};
  const unshared = {id: 'private', cwd: '/sandbox/private', shell: 'zsh'};
  const terminals = new Map([[shared.id, shared], [unshared.id, unshared]]);
  shared.screen = new TerminalState(40, 10, event => events.emit('screen', shared.id, event), () => {});
  const output = data => shared.screen.enqueue({type: 'output', data});
  let now = 0;
  let stops = 0;
  let port;
  let failure;
  const mode = new RemoteMode({
    assets, notify: () => {},
    power: {start: () => {blockers.add(1); return 1;}, stop: id => blockers.delete(id)},
    sessions: {
      events, get: id => terminals.get(id),
      setController: (id, client) => {terminals.get(id).controller = client; events.emit('metadata', id);},
      write: (id, data) => {writes.push([id, data]); return true;},
    },
    clock: {wall: () => now, elapsed: () => now},
    setupOriginAllowed: /^http:\/\/127\.0\.0\.1:\d+$/,
    tunnel: (listenPort, onFailure) => {
      port = listenPort;
      failure = onFailure;
      return {connected: provider ? provider() : Promise.resolve(`http://127.0.0.1:${port}`), stop: () => {stops++;}};
    },
  });
  t.after(async () => {
    mode.stop();
    shared.screen.dispose();
    await rm(assets, {recursive: true, force: true});
  });
  return {mode, output, writes, blockers, shared, unshared,
    stops: () => stops, advance: value => {now += value;}, port: () => port, fail: reason => failure(reason)};
}

async function pair(origin, link, originHeader = origin) {
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('pair');
  return fetch(origin + '/api/pair', {
    method: 'POST', headers: {'Content-Type': 'application/json', Origin: originHeader},
    body: JSON.stringify({token}),
  });
}

async function connect(t, origin, cookie) {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/socket', {origin, headers: {Cookie: cookie}});
  let buffer = [];
  let wake;
  socket.on('message', raw => {
    buffer.push(JSON.parse(raw.toString()));
    wake?.();
  });
  t.after(() => socket.terminate());
  await once(socket, 'open');
  return {
    socket,
    send: (type, id, data) => socket.send(JSON.stringify({type, id, data, subscription: 1})),
    async next(type) {
      const index = () => buffer.findIndex(event => event.type === type);
      while (index() < 0) await new Promise(resolve => {wake = resolve;});
      const event = buffer[index()];
      buffer = buffer.slice(index() + 1);
      return event;
    },
  };
}

test('loopback auth, session isolation, input ownership, reconnection and mandatory expiration', {timeout: 8000}, async t => {
  const f = await fixture(t);
  f.output('existing output\r\n');
  const activated = await f.mode.start({provider: 'cloudflare', ids: ['shared'], permission: 'commands', hours: 1});
  const origin = new URL(activated.invitation.link).origin;
  assert.deepEqual(f.blockers, new Set([1]));
  assert.equal((await fetch(origin + '/api/state')).status, 401);
  const html = await fetch(origin);
  assert.equal(html.headers.get('Cache-Control'), 'no-store');
  assert.match(html.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(origin + '/electron/main.cjs')).status, 404);
  assert.equal((await pair(origin, activated.invitation.link, 'https://other.example')).status, 403);
  const exchange = await pair(origin, activated.invitation.link);
  assert.equal(exchange.status, 204);
  const cookie = exchange.headers.get('set-cookie').split(';')[0];
  assert.equal((await pair(origin, activated.invitation.link)).status, 403);
  assert.equal(f.mode.state().invitation, null);
  const state = await fetch(origin + '/api/state', {headers: {Cookie: cookie}}).then(result => result.json());
  assert.deepEqual(state.sessions.map(session => session.id), ['shared']);
  const rejected = new WebSocket(origin.replace('http:', 'ws:') + '/api/socket', {origin: 'https://other.example', headers: {Cookie: cookie}});
  const [, response] = await once(rejected, 'unexpected-response');
  assert.equal(response.statusCode, 403);
  rejected.close();
  rejected.on('error', () => {});

  const phone = await connect(t, origin, cookie);
  await phone.next('state');
  phone.send('attach', 'private');
  phone.send('input', 'private', 'unshared');
  phone.send('attach', 'shared');
  const snapshot = await phone.next('snapshot');
  assert.equal(snapshot.id, 'shared');
  assert.match(snapshot.data, /existing output/);
  phone.send('input', 'shared', 'without control');
  phone.send('claim', 'shared');
  assert.equal((await phone.next('state')).sessions[0].control, true);
  phone.send('input', 'shared', 'authorized');
  f.output('after attach\r\n');
  assert.equal((await phone.next('output')).sequence, snapshot.sequence + 1);
  await delay(20);
  assert.deepEqual(f.writes, [['shared', 'authorized']]);
  const close = once(phone.socket, 'close');
  phone.socket.close();
  await close;
  while (f.mode.state().device.connected) await delay(5);
  assert.equal(f.shared.controller, null);

  const reconnected = await connect(t, origin, cookie);
  reconnected.send('attach', 'shared');
  assert.match((await reconnected.next('snapshot')).data, /after attach/);
  assert.equal(f.mode.state().expiresAt, activated.expiresAt);
  f.advance(HOUR);
  const expired = once(reconnected.socket, 'close');
  reconnected.send('input', 'shared', 'too late');
  assert.equal((await expired)[0], 4001);
  assert.equal(f.mode.state().status, 'disabled');
  assert.equal(f.blockers.size, 0);
  assert.equal(f.stops(), 1);
  assert.deepEqual(f.writes, [['shared', 'authorized']]);
  assert.ok(f.shared.screen.snapshot());
});

test('view-only subscriptions cannot claim, revocation and provider failure clean up', {timeout: 8000}, async t => {
  const f = await fixture(t);
  const activated = await f.mode.start({provider: 'cloudflare', ids: ['shared'], permission: 'view', hours: 3});
  const origin = new URL(activated.invitation.link).origin;
  const response = await pair(origin, activated.invitation.link);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const phone = await connect(t, origin, cookie);
  phone.send('attach', 'shared');
  await phone.next('snapshot');
  phone.send('claim', 'shared');
  phone.send('input', 'shared', 'blocked');
  f.mode.share('private');
  await phone.next('state');
  assert.equal(f.shared.controller, undefined);
  assert.deepEqual(f.writes, []);
  f.mode.remove('shared');
  assert.equal((await phone.next('exit')).id, 'shared');
  const closed = once(phone.socket, 'close');
  f.mode.revoke();
  assert.equal((await closed)[0], 4003);
  assert.equal((await fetch(origin + '/api/state', {headers: {Cookie: cookie}})).status, 401);
  assert.equal(f.mode.regenerate().expiresAt, activated.expiresAt);
  f.fail('Provider disconnected.');
  assert.deepEqual(f.mode.state(), {status: 'disabled', message: 'Provider disconnected.'});
  assert.equal(f.stops(), 1);
  assert.equal(f.blockers.size, 0);
});

test('cancelling startup waits for neither a tunnel link nor a new deadline', {timeout: 8000}, async t => {
  let release;
  const f = await fixture(t, () => new Promise(resolve => {release = resolve;}));
  const start = f.mode.start({provider: 'cloudflare', ids: ['shared'], permission: 'view', hours: 1});
  while (!release) await delay(10);
  f.mode.stop();
  release(`http://127.0.0.1:${f.port()}`);
  assert.deepEqual(await start, {status: 'disabled', message: 'Remote Mode disabled.'});
  assert.equal(f.stops(), 1);
  assert.equal(f.blockers.size, 0);
  await assert.rejects(fetch(`http://127.0.0.1:${f.port()}/`));
});

test('Cloudflare adapter waits for a registered connection and stops the supervisor', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  Object.assign(child, {pid: 123, connected: true, exitCode: null, signalCode: null});
  let disconnected = false;
  child.disconnect = () => {disconnected = true;};
  const failures = [];
  const adapter = startCloudflare(4000, reason => failures.push(reason), (_path, args) => {
    assert.deepEqual(args, ['4000']);
    return child;
  });
  child.stderr.emit('data', 'https://demo.trycloudflare.com |\n');
  child.stderr.emit('data', 'INF Registered tunnel connection');
  assert.equal(await adapter.connected, 'https://demo.trycloudflare.com');
  adapter.stop();
  child.emit('close');
  assert.equal(disconnected, true);
  assert.deepEqual(failures, []);
});
