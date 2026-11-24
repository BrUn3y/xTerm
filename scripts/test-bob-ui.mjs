import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

// Playwright is a development-only dependency, not part of the desktop runtime.
const {chromium} = createRequire(import.meta.url)('playwright');
const url = process.env.XTERM_UI_TEST_URL || 'http://127.0.0.1:5176/tests/fixtures/bob-preview.html';
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/bob-ui';
await mkdir(output, {recursive: true});
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  for (const viewport of [{width: 1480, height: 940}, {width: 980, height: 620}, {width: 780, height: 720}]) {
    const context = await browser.newContext({viewport});
    const remote = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
      remote.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const card = page.getByRole('region', {name: 'Bob harness activity'});
    await card.waitFor();
    await card.getByRole('img', {name: 'IBM Bob', exact: true}).evaluate(image => image.decode());
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', {name: 'Switch to dark mode', exact: true}).click();
      await card.scrollIntoViewIfNeeded();
      const geometry = await card.evaluate(element => {
        const box = element.getBoundingClientRect();
        const avatar = element.querySelector('.agent-avatar');
        const image = avatar.querySelector('img');
        const inside = node => {
          const rect = node.getBoundingClientRect();
          return rect.left >= box.left && rect.right <= box.right + 1
            && rect.top >= box.top && rect.bottom <= box.bottom + 1;
        };
        const style = image && getComputedStyle(image);
        return {
          height: box.height,
          visible: box.top >= 0 && box.bottom <= innerHeight,
          fits: [...element.querySelectorAll('.agent-avatar, h3, .agent-model, .agent-status-row, footer')].every(inside),
          width: avatar.clientWidth, avatarHeight: avatar.clientHeight,
          theme: document.documentElement.dataset.theme,
          image: image && {source: image.currentSrc, loaded: image.complete && image.naturalWidth > 0,
            width: image.naturalWidth, height: image.naturalHeight,
            filter: style.filter, fit: style.objectFit, alt: image.alt},
          fallback: !!element.querySelector('.bob-avatar'),
        };
      });
      assert.equal(geometry.fits, true, `${theme}/${viewport.width}: card contents fit`);
      assert.equal(geometry.visible, true, 'The whole card is visible after sidebar scroll');
      assert.equal(geometry.width, geometry.avatarHeight, 'Avatar remains square');
      assert.equal(geometry.theme, theme);
      assert.ok(geometry.image, 'Official Bob artwork is required');
      assert.equal(geometry.image.loaded, true);
      assert.equal(new URL(geometry.image.source).origin, new URL(url).origin);
      assert.equal(geometry.image.filter, 'none');
      assert.equal(geometry.image.fit, 'contain');
      assert.equal(geometry.image.alt, 'IBM Bob');
      assert.equal(geometry.image.width, 512);
      assert.equal(geometry.image.height, 512);
      assert.equal(geometry.fallback, false);
      await page.screenshot({path: path.join(output, `${viewport.width}-${viewport.height}-${theme}.png`)});
      console.log(`PASS ${theme} ${viewport.width}x${viewport.height}, card ${geometry.height}px (${geometry.height >= 280 ? 'expanded' : 'compact'}): official local artwork loaded`);
    }
    assert.deepEqual(remote, [], 'No remote network requests from preview');
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
