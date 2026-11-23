const {test} = require('node:test');
const assert = require('node:assert/strict');
const {identifyHarness, modelFromArgs, parseProcessTable, findHarness, modelFromOutput, AgentMonitor} = require('../electron/agents.cjs');

test('identify native and interpreted harnesses without matching text in prompts', () => {
  for (const [command, expected] of [
    ['/Users/me/.local/bin/codex --model gpt-6.2', 'codex'],
    ['claude --model claude-sonnet-4-6', 'claude'],
    ['node /opt/homebrew/lib/node_modules/bobshell/dist/bob.js chat', 'bob'],
    ['node /opt/homebrew/bin/bob', 'bob'],
    ['node /usr/lib/node_modules/@google/gemini-cli/dist/index.js', 'gemini'],
    ['opencode --model provider/model', 'opencode'],
    ['python /home/me/bin/aider --model model-a', 'aider'],
    ['/usr/bin/my-harness --model local/model', 'custom'],
  ]) assert.equal(identifyHarness(command)?.provider, expected, command);
  assert.equal(identifyHarness('node server.js --prompt "please use codex"'), null);
  assert.equal(identifyHarness('echo claude --model secret'), null);
  assert.equal(identifyHarness('zsh -c codex'), null);
});

test('read only explicitly supplied model arguments', () => {
  assert.equal(modelFromArgs('codex -m gpt-6.2'), 'gpt-6.2');
  assert.equal(modelFromArgs('claude --model=claude-opus-4-6'), 'claude-opus-4-6');
  assert.equal(modelFromArgs("codex -c 'model=\"gpt-6\"'"), 'gpt-6');
  assert.equal(modelFromArgs('codex -- prompt --model example'), null);
  assert.equal(modelFromArgs('bob chat'), null);
  assert.equal(modelFromArgs('python -m aider'), null);
  assert.equal(modelFromArgs('python -m aider --model provider/real-model'), 'provider/real-model');
  assert.equal(modelFromArgs('codex --model "bad\x1b[31mvalue"'), null);
});

test('process monitoring stays within this terminal foreground process tree', () => {
  const table = parseProcessTable([
    '100 1 100 200 Ss 0.0 /bin/zsh -l -i',
    '200 100 200 200 S+ 1.0 /usr/local/bin/codex -m gpt-test',
    '201 200 200 200 S+ 0.0 codex app-server',
    '202 200 200 200 S+ 0.0 /bin/bash -c true',
    '210 100 210 200 S 0.0 claude --model background',
    '300 1 300 300 S+ 0.0 claude --model unrelated',
  ].join('\n'));
  const result = findHarness(100, table);
  assert.equal(result.provider, 'codex'); assert.equal(result.pid, 200); assert.equal(result.model, 'gpt-test');
  assert.equal(findHarness(999, table), null);
  assert.equal(findHarness(100, table.filter(row => ![200,201,202].includes(row.pid))), null);
  const direct = parseProcessTable('400 1 400 400 S+ 0.0 codex --model direct-model');
  assert.equal(findHarness(400, direct).model, 'direct-model', 'exec codex can replace the root shell');
});

test('detect model headers, not model names mentioned in arbitrary output', () => {
  assert.equal(modelFromOutput('│ model: gpt-6.2 high /model to change', 'codex'), 'gpt-6.2');
  assert.equal(modelFromOutput('✻ Opus 4.6 · Claude Max', 'claude'), 'Opus 4.6');
  assert.equal(modelFromOutput('model: old\nmodel: new', 'codex'), 'new');
  assert.equal(modelFromOutput('Consider gpt-6.2 or Claude for this task', 'codex'), null);
});

test('read the live Codex footer model shown in the reported screenshots', () => {
  assert.equal(modelFromOutput('GPT-6.1-Sol high · ~', 'codex'), 'GPT-6.1-Sol');
  assert.equal(modelFromOutput('  GPT-6.1-Sol high · ~ · List files', 'codex'), 'GPT-6.1-Sol');
  assert.equal(modelFromOutput('\x1b[25;2H\x1b[38;5;214mGPT-6.1-Sol\x1b[0m high · ~', 'codex'), 'GPT-6.1-Sol');
  assert.equal(modelFromOutput('Some preceding output\x1b[25;2HGPT-6.1-Sol\x1b[25;15Ghigh\x1b[25;22G· ~', 'codex'), 'GPT-6.1-Sol');
  assert.equal(modelFromOutput('GPT-6.1-Sol high · ~\x1b[2K\rGPT-6.2 medium · ~/project', 'codex'), 'GPT-6.2');
  assert.equal(modelFromOutput('Use GPT-6.1-Sol to solve this problem.', 'codex'), null);
  assert.equal(modelFromOutput('GPT-6.1-Sol high · ~', 'claude'), null);
});

test('Codex footer detection survives arbitrary PTY chunk boundaries and model changes', () => {
  const footer = '\x1b[20;1H\x1b[33mGPT-6.1-Sol\x1b[0m high · ~';
  for (let size = 1; size <= footer.length; size++) {
    const monitor = new AgentMonitor(() => {});
    monitor.setProcess({pid:42, provider:'codex', name:'Codex', model:null});
    for (let offset = 0; offset < footer.length; offset += size) monitor.observeOutput(footer.slice(offset,offset+size));
    assert.equal(monitor.agent.model, 'GPT-6.1-Sol');
    monitor.observeOutput('\r\x1b[2KGPT-6.2 high · ~');
    assert.equal(monitor.agent.model, 'GPT-6.2');
  }
});

test('agent lifecycle reports model and activity, then clears on shell return', () => {
  let now = 1000; const emitted = [];
  const monitor = new AgentMonitor(value => emitted.push(value), () => now);
  monitor.observeOutput('\x1b[36m│ model: gpt-live\x1b[0m\r\n');
  monitor.setProcess({pid: 200, provider: 'codex', name: 'Codex', model: 'gpt-launch'});
  assert.equal(monitor.agent.model, 'gpt-live');
  assert.equal(monitor.agent.modelSource, 'reported');
  const started = monitor.agent.startedAt;
  monitor.observeInput('do a task\r'); assert.equal(monitor.agent.status, 'working');
  now = 2000; monitor.observeOutput('Working (esc to interrupt)');
  assert.equal(monitor.agent.status, 'working');
  monitor.observeOutput('\r\nWaiting for approval'); assert.equal(monitor.agent.status, 'attention');
  monitor.observeOutput('\r\nTask completed'); assert.equal(monitor.agent.status, 'ready');
  monitor.observeInput('next task\r'); now = 8000; monitor.tick();
  assert.equal(monitor.agent.status, 'running', 'silence is not reported as certain waiting or thinking');
  assert.equal(monitor.agent.startedAt, started);
  monitor.setProcess(null); assert.equal(monitor.agent, null); assert.equal(emitted.at(-1), null);
});

test('custom harness protocol handles fragmented reports and validates payloads', () => {
  const monitor = new AgentMonitor(() => {});
  const report = '\x1b]777;xterm-agent;{"name":"My Agent","model":"local/model","status":"working"}\x07';
  for (const character of report) monitor.observeOutput(character);
  assert.equal(monitor.agent.name, 'My Agent'); assert.equal(monitor.agent.model, 'local/model');
  assert.equal(monitor.agent.activitySource, 'reported');
  monitor.setProcess(null); assert.equal(monitor.agent.status, 'working', 'explicit reports support unknown harnesses');
  monitor.observeOutput('\x1b]777;xterm-agent;{"name":"<script>","status":"ready"}\x07');
  assert.equal(monitor.agent.name, 'My Agent');
  monitor.observeOutput('\x1b]777;xterm-agent;{"status":"stopped"}\x07'); assert.equal(monitor.agent, null);
});

test('independent terminal monitors cannot leak models or status across sessions', () => {
  const first = new AgentMonitor(() => {}), second = new AgentMonitor(() => {});
  first.setProcess({pid: 1, provider: 'codex', name: 'Codex', model: 'model-one'});
  second.setProcess({pid: 2, provider: 'claude', name: 'Claude Code', model: 'model-two'});
  first.observeInput('task\r'); first.reset();
  assert.equal(second.agent.name, 'Claude Code'); assert.equal(second.agent.status, 'running');
  assert.equal(second.agent.model, 'model-two');
});

test('rendered terminal footer resolves models split apart by TUI cursor drawing',()=>{
  const monitor=new AgentMonitor(()=>{});
  monitor.setProcess({pid:1,provider:'codex',name:'Codex',model:null});
  monitor.observeOutput('G\x1b[1;2HP\x1b[1;3HT\x1b[1;4H-\x1b[1;5H6');
  assert.equal(monitor.agent.model,null);
  monitor.observeScreen('Ask Codex to do anything\nGPT-6.1-Sol high · ~/project');
  assert.equal(monitor.agent.model,'GPT-6.1-Sol');
  monitor.observeScreen('Ask Codex to do anything\nGPT-6.2 high · ~/project');
  assert.equal(monitor.agent.model,'GPT-6.2');
  monitor.reset(); assert.equal(monitor.agent,null); assert.equal(monitor.screen,'');
});

test('screen reports do not create agents or cross terminal boundaries',()=>{
  const first=new AgentMonitor(()=>{}),second=new AgentMonitor(()=>{});
  first.observeScreen('GPT-6.1-Sol high · ~'); assert.equal(first.agent,null);
  first.setProcess({pid:42,provider:'codex',name:'Codex',model:null});
  assert.equal(first.agent.model,'GPT-6.1-Sol'); assert.equal(second.agent,null);
});
