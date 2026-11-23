// Reproduces the reported Codex footer and ANSI panels locally; no LLM or network calls.
process.stdin.setRawMode?.(true); process.stdin.resume();
process.stdout.write('\x1b[2J\x1b[HLocal Codex rendering fixture (no model requests).\r\n\r\n');
process.stdout.write('\x1b[48;2;38;38;38m\x1b[38;2;230;230;230m RGB PANEL — Ask Codex to do anything                         \x1b[0m\r\n');
process.stdout.write('\x1b[48;5;235m\x1b[38;5;255m INDEXED PANEL — Readable text                                \x1b[0m\r\n');
process.stdout.write('\x1b[40m\x1b[37m ANSI PANEL — Readable text                                   \x1b[0m\r\n');
process.stdout.write('\x1b[48;2;6;95;70m\x1b[97m SEMANTIC GREEN — Preserve this color                         \x1b[0m\r\n\r\n');
process.stdout.write('\x1b[33mGPT-6.1-Sol\x1b[0m high · ~\r\nWaiting for input\r\n');
let query='';
process.stdin.on('data', data => {
  if (data.includes(3)) process.exit(0);
  query += data.toString();
  if (/\x1b\]11;rgb:[\da-f/]+(?:\x07|\x1b\\)/i.test(query)) {
    process.stdout.write('BACKGROUND_QUERY=' + query.replace(/[\x00-\x1f]/g,'') + '\r\n');query='';
  }
});
setTimeout(()=>process.stdout.write('\x1b]11;?\x07'),150);
