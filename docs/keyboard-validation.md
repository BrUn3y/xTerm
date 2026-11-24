# Shift+Enter Validation (Issue #2)

This is not a universal Shift+Enter remapping. The pinned terminal core is a
prerelease; physical macOS keyboard and IME validation remains outstanding.

## Implementation

xterm.js 6.0.0 encodes both Enter and Shift+Enter as CR. The preload and main
process already forward terminal.onData strings unchanged to node-pty.

Pin the upstream implementation to @xterm/xterm 6.1.0-beta.339 and enable
vtExtensions.kittyKeyboard for each Terminal instance. Applications explicitly
request enhanced input through CSI query/set/push/pop; no name-based harness
heuristics, assumed newline sequences, shell configuration changes or IPC
conversion are used. Unnegotiated applications retain legacy input.

The custom app-shortcut handler now reserves matching keypress/keyup events as
well as keydown. Otherwise enabling release reporting leaked consumed shortcuts
to the PTY. Ordinary keys, Enter variants and Ctrl+C remain delegated to xterm.js.

The latest stable package at validation time (2026-11-24) is 6.0.0. The beta is an
explicit release risk, not a stable upgrade. Its npm gitHead is
eefaadc7787f5b1c95c22867d02e4074e91f93c9. No vendored keyboard implementation.

## Real Harness Evidence

Environment: xTerm 0.4.0, Electron 45.4.1, node-pty 1.1.0, Debian 13.7,
Linux 6.18.60 x86_64. Actual Codex CLI 0.159.3 executable, no daemon, read-only
sandbox, empty workspace and isolated CODEX_HOME. No user auth/config changes.

Baseline: unmodified origin/main a12132d, xterm.js 6.0.0. The real Codex TUI
requests CSI >7u; Shift+Enter submits the first line to the local test server.

Fixed: Codex TUI with xterm.js 6.1.0-beta.339. Shift+Enter inserts a second
editable line; the first line is edited with Up/End and the second with
Backspace. No request occurs before Enter. Enter submits both edited lines as
one input to a loopback HTTP server that intentionally returns HTTP 400.
No model response, model execution or agent task is involved.

This uses keyboard automation against a real native Electron app, actual PTY
and actual coding harness, not the demo-harness/probe fixture. It is still not
physical keyboard or packaged macOS evidence. Claude Code 2.1.321 and Bob 2.1.0
are installed but their multiline behavior has not been validated.

## Commands

```sh
npm test
npm run build
npm run test:pty
npm run test:keyboard-desktop
XTERM_TEST_APPS=1 XTERM_TEST_CODEX=1 npm run test:keyboard-desktop
XTERM_TEST_SHELL=/bin/zsh XTERM_TEST_APPS=1 npm run test:keyboard-desktop
npm run test:keyboard-stack
```

Native tests require a display, Electron/node-pty installation and Playwright
(development-only). Root runs use --no-sandbox for the Electron process while
retaining sandbox/context isolation in the renderer. App checks use a fresh
HOME; they require vim.tiny/top when XTERM_TEST_APPS=1 and codex when
XTERM_TEST_CODEX=1. Those optional checks fail if executables are missing.

The baseline can be verified in a disposable archive of main with its own
dependencies/build, running this branch's test script from that directory:

```sh
XTERM_EXPECT_LEGACY=1 XTERM_TEST_CODEX=1 \
  node /absolute/path/to/issue-branch/scripts/test-keyboard-desktop.mjs
```

The keyboard-probe fixture verifies bytes/protocol only. It does not establish
coding-harness multiline acceptance. The existing test:pty harness fixture
likewise proves process detection, not real coding-harness input behavior.

## Results And Required Gate

- Unit tests: 28 passed, none skipped after installing zsh 5.9.
- Production TypeScript/Vite build: passed.
- test:pty: 3 passed, none skipped (zsh/bash plus detection fixture).
- Native bash/zsh commands, Ctrl+C, Vim 9.1 tiny (-N), top exit: passed.
- Query/set/unset, nested push/pop, reset, alternate screen restore, all-key
  press/release, reserved shortcuts and independent panes: covered by native
  protocol tests and passed for the main validation paths.
- Real Codex baseline/fixed comparison: passed as described above.
- The initial test:keyboard-stack expectation was incorrect, not an upstream
  defect. The official Kitty protocol explicitly requires resetting all flags
  when a pop empties the stack. Consequently CSI =1u / CSI >0u / CSI <u must
  produce legacy CR for Shift+Enter.
- The corrected required gate retains the empty-stack case and adds restoration
  after set with a nonempty outer stack, plus a pop beyond the stack depth.
  No upstream code, keyboard byte conversion or protocol implementation changed.

Protocol source:
https://github.com/kovidgoyal/kitty/blob/master/docs/keyboard-protocol.rst
(Progressive enhancement, push/pop and independent screen stacks).

Remaining: original user's harness/version, physical and packaged Apple Silicon
macOS keyboard behavior, IME/dead-key and menu accelerator checks, additional
compatible harnesses and multiplexers (including modifyOtherKeys-only clients).
This implementation enables Kitty, not universal modifyOtherKeys support.
