const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');

const providers = [
  { id: 'codex', name: 'Codex', commands: ['codex'], paths: ['@openai/codex/'] },
  { id: 'claude', name: 'Claude Code', commands: ['claude', 'claude-code'], paths: ['@anthropic-ai/claude-code/'] },
  { id: 'bob', name: 'Bob', commands: ['bob', 'bob-shell'], paths: ['bobshell/'] },
  { id: 'gemini', name: 'Gemini CLI', commands: ['gemini'], paths: ['@google/gemini-cli/'] },
  { id: 'opencode', name: 'OpenCode', commands: ['opencode'], paths: ['opencode-ai/'] },
  { id: 'aider', name: 'Aider', commands: ['aider'], paths: ['aider-chat/'] },
  { id: 'goose', name: 'Goose', commands: ['goose'], paths: [] },
  { id: 'copilot', name: 'GitHub Copilot', commands: ['copilot'], paths: ['@github/copilot/'] },
  { id: 'cursor', name: 'Cursor Agent', commands: ['cursor-agent'], paths: ['@cursor/agent/'] },
  { id: 'amp', name: 'Amp', commands: ['amp'], paths: ['@sourcegraph/amp/'] },
  { id: 'cline', name: 'Cline', commands: ['cline'], paths: ['@cline/cli/'] },
  { id: 'droid', name: 'Droid', commands: ['droid'], paths: [] },
  { id: 'qwen', name: 'Qwen Code', commands: ['qwen'], paths: ['@qwen-code/qwen-code/'] },
  { id: 'continue', name: 'Continue', commands: ['cn'], paths: ['@continuedev/cli/'] },
  { id: 'pi', name: 'Pi', commands: ['pi'], paths: ['pi-coding-agent/'] },
  { id: 'openhands', name: 'OpenHands', commands: ['openhands'], paths: [] },
];

function words(command) {
  return (command.match(/"(?:\\.|[^"\\])*"|'[^']*'|\S+/g) || []).map(word => word.replace(/^(['"])(.*)\1$/, '$2'));
}
const safeModel = value => typeof value === 'string' && /^[\w][\w .:/@+-]{0,99}$/.test(value.trim()) ? value.trim() : null;
function modelFromArgs(command) {
  const args = words(command);
  // Python's -m selects a module, not an LLM.
  const start = /^python[\d.]*$/.test(path.basename(args[0] || '')) && args[1] === '-m' ? 3 : 1;
  for (let i = start; i < args.length; i++) {
    if (args[i] === '--') break;
    if (['--model', '-m'].includes(args[i])) return safeModel(args[i + 1]);
    if (args[i].startsWith('--model=')) return safeModel(args[i].slice(8));
    if (['-c', '--config'].includes(args[i]) && /^model=/.test(args[i + 1] || '')) return safeModel(args[i + 1].slice(6).replace(/^["']|["']$/g, ''));
  }
  return null;
}

function identifyHarness(command) {
  const args = words(command);
  if (!args.length) return null;
  const executable = path.basename(args[0]).replace(/\.(exe|cmd|cjs|mjs|js|py)$/i, '').toLowerCase();
  // Inspect only the executable / interpreter script, never prompts or arbitrary child arguments.
  const interpreter = /^(?:node(?:js)?|python[\d.]*|bun|deno|uvx)$/.test(executable);
  const script = interpreter ? args.slice(1).find(arg => !arg.startsWith('-')) || '' : args[0];
  const scriptName = path.basename(script).replace(/\.(exe|cmd|cjs|mjs|js|py)$/i, '').toLowerCase();
  const provider = providers.find(value => value.commands.includes(interpreter ? scriptName : executable) || interpreter && value.paths.some(marker => script.includes(marker)));
  if (provider) return {provider: provider.id, name: provider.name, model: modelFromArgs(command)};
  if (/^[a-z0-9][\w-]*-(?:agent|harness)$/.test(interpreter ? scriptName : executable)) {
    const name = (interpreter ? scriptName : executable).split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
    return {provider: 'custom', name: name.slice(0, 40), model: modelFromArgs(command)};
  }
  return null;
}

function parseProcessTable(output) {
  return output.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+([\d.,]+)\s+(.+)$/.exec(line);
    if (!match) return [];
    return [{pid: +match[1], ppid: +match[2], pgid: +match[3], foregroundGroup: +match[4], state: match[5], cpu: Number(match[6].replace(',', '.')), command: match[7]}];
  });
}

function findHarness(rootPid, processes) {
  const root = processes.find(process => process.pid === rootPid);
  if (!root) return null;
  const byParent = new Map();
  for (const process of processes) {
    if (!byParent.has(process.ppid)) byParent.set(process.ppid, []);
    byParent.get(process.ppid).push(process);
  }
  const queue = [{...root, depth: 0}], seen = new Set();
  const candidates = [];
  while (queue.length) {
    const process = queue.shift();
    if (seen.has(process.pid) || process.depth > 20) continue;
    seen.add(process.pid);
    if (!/[ZT]/.test(process.state)) {
      const identity = identifyHarness(process.command);
      const foreground = root.foregroundGroup > 0 ? process.pgid === root.foregroundGroup || process.state.includes('+') : true;
      if (identity && foreground) candidates.push({...identity, pid: process.pid, depth: process.depth});
    }
    for (const child of byParent.get(process.pid) || []) queue.push({...child, depth: process.depth + 1});
  }
  // Prefer the launched harness over one of its internal helper processes.
  return candidates.sort((a, b) => a.depth - b.depth)[0] || null;
}

function modelFromOutput(output, provider) {
  // TUI redraws position text without newlines; preserve those boundaries so
  // the footer is not glued to the preceding cell's text after stripping ANSI.
  const positioned = output.replace(/\x1b\[[\d;]*[HfGd]/g, ' ');
  const lines = stripVTControlCharacters(positioned).split(/[\r\n]/).slice(-90);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].replace(/^[\s│┃╭╰─•>*]+/, '').trim();
    const labeled = /^(?:model|using model|active model|selected model)\s*[:=]\s*["']?([\w][\w./:@+-]*)/i.exec(line);
    if (labeled) return safeModel(labeled[1]);
    if (provider === 'codex') {
      // Codex renders the live model in its footer, e.g. "GPT-6.1-Sol high · ~".
      // Require the footer separator so model names mentioned in prose are ignored.
      const footers = [...line.matchAll(/(?:^|[^\w-])((?:gpt-\d[\w.-]*|o[134](?:-[\w.-]+)?))\s+(?:(?:none|minimal|low|medium|high|xhigh|max|extra[- ]high)\s+)?[·•](?=\s|$)/gi)];
      if (footers.length) return safeModel(footers.at(-1)[1]);
    }
    if (provider === 'claude') {
      const pretty = /^(?:[✻✳*]\s*)?((?:Opus|Sonnet|Haiku)\s+\d+(?:[.-]\d+)*)(?:\s|$|[·|])/i.exec(line);
      if (pretty) return pretty[1];
    }
  }
  return null;
}

function statusFromOutput(text) {
  const activity = text.slice(-3500);
  if (/(?:waiting for (?:approval|permission)|permission required|trust this (?:folder|workspace)|do you (?:want to (?:allow|proceed)|trust)|allow (?:once|always|this command)|approve (?:this|the command)|yes, (?:proceed|allow))/i.test(activity)) return 'attention';
  if (/(?:esc(?:ape)? to (?:interrupt|cancel)|ctrl\+c to (?:interrupt|cancel)|(?:^|\n)\s*[✢✳✶✻✽⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏*·]*\s*(?:working|thinking|generating|compacting|reasoning)(?:\b|…))/i.test(activity)) return 'working';
  if (/(?:worked for\s+\d|task completed|waiting for (?:your )?(?:input|prompt)|ready for (?:your )?(?:input|prompt))/i.test(activity)) return 'ready';
  return null;
}

class AgentMonitor {
  constructor(emit, now = Date.now) {
    this.emit = emit; this.now = now; this.agent = null; this.raw = ''; this.lastEmitted = '';
    this.lastActivity = 0; this.bridge = false; this.lastBridge = ''; this.sample = '';
  }
  publish() {
    const value = JSON.stringify(this.agent);
    if (value !== this.lastEmitted) { this.lastEmitted = value; this.emit(this.agent ? {...this.agent} : null); }
  }
  setProcess(process) {
    if (this.bridge) return;
    if (!process) {
      if (this.agent) this.reset();
      return;
    }
    if (!this.agent || this.agent.pid !== process.pid) {
      this.agent = {provider: process.provider, name: process.name, model: process.model, modelSource: process.model ? 'argument' : null, status: 'running', activitySource: 'process', pid: process.pid, startedAt: this.now()};
      const plain = stripVTControlCharacters(this.raw);
      const model = modelFromOutput(plain, process.provider);
      if (model) { this.agent.model = model; this.agent.modelSource = 'reported'; }
      const status = statusFromOutput(plain);
      if (status) { this.agent.status = status; this.agent.activitySource = 'terminal'; this.lastActivity = this.now(); }
      this.publish();
    }
    this.tick();
  }
  observeInput(data) {
    if (!this.agent || this.bridge || !/[\r\n]/.test(data)) return;
    this.lastActivity = this.now(); this.agent.status = 'working'; this.agent.activitySource = 'terminal'; this.publish();
  }
  observeOutput(data) {
    this.raw = (this.raw + data).slice(-20000);
    const reports = [...this.raw.matchAll(/\x1b\]777;xterm-agent;([^\x07\x1b]{1,4096})(?:\x07|\x1b\\)/g)];
    if (reports.length) {
      const report = reports[reports.length - 1][1];
      if (report !== this.lastBridge) { this.lastBridge = report; this.acceptReport(report); }
    }
    if (!this.agent || this.bridge) return;
    const plain = stripVTControlCharacters(data).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    this.sample = (this.sample + plain).slice(-5000);
    const model = modelFromOutput(this.raw, this.agent.provider);
    if (model) { this.agent.model = model; this.agent.modelSource = 'reported'; }
    // Evaluate the newest output instead of retaining old "working" or permission prompts.
    const status = statusFromOutput(plain);
    if (status) { this.agent.status = status; this.agent.activitySource = 'terminal'; this.lastActivity = this.now(); }
    else if (this.agent.status === 'working' && plain.trim()) this.lastActivity = this.now();
    this.publish();
  }
  acceptReport(report) {
    let value;
    try { value = JSON.parse(report); } catch { return; }
    if (!value || typeof value !== 'object' || !['running', 'working', 'ready', 'attention', 'stopped'].includes(value.status)) return;
    if (value.status === 'stopped') { this.reset(); return; }
    if (typeof value.name !== 'string' || !/^[\w .+-]{1,40}$/.test(value.name)) return;
    this.bridge = true;
    this.agent = {provider: 'custom', name: value.name, model: safeModel(value.model), modelSource: safeModel(value.model) ? 'reported' : null, status: value.status, activitySource: 'reported', pid: this.agent?.pid || null, startedAt: this.agent?.startedAt || this.now()};
    this.publish();
  }
  tick() {
    if (!this.bridge && this.agent?.status === 'working' && this.now() - this.lastActivity > 4500) {
      this.agent.status = 'running'; this.agent.activitySource = 'process'; this.publish();
    }
  }
  reset() {
    this.agent = null; this.raw = ''; this.sample = ''; this.bridge = false; this.lastBridge = ''; this.publish();
  }
}

module.exports = {providers, identifyHarness, modelFromArgs, parseProcessTable, findHarness, modelFromOutput, statusFromOutput, AgentMonitor};
