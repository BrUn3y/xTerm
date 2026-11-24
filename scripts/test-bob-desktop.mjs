import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';

const {quote} = createRequire(import.meta.url)('../electron/shell.cjs');
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'xterm-bob-desktop-')));
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/bob-desktop';
const executablePath = process.env.XTERM_DESKTOP_TEST_EXECUTABLE;
const expectedHash = '509de4ef3bd4dad1bb8fe4f817c7db9607d33cd143b50c466c5b9b5b7ad244fc';
let application;
try {
  await mkdir(output, {recursive: true});
  const fixture = path.join(directory, 'bob.cjs');
  // A controlled foreground process exercises existing Bob process detection.
  // This fixture never runs IBM's CLI or contacts a model/provider.
  await writeFile(fixture, "process.stdout.write('BOB_FIXTURE_READY\\n'); setInterval(() => {}, 1000);\n");
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(directory, 'user-data')}`,
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), ...(executablePath ? [] : ['.'])],
    env: {...process.env, HOME: directory, XDG_CONFIG_HOME: directory, SHELL: '/bin/bash',
      XTERM_DEV_URL: '', ELECTRON_RUN_AS_NODE: ''},
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal(await application.evaluate(({app}) => app.getPath('userData')), path.join(directory, 'user-data'));
  assert.equal(await application.evaluate(({app}) => app.isPackaged), !!executablePath);
  const preferences = await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  await application.evaluate(({session}) => {
    globalThis.bobRemoteRequests = [];
    session.defaultSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (details, callback) => {
      globalThis.bobRemoteRequests.push(details.url);
      callback({cancel: true});
    });
  });
  await page.context().setOffline(true);
  await page.getByText('Session connected', {exact: true}).waitFor();
  const input = page.locator('.xterm-helper-textarea');
  await input.pressSequentially(`${quote(process.execPath)} ${quote(fixture)}`);
  await input.press('Enter');
  const card = page.getByRole('region', {name: 'Bob harness activity', exact: true});
  await card.waitFor();
  const image = card.getByRole('img', {name: 'IBM Bob', exact: true});
  await image.evaluate(element => element.decode());
  const source = await image.getAttribute('src');
  assert.equal(new URL(source, page.url()).protocol, 'file:');
  const imagePath = fileURLToPath(new URL(source, page.url()));
  if (executablePath) {
    assert.match(new URL(source, page.url()).pathname, /app\.asar\/dist\/assets\/bob-standing-/);
    const {extractFile, listPackage} = await import('@electron/asar');
    const appPath = await application.evaluate(({app}) => app.getAppPath());
    assert.equal(createHash('sha256').update(extractFile(appPath, path.relative(appPath, imagePath))).digest('hex'), expectedHash);
    assert.ok((await readFile(path.join(path.dirname(appPath), 'assets/NOTICE.md'), 'utf8')).includes(expectedHash));
    assert.equal(listPackage(appPath).some(file => /node_modules\/playwright|tests\/fixtures/.test(file)), false);
  } else assert.equal(createHash('sha256').update(await readFile(imagePath)).digest('hex'), expectedHash);
  for (const size of [{width: 1480, height: 940}, {width: 980, height: 620}]) {
    await application.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), size);
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await page.getByRole('button', {name: `Switch to ${theme} mode`, exact: true}).click();
      }
      await card.scrollIntoViewIfNeeded();
      const geometry = await image.evaluate(element => {
        const style = getComputedStyle(element), image = element.getBoundingClientRect();
        const avatar = element.parentElement.getBoundingClientRect();
        return {loaded: element.complete && element.naturalWidth === 512 && element.naturalHeight === 512,
          fit: style.objectFit, filter: style.filter,
          inside: image.left >= avatar.left && image.right <= avatar.right && image.top >= avatar.top && image.bottom <= avatar.bottom};
      });
      assert.deepEqual(geometry, {loaded: true, fit: 'contain', filter: 'none', inside: true});
      await page.screenshot({path: path.join(output, `${executablePath ? 'packaged' : 'development'}-${size.width}-${theme}.png`)});
    }
  }
  await input.press('Control+c');
  await card.waitFor({state: 'detached'});
  assert.deepEqual(await application.evaluate(() => globalThis.bobRemoteRequests), []);
  assert.deepEqual(errors, []);
  console.log(`PASS ${process.platform}/${process.arch} Electron (${executablePath ? 'packaged' : 'development'}): foreground Bob fixture detection, offline local artwork/hash, Light/Dark compact/expanded layout and return to shell.`);
  console.log('The controlled Bob-named process is a test fixture; IBM Bob CLI itself was not launched.');
} finally {
  await application?.close();
  await rm(directory, {recursive: true, force: true});
}
