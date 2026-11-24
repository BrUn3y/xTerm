# Clipboard Paste Validation (Issue #15)

## Behavior

Cmd+V, Cmd+Shift+V and Ctrl+Shift+V are terminal text-paste shortcuts.
They read plain text through a narrow Electron IPC bridge and call the public
xterm.js `terminal.paste()` API. This preserves newline normalization and
bracketed paste when the foreground application enables it.

The shortcut cancels the native default action to prevent duplicate insertion.
Its keypress and keyup are reserved so a negotiated Kitty V event cannot also
reach the harness. Ctrl+V remains a process key, including image-paste actions
implemented by coding harnesses. Empty or image-only clipboards insert no text.
Edit > Paste and native text fields keep their existing behavior.

Late clipboard reads are discarded if the terminal is disposed, hidden,
no longer running or no longer focused. Read failures show an error
without sending a V shortcut to the process.

## Evidence

Validated on November 24, 2026, in Linux x64 with Electron 45.4.1,
node-pty 1.1.0 and xterm.js 6.1.0-beta.339:

- Baseline v0.5.0: Ctrl+Shift+V emits CSI 118;6u with Kitty mode enabled,
  instead of inserting copied text. This is an image shortcut in Codex.
- Fixed: actual Electron clipboard, renderer, IPC and PTY receive exactly one
  text paste, with no V event, in legacy and negotiated Kitty modes.
- Coverage includes multiline and Unicode text, empty and image-only
  clipboards, native Edit > Paste, Ctrl+V passthrough, all-key press/release,
  independent panes, delayed/failing reads and native text-field paste.
- Actual Codex CLI 0.159.3 accepts clipboard text and multiline paste into its
  editable composer without an image error or request before Enter. Enter
  submits the complete edited input to an isolated loopback HTTP server that
  intentionally rejects requests. No model runs, and no user credentials or
  configuration are changed.
- Unit tests: 50 passed. Native PTY tests: 4 passed. Production build and the
  existing keyboard/stack-restoration regression tests passed.

## Commands

```sh
npm test
npm run build
npm run test:pty
npm run test:clipboard-desktop
XTERM_TEST_CODEX=1 XTERM_TEST_STACK_RESTORE=1 npm run test:keyboard-desktop
```

Native tests require a display and installed Electron/node-pty dependencies.
On headless Linux, run the native commands under `xvfb-run -a`.
The optional Codex test needs an installed `codex` executable.

The baseline reproduction uses the test script from this branch with an
unmodified, installed and built v0.5.0 application:

```sh
XTERM_EXPECT_CLIPBOARD_BUG=1 XTERM_TEST_APP_ROOT=/absolute/path/to/baseline \
  npm run test:clipboard-desktop
```

The Clipboard Regression workflow runs unit/build and native clipboard checks
on macOS and Linux. Physical macOS keyboard/menu acceleration, the reported
user's installed Codex version, Windows and other coding harnesses have not
been validated locally. The exact shortcut in the report was not specified.
