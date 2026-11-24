import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const asset = new URL('../src/assets/bob-standing-BECrMjXJ.webp', import.meta.url);
try {
  const bytes = await readFile(asset);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error('The local file is not a complete WebP container.');
  }
  console.log(`Local WebP: ${bytes.length} bytes`);
  console.log(`SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);
  console.log('Still verify IBM provenance, packaged offline rendering, and compact/expanded Light/Dark appearance.');
} catch (error) {
  console.error(error.code === 'ENOENT'
    ? 'BLOCKED: official IBM Bob artwork is missing. Issue #4 offline acceptance is unmet.'
    : `BLOCKED: ${error.message}`);
  process.exitCode = 1;
}
