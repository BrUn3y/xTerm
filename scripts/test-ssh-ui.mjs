import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.XTERM_UI_TEST_URL || 'http://127.0.0.1:5179/tests/fixtures/ssh-preview.html';
const output = process.env.XTERM_UI_TEST_OUTPUT || 'artifacts/ssh-ui';
await mkdir(output, {recursive: true});
const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});
try {
  for (const viewport of [{width: 1480, height: 940}, {width: 980, height: 620}, {width: 780, height: 720}]) {
    const page = await browser.newPage({viewport});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const card = page.getByRole('region', {name: 'SSH connection', exact: true});
    await card.waitFor();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', {name: 'Switch to dark mode', exact: true}).click();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await card.getByRole('status').textContent(), 'Unknown');
      assert.equal(await card.locator('dt', {hasText: 'Destination IP'}).evaluate(element => element.nextElementSibling.textContent), 'Unavailable');
      assert.equal(await card.locator('dt', {hasText: 'Remote hostname'}).evaluate(element => element.nextElementSibling.textContent), 'Not reported');
      const geometry = await card.evaluate(element => {
        const box = element.getBoundingClientRect(), footer = element.querySelector('footer').getBoundingClientRect();
        const metadata = element.querySelector('.ssh-metadata').getBoundingClientRect();
        return {visible: box.width > 0 && box.height > 0, inside: box.top >= 0 && box.bottom <= innerHeight,
          footerInside: footer.bottom <= box.bottom, separated: metadata.bottom <= footer.top,
          noHorizontalOverflow: element.scrollWidth <= element.clientWidth};
      });
      assert.deepEqual(geometry, {visible: true, inside: true, footerInside: true, separated: true, noHorizontalOverflow: true});
      assert.ok(await card.locator('.ssh-metadata').evaluate(element => element.clientHeight >= 40), 'Compact SSH details retain a visible scrolling area');
      const contrast = await card.evaluate(element => {
        const luminance = color => {
          const channels = color.match(/\d+/g).slice(0, 3).map(value => {
            const channel = Number(value) / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const style = getComputedStyle(element), text = luminance(style.color), background = luminance(style.backgroundColor);
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      });
      assert.ok(contrast >= 4.5, `SSH text contrast ${contrast.toFixed(2)}`);
      const firstTime = await card.locator('footer time').textContent();
      await page.waitForTimeout(1100);
      assert.notEqual(await card.locator('footer time').textContent(), firstTime);
      await page.screenshot({path: path.join(output, `${viewport.width}-${theme}.png`)});
    }
    const first = await page.evaluate(() => window.sshTest.terminals()[0].id);
    await page.evaluate(id => window.sshTest.agent(id, true), first);
    await card.getByText('Remote Harness', {exact: true}).waitFor();
    await page.evaluate(() => window.sshTest.command('split'));
    await page.waitForFunction(() => window.sshTest.terminals().length === 2);
    const second = await page.evaluate(() => window.sshTest.terminals()[1].id);
    await page.waitForTimeout(250);
    await page.evaluate(id => window.sshTest.ssh(id, 'second-alias', Date.now() - 61000), second);
    await card.getByRole('heading', {name: 'second-alias', exact: true}).waitFor();
    assert.match(await card.locator('footer time').textContent(), /^00:01:/);
    await page.locator('.terminal-pane').first().click();
    await card.getByRole('heading', {name: 'production-alias', exact: true}).waitFor();
    await card.getByText('Remote Harness', {exact: true}).waitFor();
    await page.evaluate(id => window.sshTest.ssh(id, null), first);
    await card.waitFor({state: 'detached'});
    await page.getByRole('region', {name: 'Remote Harness harness activity', exact: true}).waitFor();
    await page.evaluate(id => window.sshTest.agent(id, false), first);
    await page.locator('.poster').waitFor();
    await page.evaluate(id => window.sshTest.ssh(id, 'very-long-alias-'.repeat(12)), first);
    await card.waitFor();
    assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await page.evaluate(() => window.sshTest.command('new-tab'));
    await page.waitForFunction(() => window.sshTest.terminals().length === 3);
    await page.waitForTimeout(250);
    await card.getByRole('heading', {name: 'production-alias', exact: true}).waitFor();
    await page.getByRole('tab').first().click();
    await card.getByRole('heading', {name: 'very-long-alias-'.repeat(12), exact: true}).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}x${viewport.height}: Light/Dark layout, timer, split/tab isolation, harness coexistence, stale clear and long alias (mocked IPC).`);
    await page.close();
  }
} finally {await browser.close();}
