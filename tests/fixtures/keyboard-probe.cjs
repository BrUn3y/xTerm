// Protocol/transport fixture, not a coding harness.
const mode = process.argv[2] || '1';
process.stdin.setRawMode(true);
process.stdin.resume();
const modes = {
  nested: '\x1b[>1u\x1b[>0u\x1b[<u',
  cleared: '\x1b[>1u\x1b[<u',
  set: '\x1b[=1u',
  unset: '\x1b[=1u\x1b[=1;3u',
  alternate: '\x1b[>1u\x1b[?1049h',
  restored: '\x1b[>1u\x1b[?1049h\x1b[>0u\x1b[?1049l',
  reset: '\x1b[>1u\x1bc',
  restoreSet: '\x1b[=1u\x1b[>0u\x1b[<u',
  restoreNestedSet: '\x1b[>1u\x1b[=7u\x1b[>0u\x1b[<u',
  overPop: '\x1b[>1u\x1b[>7u\x1b[<3u',
};
process.stdout.write(`${modes[mode] ?? `\x1b[>${mode}u`}\x1b[?u\r\nPROBE_READY\r\n`);
process.stdin.on('data', data => {
  process.stdout.write(`\r\nBYTES:${data.toString('hex')}\r\n`);
  if (data.includes(3)) {
    process.stdout.write('\x1b[<u');
    process.exit(0);
  }
});
