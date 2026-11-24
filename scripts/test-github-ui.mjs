import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const url = process.env.XTERM_UI_TEST_URL || 'http://127.0.0.1:5177/tests/fixtures/github-preview.html';
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/github-ui';
await mkdir(output, {recursive: true});
const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});
try {
  for (const viewport of [{width: 1480, height: 940}, {width: 980, height: 620}, {width: 780, height: 720}]) {
    const page = await browser.newPage({viewport});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const button = page.locator('.github-link');
    await page.getByText('Session connected', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Open test-owner/alpha on GitHub', exact: true}).waitFor();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', {name: 'Switch to dark mode', exact: true}).click();
      await page.waitForTimeout(200);
      await page.locator('.theme-toggle').focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await button.evaluate(element => document.activeElement === element), true, 'Native keyboard tab navigation');
      await page.keyboard.press('Enter');
      await page.keyboard.press(' ');
      assert.deepEqual(await page.evaluate(() => window.githubTest.external()), [
        ...Array(theme === 'dark' ? 4 : 2).fill('https://github.com/test-owner/alpha'),
      ]);
      const geometry = await button.evaluate(element => {
        const box = element.getBoundingClientRect(), toggle = document.querySelector('.theme-toggle').getBoundingClientRect();
        const tooltip = element.querySelector('.github-link-tooltip').getBoundingClientRect();
        return {width: box.width, height: box.height, adjacent: box.right < toggle.left,
          inside: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
          tooltipInside: tooltip.left >= 0 && tooltip.right <= innerWidth,
          color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor,
          outline: getComputedStyle(element).outlineStyle, theme: document.documentElement.dataset.theme};
      });
      assert.equal(geometry.width, 36); assert.equal(geometry.height, 36);
      assert.equal(geometry.adjacent, true); assert.equal(geometry.inside, true); assert.equal(geometry.tooltipInside, true);
      assert.equal(geometry.outline, 'solid'); assert.equal(geometry.theme, theme);
      const luminance = color => {
        const values = color.match(/\d+/g).slice(0, 3).map(value => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const foreground = luminance(geometry.color), background = luminance(geometry.background);
      const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      assert.ok(contrast >= 4.5, `GitHub icon contrast ${contrast.toFixed(2)}`);
      await page.screenshot({path: path.join(output, `${viewport.width}-${theme}.png`)});
      console.log(`PASS ${theme} ${viewport.width}x${viewport.height}: adjacent icon, tooltip, keyboard focus and activation`);
    }
    const first = await page.evaluate(() => window.githubTest.terminals()[0].id);
    await page.evaluate(() => window.githubTest.command('split'));
    await page.waitForFunction(() => window.githubTest.terminals().length === 2);
    const second = await page.evaluate(() => window.githubTest.terminals()[1].id);
    await page.evaluate(id => window.githubTest.cwd(id, '/projects/beta'), second);
    await page.getByRole('button', {name: 'Open test-owner/beta on GitHub', exact: true}).waitFor();
    await page.locator('.terminal-pane').first().click();
    await page.getByRole('button', {name: 'Open test-owner/alpha on GitHub', exact: true}).waitFor();
    await page.evaluate(() => window.githubTest.command('new-tab'));
    await page.waitForFunction(() => window.githubTest.terminals().length === 3);
    const third = await page.evaluate(() => window.githubTest.terminals()[2].id);
    await page.evaluate(id => window.githubTest.cwd(id, '/projects/gamma'), third);
    await page.getByRole('button', {name: 'Open test-owner/gamma on GitHub', exact: true}).waitFor();
    await page.getByRole('tab').first().click();
    await page.getByRole('button', {name: 'Open test-owner/alpha on GitHub', exact: true}).waitFor();
    await page.evaluate(() => window.githubTest.manual(true));
    await page.evaluate(id => window.githubTest.cwd(id, '/projects/slow'), first);
    await button.waitFor({state: 'detached'});
    await page.waitForFunction(() => window.githubTest.pending().includes('/projects/slow'));
    await page.locator('.terminal-pane').nth(1).click();
    await page.waitForFunction(() => window.githubTest.pending().includes('/projects/beta'));
    await page.evaluate(() => window.githubTest.resolve('/projects/beta'));
    await page.getByRole('button', {name: 'Open test-owner/beta on GitHub', exact: true}).waitFor();
    await page.evaluate(() => window.githubTest.resolve('/projects/slow'));
    assert.equal(await button.getAttribute('aria-label'), 'Open test-owner/beta on GitHub');
    await page.evaluate(id => window.githubTest.cwd(id, '/projects/plain'), second);
    await button.waitFor({state: 'detached'});
    await page.evaluate(() => window.githubTest.resolve('/projects/plain'));
    assert.equal(await button.count(), 0);
    await page.evaluate(id => window.githubTest.cwd(id, '/projects/rejected'), second);
    await page.waitForFunction(() => window.githubTest.pending().includes('/projects/rejected'));
    await page.evaluate(() => window.githubTest.reject());
    assert.equal(await button.count(), 0);
    await page.evaluate(() => window.githubTest.manual(false));
    await page.evaluate(id => window.githubTest.cwd(id, '/projects/beta'), second);
    await button.waitFor();
    await page.evaluate(() => {window.githubTest.manual(true); window.githubTest.refresh('/projects/beta');});
    await button.waitFor({state: 'detached'});
    await page.evaluate(() => window.githubTest.resolve('/projects/beta'));
    await button.waitFor();
    await page.evaluate(() => {window.githubTest.manual(false); window.githubTest.folder('/projects/folder-choice');});
    await page.getByRole('button', {name: 'Open folder', exact: true}).click();
    await page.getByRole('button', {name: 'Open test-owner/folder-choice on GitHub', exact: true}).waitFor();
    await page.evaluate(id => window.githubTest.cwd(id, `/projects/${'long-directory-name-'.repeat(10)}`), second);
    await button.waitFor();
    const headerFits = await page.locator('.workspace-header').evaluate(element => {
      const title = element.querySelector('.workspace-title').getBoundingClientRect();
      const actions = element.querySelector('.workspace-header-actions').getBoundingClientRect();
      return title.right <= actions.left && actions.right <= innerWidth;
    });
    assert.equal(headerFits, true, 'Long directory names do not overlap header actions');
    assert.deepEqual(errors, [], 'No page errors or unhandled rejection');
    console.log(`PASS ${viewport.width}: split-pane/tab/cwd changes, delayed stale responses, plain folder, rejected lookup and refresh`);
    await page.close();
  }
} finally {await browser.close();}
