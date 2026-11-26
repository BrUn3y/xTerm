const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');

const exec = promisify(execFile);
let editorPath;

async function findVi() {
  if (editorPath) return editorPath;
  const windows = process.platform === 'win32';
  const directories = (process.env.PATH || '').split(path.delimiter).filter(directory => path.isAbsolute(directory));
  if (!windows) directories.push('/usr/bin', '/bin');
  for (const name of windows ? ['vi.exe', 'vim.exe'] : ['vi', 'vim']) {
    for (const directory of new Set(directories)) {
      const executable = path.join(directory, name);
      try {
        const {stdout} = await exec(executable, ['--version'], {timeout: 1500, windowsHide: true});
        if (stdout.startsWith('VIM - Vi IMproved') && /\+timers\b/.test(stdout)) {
          editorPath = executable;
          return executable;
        }
      } catch { /* Try the next PATH entry. */ }
    }
  }
  throw new Error('Opening files in vi requires a Vim build with timer support on PATH.');
}

async function createEditor(file) {
  const executable = await findVi();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xterm-vi-'));
  const script = path.join(directory, 'explorer.vim');
  try {
    await fs.writeFile(script, await fs.readFile(path.join(__dirname, 'explorer.vim')));
  } catch (error) {
    await fs.rm(directory, {recursive: true, force: true});
    throw error;
  }

  let closed = false;
  let dirty;
  let timer;
  let pending;
  let request = 0;

  function finishSave(error) {
    if (!pending) return;
    const {resolve, reject, timeout} = pending;
    pending = undefined;
    clearTimeout(timeout);
    if (error) reject(new Error(error));
    else resolve();
  }

  function observe(onChange) {
    async function poll() {
      let state;
      try { state = JSON.parse(await fs.readFile(path.join(directory, 'state'), 'utf8')); }
      catch { /* Vim has not started or is updating the state file. */ }
      if (closed) return;
      if (state) {
        if (dirty !== state.dirty) {
          dirty = state.dirty;
          onChange({path: file, dirty});
        }
        if (pending && state.request === request) finishSave(state.error);
      }
      timer = setTimeout(poll, 100);
    }
    void poll();
  }

  function save() {
    if (closed || dirty === undefined) throw new Error('vi is no longer editing this file.');
    if (pending) return pending.promise;
    const id = ++request;
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    const timeout = setTimeout(() => finishSave('vi did not respond. Check the terminal for a prompt and try again.'), 5000);
    pending = {promise, resolve, reject, timeout};
    // Replace the request in one step so Vim never reads a partial request ID.
    const draft = path.join(directory, `save-${id}`);
    void fs.writeFile(draft, String(id)).then(() => fs.rename(draft, path.join(directory, 'save'))).catch(() => {
      if (request === id) finishSave('Could not send the save request to vi.');
    });
    return promise;
  }

  function close() {
    closed = true;
    clearTimeout(timer);
    finishSave('vi closed before saving the file.');
    return fs.rm(directory, {recursive: true, force: true}).catch(() => {});
  }

  return {file, executable, args: ['-N', '-S', script, '--', file], observe, save, close};
}

module.exports = {createEditor};
