const path = require('node:path');
const fsp = require('node:fs/promises');

async function listDirectory(cwd, io = fsp) {
  const all = await io.readdir(cwd, {withFileTypes:true});
  all.sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  // Directory entries already provide type information. Do not stat children or
  // follow symlinks here: a home-folder listing must not touch protected targets.
  const entries = all.slice(0,1000).map(entry => ({
    name:entry.name, path:path.join(cwd,entry.name), directory:entry.isDirectory(),
    symlink:entry.isSymbolicLink(), size:null, modified:null, hidden:entry.name.startsWith('.'),
  }));
  return {cwd, parent:path.dirname(cwd), entries, total:all.length};
}

async function fileDetails(value, io = fsp) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('The path must be absolute.');
  const stat = await io.lstat(value);
  return {size:stat.isFile() ? stat.size : null, modified:stat.mtime.toISOString()};
}

// Following a link is deferred until the user explicitly opens it.
async function resolveLink(value, io = fsp) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('The path must be absolute.');
  const stat = await io.stat(value);
  return {directory:stat.isDirectory(), path:stat.isDirectory() ? await io.realpath(value) : value};
}

async function isTextFile(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('The path must be absolute.');
  if (!(await fsp.stat(value)).isFile()) return false;
  const file = await fsp.open(value, fsp.constants.O_RDONLY | fsp.constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) return false;
    const sample = Buffer.alloc(8192);
    const {bytesRead} = await file.read(sample, 0, sample.length, 0);
    const bom = sample.readUInt16BE(0);
    const encoding = bom === 0xfeff ? 'utf-16be' : bom === 0xfffe ? 'utf-16le' : 'utf-8';
    try {
      const text = new TextDecoder(encoding, {fatal: true}).decode(sample.subarray(0, bytesRead), {stream: bytesRead === sample.length});
      return !/[\x00-\x08\x0e-\x1a\x1c-\x1f\x7f]/.test(text);
    } catch { return false; }
  } finally { await file.close(); }
}

module.exports = {listDirectory, fileDetails, resolveLink, isTextFile};
