import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const harness = fileURLToPath(new URL('../tests/fixtures/codex.cjs', import.meta.url));
const home = await mkdtemp(path.join(os.tmpdir(), 'xterm-explorer-test-'));
const filename = "notes with 'spaces'.txt";
const file = path.join(home, filename);
const dockerfile = path.join(home, 'Dockerfile');
const text = Array.from({length: 120}, (_, index) => `ROW_${String(index + 1).padStart(3, '0')}`).join('\n') + '\n';
const shell = process.env.XTERM_TEST_SHELL || '/bin/bash';
let application;

try {
  await Promise.all([
    writeFile(path.join(home, '.bash_profile'), "PS1='EXPLORER_PROMPT> '\n"),
    writeFile(path.join(home, '.zshrc'), "PROMPT='EXPLORER_PROMPT> '\n"),
    writeFile(path.join(home, 'binary.dat'), Buffer.from([0, 255, 0, 128])),
    writeFile(dockerfile, 'FROM scratch\n'),
    writeFile(file, text),
  ]);
  application = await electron.launch({
    args: [`--user-data-dir=${path.join(home, 'user-data')}`, root],
    cwd: home,
    env: {...process.env, HOME: home, ZDOTDIR: home, XDG_CONFIG_HOME: home, SHELL: shell,
      XTERM_DEV_URL: '', ELECTRON_RUN_AS_NODE: '', VIMINIT: '', EXINIT: ''},
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const tabs = page.getByRole('tab');
  const input = page.locator('.terminal-pane:visible .xterm-helper-textarea');
  const screen = page.locator('.terminal-pane:visible .xterm-rows');
  const save = page.getByRole('button', {name: 'Save', exact: true});
  const open = name => page.locator('.file-row').filter({has: page.getByText(name, {exact: true})}).click();
  const untilScreen = pattern => page.waitForFunction(({source}) =>
    new RegExp(source).test([...document.querySelectorAll('.xterm-rows')]
      .find(rows => rows.getBoundingClientRect().height)?.textContent || ''), {source: pattern.source});
  const keys = text => input.pressSequentially(text);
  const enter = () => input.press('Enter');
  const escape = () => input.press('Escape');
  const edit = async text => { await keys('i'); await keys(text); };
  const ex = async command => { await escape(); await keys(command); await enter(); };

  await page.getByText('Session connected', {exact: true}).waitFor();
  await untilScreen(/EXPLORER_PROMPT>/);
  await open('binary.dat');
  await open(filename);
  await untilScreen(/\b1\s+ROW_001/);
  assert.equal(await tabs.count(), 1, 'An idle shell should reuse its existing pane');
  assert.equal(await save.count(), 0);

  const viewport = await screen.boundingBox();
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, 680);
  await untilScreen(/^\s*(?:[2-9]|[1-9][0-9]+)\s+ROW_/);
  await keys('gg');
  await untilScreen(/\b1\s+ROW_001/);

  await edit('Saved from Explorer ');
  await save.waitFor();
  await save.click();
  await save.waitFor({state: 'hidden'});
  assert.match(await readFile(file, 'utf8'), /^Saved from Explorer ROW_001/);
  await untilScreen(/INSERT/);

  await ex(':set readonly');
  await edit('pending ');
  await save.waitFor();
  await save.click();
  await page.getByRole('status').filter({hasText: /readonly/i}).waitFor();
  assert.equal(await save.count(), 1);
  assert.doesNotMatch(await readFile(file, 'utf8'), /pending /);
  await ex(':set noreadonly');
  await ex(':w');
  await save.waitFor({state: 'hidden'});
  assert.match(await readFile(file, 'utf8'), /pending /);

  await edit('first buffer ');
  await save.waitFor();
  await open('Dockerfile');
  await untilScreen(/\b1\s+FROM scratch/);
  assert.equal(await tabs.count(), 2);
  await edit('# second buffer ');
  await save.waitFor();
  await save.click();
  await save.waitFor({state: 'hidden'});
  assert.match(await readFile(dockerfile, 'utf8'), /^# second buffer FROM scratch/);
  assert.doesNotMatch(await readFile(file, 'utf8'), /first buffer /);
  await tabs.first().click();
  await save.click();
  await save.waitFor({state: 'hidden'});
  assert.match(await readFile(file, 'utf8'), /first buffer /);
  await ex(':q');
  await untilScreen(/EXPLORER_PROMPT>/);
  await tabs.nth(1).getByRole('button', {name: 'Close tab'}).click();

  await keys("node '" + harness.replaceAll("'", "'\\''") + "'");
  await enter();
  await page.getByLabel('Codex harness activity').waitFor();
  await open('Dockerfile');
  await untilScreen(/\b1\s+# second buffer FROM scratch/);
  assert.equal(await tabs.count(), 2, 'An active harness should get a separate editor tab');
  await tabs.first().click();
  await page.getByLabel('Codex harness activity').waitFor();
  await untilScreen(/Local Codex rendering fixture/);
  await input.press('Control+c');
  await untilScreen(/EXPLORER_PROMPT>/);
  assert.deepEqual(errors, []);
  console.log(`Explorer vi verified with ${shell}: routing, line numbers, scrolling, per-session saves and write failures.`);
} finally {
  await application?.close();
  await rm(home, {recursive: true, force: true});
}
