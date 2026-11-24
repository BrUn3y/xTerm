import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const asset = new URL('../src/assets/bob-standing-BECrMjXJ.webp', import.meta.url);
const expected = '509de4ef3bd4dad1bb8fe4f817c7db9607d33cd143b50c466c5b9b5b7ad244fc';
try {
  const bytes = await readFile(asset);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error('The local file is not a complete WebP container.');
  }
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== expected) throw new Error('Artwork differs from the IBM source recorded in src/assets/NOTICE.md.');
  console.log(`PASS bundled IBM WebP: ${bytes.length} bytes; SHA-256: ${checksum}`);
} catch (error) {
  console.error(error.code === 'ENOENT'
    ? 'FAIL: bundled IBM Bob artwork is missing.'
    : `FAIL: ${error.message}`);
  process.exitCode = 1;
}
