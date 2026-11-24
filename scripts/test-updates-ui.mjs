import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const url = process.env.XTERM_UI_TEST_URL || 'http://127.0.0.1:5175';
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/update-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  for (const viewport of [{ width: 1480, height: 940 }, { width: 980, height: 620 }, { width: 780, height: 720 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
      const callbacks = new Set();
      const state = { status: 'available', installedVersion: '0.4.0', version: '0.5.0',
        releaseUrl: 'https://github.com/BrUn3y/xTerm/releases/tag/v0.5.0', progress: null, dismissed: false, message: '' };
      window.updateTest = {
        state, calls: [], emit(value) { Object.assign(state, value); for (const callback of callbacks) callback({ ...state }); },
      };
      localStorage.setItem('xterm.projects', JSON.stringify(['/work/alpha', '/work/beta']));
      const unsubscribe = () => () => {};
      window.desktop = {
        info: async () => ({ home: '/home/test', cwd: '/work/project', shell: '/bin/bash', platform: 'darwin',
          hostname: 'test', username: 'test', version: '0.4.0', shells: ['/bin/bash'] }),
        updateState: async () => ({ ...state }),
        onUpdateState: callback => { callbacks.add(callback); return () => callbacks.delete(callback); },
        updateAction: async action => {
          window.updateTest.calls.push(action);
          if (action === 'later') window.updateTest.emit({ dismissed: true });
          if (action === 'check') window.updateTest.emit({ dismissed: false });
          if (action === 'download') window.updateTest.emit({ status: 'downloading', progress: 43 });
          // Native confirmation is intentionally simulated as cancelled.
          if (action === 'restart') window.updateTest.emit({ status: 'ready', message: 'Native confirmation cancelled in test.' });
          return { ...state };
        },
        setAppearance: () => {}, openExternal: async value => window.updateTest.calls.push(value),
        onAgent: unsubscribe, onCommand: unsubscribe, onFilesChanged: unsubscribe,
        onData: unsubscribe, onCwd: unsubscribe, onExit: unsubscribe,
        createTerminal: async value => ({ ...value, pid: 1234 }), closeTerminal: async () => {},
        write: () => {}, resize: () => {}, reportTerminalView: () => {},
        listFiles: async cwd => ({ cwd, parent: '/work', entries: [], total: 0 }),
        gitInfo: async () => null, windowAction: () => {},
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const notice = page.getByRole('region', { name: 'Application update' });
    await notice.getByRole('button', { name: 'Download update' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.updateTest.calls), []);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
      for (const status of ['available', 'checking', 'up-to-date', 'unavailable', 'downloading', 'ready', 'error', 'installing']) {
        await page.evaluate(status => window.updateTest.emit({
          status, dismissed: false, progress: status === 'downloading' ? 43 : null,
          message: status === 'error' ? 'The update could not be verified. Nothing was installed. Retry the download.' : '',
        }), status);
        await notice.waitFor();
        const geometry = await notice.evaluate(element => {
          const box = element.getBoundingClientRect();
          const buttons = [...element.querySelectorAll('button')].map(button => {
            const b = button.getBoundingClientRect();
            return b.left >= box.left && b.right <= box.right + 1 && b.top >= box.top && b.bottom <= box.bottom + 1 &&
              button.scrollWidth <= button.clientWidth + 1;
          });
          return { fits: box.right <= innerWidth && box.bottom <= innerHeight, buttons };
        });
        assert.equal(geometry.fits, true, `${theme}/${status}/${viewport.width}: notification fits`);
        assert.ok(geometry.buttons.every(Boolean), `${theme}/${status}/${viewport.width}: buttons fit`);
        const a11y = await new AxeBuilder({ page }).include('.update-notice')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(a11y.violations.map(item => ({ id: item.id, impact: item.impact })), [],
          `${theme}/${status}/${viewport.width}: accessibility`);
        if (['available', 'downloading', 'ready', 'error'].includes(status)) {
          await page.screenshot({ path: path.join(output, `${viewport.width}-${theme}-${status}.png`) });
        }
      }
    }
    await page.evaluate(() => window.updateTest.emit({ status: 'available', dismissed: false }));
    await notice.getByRole('button', { name: 'Later' }).click();
    await notice.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await notice.getByRole('button', { name: 'Download update' }).click();
    await page.getByRole('progressbar', { name: 'Update download progress' }).waitFor();
    await page.evaluate(() => window.updateTest.emit({ status: 'ready', progress: 100 }));
    await notice.getByRole('button', { name: 'Restart and update' }).click();
    await notice.getByText('Native confirmation cancelled in test.').waitFor();
    assert.deepEqual(await page.evaluate(() => window.updateTest.calls), ['later', 'check', 'download', 'restart']);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('xterm.projects'))), ['/work/alpha', '/work/beta']);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xterm.settings')).theme), 'dark');
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}x${viewport.height}: Light/Dark states, accessibility, geometry and mocked consent flow`);
    await context.close();
  }
} finally { await browser.close(); }
