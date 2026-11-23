const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
const reportCwd = [
  '_xterm_report_cwd() {',
  '  local xterm_path="$PWD"',
  '  xterm_path="${xterm_path//\\%/%25}"',
  '  xterm_path="${xterm_path// /%20}"',
  "  xterm_path=\"${xterm_path//$'\\n'/%0A}\"",
  "  xterm_path=\"${xterm_path//$'\\r'/%0D}\"",
  "  xterm_path=\"${xterm_path//$'\\a'/%07}\"",
  "  xterm_path=\"${xterm_path//$'\\e'/%1B}\"",
  "  printf '\\033]7;file://localhost%s\\007' \"$xterm_path\"",
  '}',
].join('\n');

// Temporary startup files preserve the user's configuration and add OSC 7 cwd reporting.
// No files in the user's shell configuration are modified.
function createShellIntegration(shell, env = process.env) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xterm-shell-'));
  const home = env.HOME || os.homedir();
  const original = env.ZDOTDIR || home;
  const name = path.basename(shell);
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 });
  if (name === 'zsh') {
    const source = file => `ZDOTDIR=${quote(original)}\n[[ -f ${quote(path.join(original, file))} ]] && source ${quote(path.join(original, file))}\nZDOTDIR=${quote(directory)}\n`;
    fs.writeFileSync(path.join(directory, '.zshenv'), source('.zshenv'));
    fs.writeFileSync(path.join(directory, '.zprofile'), source('.zprofile'));
    fs.writeFileSync(path.join(directory, '.zshrc'), source('.zshrc') + `
autoload -Uz add-zsh-hook
${reportCwd}
_xterm_prompt_ready() { _xterm_report_cwd; printf '\\033]133;A\\007'; }
_xterm_preexec() { printf '\\033]133;C\\007'; }
add-zsh-hook precmd _xterm_prompt_ready
add-zsh-hook chpwd _xterm_report_cwd
add-zsh-hook preexec _xterm_preexec
`);
    fs.writeFileSync(path.join(directory, '.zlogin'), source('.zlogin') + (env.ZDOTDIR ? `export ZDOTDIR=${quote(original)}\n` : 'unset ZDOTDIR\n'));
    return { args: ['-l', '-i'], env: { ZDOTDIR: directory }, cleanup };
  }
  if (name === 'bash') {
    const rc = path.join(directory, 'bashrc');
    fs.writeFileSync(rc, `
if [ -f /etc/profile ]; then source /etc/profile; fi
if [ -f "$HOME/.bash_profile" ]; then source "$HOME/.bash_profile";
elif [ -f "$HOME/.bash_login" ]; then source "$HOME/.bash_login";
elif [ -f "$HOME/.profile" ]; then source "$HOME/.profile";
elif [ -f "$HOME/.bashrc" ]; then source "$HOME/.bashrc"; fi
${reportCwd}
_xterm_prompt_ready() { _xterm_report_cwd; printf '\\033]133;A\\007'; }
if declare -p PROMPT_COMMAND 2>/dev/null | command grep -q 'declare -a'; then
  PROMPT_COMMAND=(_xterm_prompt_ready "\${PROMPT_COMMAND[@]}")
else
  PROMPT_COMMAND="_xterm_prompt_ready; \${PROMPT_COMMAND:-:}"
fi
`);
    return { args: ['--rcfile', rc, '-i'], env: {}, cleanup };
  }
  cleanup();
  return { args: [], env: {}, cleanup() {} };
}

class CwdTracker {
  constructor(callback, activity = () => {}) { this.pending = ''; this.callback = callback; this.activity = activity; }
  push(data) {
    this.pending = (this.pending + data).slice(-65536);
    const pattern = /\x1b\](?:7;file:\/\/[^/]*(\/[^\x07\x1b]*)|133;([AC]))(?:\x07|\x1b\\)/g;
    let match;
    let consumed = 0;
    while ((match = pattern.exec(this.pending))) {
      try {
        if (match[1]) this.callback(decodeURIComponent(match[1]));
        else this.activity(match[2] === 'A');
      } catch { /* Ignore malformed OSC. */ }
      consumed = pattern.lastIndex;
    }
    if (consumed) this.pending = this.pending.slice(consumed);
    else {
      const start = this.pending.lastIndexOf('\x1b]');
      this.pending = start >= 0 ? this.pending.slice(start) : this.pending.slice(-8);
    }
  }
}

module.exports = { createShellIntegration, CwdTracker, quote };
