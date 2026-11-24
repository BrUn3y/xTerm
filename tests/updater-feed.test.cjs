const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { HttpExecutor, configureRequestUrl } = require('builder-util-runtime');
const { AppImageUpdater } = require('electron-updater/out/AppImageUpdater');
const { UpdateController } = require('../electron/updates.cjs');

// Exercise the real GitHubProvider and updater's checksum pipeline without
// accessing GitHub. This executor can only send requests to our loopback server.
class IsolatedExecutor extends HttpExecutor {
  constructor(port) { super(); this.port = port; }
  createRequest(options, callback) {
    assert.equal(options.hostname || options.host, 'github.com');
    return http.request({ hostname: '127.0.0.1', port: this.port, path: options.path, method: options.method || 'GET' }, callback);
  }
  async download(url, destination, options) {
    return options.cancellationToken.createPromise((resolve, reject, onCancel) => {
      const request = {};
      configureRequestUrl(url, request);
      this.doDownload(request, { destination, options, onCancel, callback: error => error ? reject(error) : resolve(destination), responseHandler: null }, 0);
    });
  }
  addRedirectHandlers(request) {
    request.on('redirect', () => { throw new Error('Redirects must not be used by the isolated fixture.'); });
  }
}

test('real GitHub provider selects stable metadata and verifies downloads on an isolated loopback feed', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xterm-feed-'));
  const artifact = Buffer.from('isolated test artifact - never executable');
  const checksum = createHash('sha512').update(artifact).digest('base64');
  const arch = process.arch;
  const channel = arch === 'x64' ? 'latest-linux.yml' : `latest-linux-${arch}.yml`;
  let broken = false, requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    const url = new URL(request.url, 'http://localhost').pathname;
    if (url.endsWith('.atom')) {
      response.end('<feed><entry><title>Beta</title><link href="https://github.com/BrUn3y/xTerm/releases/tag/v0.6.0-beta.1"/><content>beta</content></entry><entry><title>Stable</title><link href="https://github.com/BrUn3y/xTerm/releases/tag/v0.5.0"/><content>stable notes</content></entry></feed>');
    } else if (url.endsWith('/latest')) response.end('{"tag_name":"v0.5.0"}');
    else if (url.endsWith(`/${channel}`)) response.end(`version: 0.5.0\nfiles:\n  - url: xTerm-0.5.0-${arch}.AppImage\n    sha512: ${checksum}\n`);
    else if (url.endsWith('.AppImage')) response.end(broken ? Buffer.from('tampered artifact') : artifact);
    else { response.statusCode = 404; response.end('not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const config = path.join(directory, 'app-update.yml');
  fs.writeFileSync(config, 'updaterCacheDirName: isolated-update-cache\n');
  const app = { version: '0.4.0', name: 'isolated-xterm', isPackaged: true, appUpdateConfigPath: config,
    userDataPath: directory, baseCachePath: directory, whenReady: async () => {}, onQuit: () => {}, quit: () => { throw new Error('No install permitted'); } };
  const oldAppImage = process.env.APPIMAGE;
  process.env.APPIMAGE = path.join(directory, 'old.AppImage');
  t.after(() => { if (oldAppImage === undefined) delete process.env.APPIMAGE; else process.env.APPIMAGE = oldAppImage; });
  const updater = new AppImageUpdater(undefined, app);
  // Exercise Linux's provider/installer on every test host, including macOS.
  updater._testOnlyOptions = { platform: 'linux' };
  updater.httpExecutor = new IsolatedExecutor(server.address().port);
  updater.disableDifferentialDownload = true;
  updater.logger = null;
  const controller = new UpdateController({ updater, installed: '0.4.0', enabled: true, platform: 'linux', arch, notify: () => {}, confirmRestart: async () => false });
  t.after(() => controller.dispose());
  await controller.check();
  assert.equal(controller.snapshot().status, 'available');
  assert.equal(controller.snapshot().version, '0.5.0');
  assert.ok(requests.some(url => url.endsWith(`/${channel}`)));
  assert.equal(requests.some(url => url.endsWith('.AppImage')), false);
  broken = true;
  await controller.download();
  assert.equal(controller.snapshot().status, 'error');
  assert.match(controller.snapshot().message, /verified/);
  await controller.restart(); assert.notEqual(controller.snapshot().status, 'installing');
  broken = false;
  await controller.download();
  assert.equal(controller.snapshot().status, 'ready');
  assert.deepEqual(fs.readFileSync(updater.installerPath), artifact);
  assert.ok(requests.every(url => !url.includes('beta')));
});
