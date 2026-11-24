const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UpdateController, releaseDecision, safeError, dismissalStore, registerUpdateIpc, restartDialog, installUpdate, FEED, RETRIES, PERIOD } = require('../electron/updates.cjs');

const metadata = (version = '0.5.0') => ({ version, tag: `v${version}`,
  files: [{ url: `xTerm-${version}-arm64.zip`, sha512: Buffer.alloc(64).toString('base64') }] });
class UpdaterDouble extends EventEmitter {
  checks = 0;
  downloads = 0;
  installs = 0;
  info = metadata();
  setFeedURL(value) { this.feed = value; }
  async checkForUpdates() { this.checks++; return { updateInfo: this.info, isUpdateAvailable: true }; }
  async downloadUpdate() { this.downloads++; this.emit('download-progress', { percent: 51.4, downloadedFile: '/private/path' }); }
  quitAndInstall() { this.installs++; }
}
function fixture(overrides = {}) {
  const updater = new UpdaterDouble(), timers = [], saved = [], events = [];
  const controller = new UpdateController({ updater, installed: '0.4.0', enabled: true, platform: 'darwin', arch: 'arm64',
    store: { load: () => [], save: value => saved.push(value) }, notify: state => events.push(state),
    setTimer: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; }, clearTimer: () => {},
    ...overrides });
  return { updater, controller, timers, saved, events };
}

test('stable semantic version decisions reject equal, older, prerelease, draft and malformed versions', () => {
  for (const version of ['0.4.0', '0.3.9', '0.5.0-beta.1', '0.4.0+build']) assert.equal(releaseDecision(metadata(version), '0.4.0', 'darwin', 'arm64'), null);
  assert.equal(releaseDecision({ ...metadata(), draft: true }, '0.4.0', 'darwin', 'arm64'), null);
  assert.equal(releaseDecision({ ...metadata(), prerelease: true }, '0.4.0', 'darwin', 'arm64'), null);
  assert.equal(releaseDecision(metadata('0.10.0'), '0.9.0', 'darwin', 'arm64').version, '0.10.0');
  for (const version of ['banana', null, '0.5', '999'.repeat(80)]) assert.throws(() => releaseDecision({ version }, '0.4.0', 'darwin', 'arm64'));
});
test('matching assets, SHA512 and safe tag/filenames are mandatory', () => {
  for (const info of [
    { ...metadata(), files: [] }, { ...metadata(), files: null }, { ...metadata(), tag: 'v1.0.0' },
    { ...metadata(), packages: { x64: { path: 'https://evil.test/package' } } },
    { ...metadata(), files: [{ url: 'xTerm-0.5.0-arm64.dmg', sha512: Buffer.alloc(64).toString('base64') }] },
    { ...metadata(), files: [{ url: 'https://evil.test/update.zip', sha512: Buffer.alloc(64).toString('base64') }] },
    { ...metadata(), files: [{ url: '../update-arm64.zip', sha512: Buffer.alloc(64).toString('base64') }] },
    { ...metadata(), files: [{ url: 'update-arm64.zip', sha512: 'malformed' }] },
  ]) assert.throws(() => releaseDecision(info, '0.4.0', 'darwin', 'arm64'));
  assert.throws(() => releaseDecision(metadata(), '0.4.0', 'darwin', 'x64'));
  assert.equal(releaseDecision({ ...metadata(), files: [{ ...metadata().files[0], url: 'xTerm-0.5.0-universal.zip' }] }, '0.4.0', 'darwin', 'arm64').version, '0.5.0');
});
test('no automatic download, install, prerelease, downgrade or dev feed is allowed', async () => {
  const { updater, controller } = fixture();
  assert.deepEqual(updater.feed, FEED);
  for (const key of ['autoDownload', 'autoInstallOnAppQuit', 'allowPrerelease', 'allowDowngrade', 'forceDevUpdateConfig']) assert.equal(updater[key], false);
  await controller.check();
  assert.equal(controller.snapshot().status, 'available');
  assert.equal(updater.downloads, 0); assert.equal(updater.installs, 0);
  assert.equal(controller.snapshot().releaseUrl, 'https://github.com/BrUn3y/xTerm/releases/tag/v0.5.0');
});
test('development disables every operation and does not load a real updater', async () => {
  const { controller, timers } = fixture({ updater: null, enabled: false, unavailableReason: 'Development' });
  controller.start();
  for (const action of ['check', 'download', 'restart']) assert.equal((await controller[action]()).status, 'unavailable');
  assert.equal(timers.length, 0);
});
test('startup, periodic checks and bounded backoff', async () => {
  const { updater, controller, timers } = fixture();
  controller.start(); assert.equal(timers.at(-1).delay, 15_000);
  updater.checkForUpdates = async () => { throw new Error('offline with private headers'); };
  for (const delay of [...RETRIES, PERIOD]) {
    await controller.check(false); assert.equal(timers.at(-1).delay, delay);
  }
  await controller.check(true); assert.equal(timers.at(-1).delay, RETRIES[0]);
  updater.checkForUpdates = async () => ({ updateInfo: metadata() });
  await controller.check(false); assert.equal(timers.at(-1).delay, PERIOD);
  controller.dispose();
});
test('same-version deferral persists and automatic checks do not re-prompt; manual checks reveal it', async () => {
  const { updater, controller, saved } = fixture();
  await controller.check(false); controller.later(); assert.deepEqual(saved.at(-1), ['0.5.0']);
  await controller.check(false); assert.equal(controller.snapshot().dismissed, true);
  await controller.check(true); assert.equal(controller.snapshot().dismissed, false);
  controller.later(); updater.info = metadata('0.6.0');
  await controller.check(false); assert.equal(controller.snapshot().dismissed, false);
  const second = fixture({ store: { load: () => ['0.5.0'], save: () => {} } });
  await second.controller.check(false); assert.equal(second.controller.snapshot().dismissed, true);
});
test('deferring during a download stays deferred when the verified download becomes ready', async () => {
  let finish;
  const { updater, controller } = fixture();
  await controller.check();
  updater.downloadUpdate = () => new Promise(resolve => { finish = resolve; });
  const pending = controller.download();
  assert.equal(controller.snapshot().status, 'downloading');
  controller.later();
  finish(); await pending;
  assert.equal(controller.snapshot().status, 'ready');
  assert.equal(controller.snapshot().dismissed, true);
  await controller.check(true); assert.equal(controller.snapshot().dismissed, false);
});
test('download progress is bounded and downloaded paths/raw release notes never cross the bridge', async () => {
  const { controller, updater, events } = fixture();
  updater.info.releaseNotes = '<script>unsafe</script>';
  await controller.download(); assert.equal(updater.downloads, 0);
  await controller.check(); await controller.download();
  assert.equal(controller.snapshot().status, 'ready');
  assert.ok(events.some(state => state.progress === 51));
  assert.equal(JSON.stringify(events).includes('/private/path'), false);
  assert.equal(JSON.stringify(events).includes('<script>'), false);
});
test('interrupted or failed verification cannot become ready and can retry without installing', async () => {
  for (const code of ['ECONNRESET', 'ERR_UPDATER_CHECKSUM_MISMATCH', 'ERR_UPDATER_INVALID_SIGNATURE', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND']) {
    const { updater, controller } = fixture();
    await controller.check();
    updater.downloadUpdate = async () => { throw Object.assign(new Error('secret file /private/path'), { code }); };
    await controller.download(); assert.equal(controller.snapshot().status, 'error');
    await controller.restart(); assert.equal(updater.installs, 0);
    assert.equal(controller.snapshot().message.includes('/private/path'), false);
    updater.downloadUpdate = async () => {};
    await controller.download(); assert.equal(controller.snapshot().status, 'ready');
  }
});
test('an updater error after ZIP download invalidates readiness', async () => {
  const { updater, controller } = fixture();
  await controller.check(); await controller.download();
  updater.emit('error', { code: 'ERR_UPDATER_INVALID_SIGNATURE' });
  await controller.restart(); assert.equal(updater.installs, 0);
  assert.equal(controller.snapshot().status, 'error');
});
test('only explicit native acceptance requests install; cancellation leaves PTY lifecycle untouched', async () => {
  let accepted = false, confirmations = 0;
  const { controller, updater } = fixture({ confirmRestart: async version => { confirmations++; assert.equal(version, '0.5.0'); return accepted; } });
  await controller.restart(); assert.equal(confirmations, 0);
  await controller.check(); await controller.download();
  await controller.restart(); assert.equal(controller.snapshot().status, 'ready'); assert.equal(updater.installs, 0);
  accepted = true; await controller.restart();
  assert.equal(updater.installs, 1); assert.equal(controller.snapshot().status, 'installing');
  await controller.restart(); assert.equal(updater.installs, 1);
});
test('busy operations and concurrent restart confirmation are single-flight', async () => {
  let resolve;
  const { controller, updater } = fixture({ confirmRestart: () => new Promise(done => { resolve = done; }) });
  await controller.check(); await controller.download();
  const pending = controller.restart();
  await controller.restart(); await controller.check(); await controller.download();
  assert.equal(updater.downloads, 1); assert.equal(updater.checks, 1);
  resolve(false); await pending; assert.equal(updater.installs, 0);
});
test('dispose or signature failure during confirmation prevents install', async () => {
  for (const action of ['dispose', 'error']) {
    let resolve;
    const { controller, updater } = fixture({ confirmRestart: () => new Promise(done => { resolve = done; }) });
    await controller.check(); await controller.download();
    const pending = controller.restart();
    if (action === 'dispose') controller.dispose();
    else updater.emit('error', { code: 'ERR_UPDATER_INVALID_SIGNATURE' });
    resolve(true); await pending; assert.equal(updater.installs, 0);
  }
});
test('minimum OS / staged rollout eligibility from updater is respected', async () => {
  const { updater, controller } = fixture();
  updater.checkForUpdates = async () => ({ updateInfo: metadata(), isUpdateAvailable: false });
  await controller.check(); assert.equal(controller.snapshot().status, 'unavailable');
  await controller.download(); assert.equal(updater.downloads, 0);
});
test('IPC rejects subframes, foreign windows, arbitrary commands and extra payloads', async () => {
  const { controller } = fixture();
  const handlers = new Map();
  const webContents = { mainFrame: {} };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  registerUpdateIpc({ handle: (key, callback) => handlers.set(key, callback) }, controller,
    () => ({ isDestroyed: () => false, webContents }));
  const act = handlers.get('updates:action'), state = handlers.get('updates:state');
  assert.equal(state(event).status, 'idle');
  for (const payload of [null, {}, 'install', 'shell', { action: 'download', url: 'https://evil.test' }]) assert.throws(() => act(event, payload));
  assert.throws(() => act(event, 'download', '/tmp/update'));
  assert.throws(() => state(event, {}));
  assert.throws(() => act({ ...event, senderFrame: {} }, 'check'));
  assert.throws(() => act({ ...event, sender: {} }, 'check'));
  assert.equal((await act(event, 'check')).status, 'available');
});
test('native dialog defaults to Cancel and discloses process loss and preference retention', () => {
  const options = restartDialog('0.5.0', 3);
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
  assert.match(options.detail, /3 active terminal sessions/);
  assert.match(options.detail, /processes will end/); assert.match(options.detail, /will not be restored/);
  assert.match(options.detail, /saved workspace folders are kept/);
});
test('deferrals save atomically without touching renderer preferences or saved folders', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xterm-updates-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'preferences.json'), '{"theme":"dark","projects":["/work"]}');
  const store = dismissalStore(directory);
  assert.deepEqual(store.load(), []); store.save(['0.5.0']); assert.deepEqual(store.load(), ['0.5.0']);
  assert.equal(fs.readFileSync(path.join(directory, 'preferences.json'), 'utf8'), '{"theme":"dark","projects":["/work"]}');
  fs.writeFileSync(path.join(directory, 'update-dismissals.json'), 'broken');
  assert.deepEqual(store.load(), []);
});
test('error messages are sanitized rather than exposing raw paths or response bodies', () => {
  assert.equal(safeError(new Error('Authorization: secret /Users/private')), safeError(null));
});
test('macOS native signature failure removes install callbacks and cannot end terminal sessions', async () => {
  const updater = new UpdaterDouble(), native = new EventEmitter();
  native.checkForUpdates = () => native.emit('error', new Error('Signature rejected'));
  await assert.rejects(installUpdate(updater, native, 'darwin'), /Signature rejected/);
  assert.equal(updater.installs, 0);
  assert.equal(native.listenerCount('update-downloaded'), 0);
  native.emit('update-downloaded'); assert.equal(updater.installs, 0);
  native.checkForUpdates = () => native.emit('update-downloaded');
  await installUpdate(updater, native, 'darwin');
  assert.equal(updater.installs, 1);
  assert.equal(native.listenerCount('error'), 0);
});
test('Windows and AppImage install only through the supported updater', async () => {
  const updater = new UpdaterDouble();
  for (const platform of ['win32', 'linux']) await installUpdate(updater, null, platform);
  assert.equal(updater.installs, 2);
});
