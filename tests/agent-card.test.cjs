const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {renderToStaticMarkup} = require('react-dom/server');
const {createElement} = require('react');

test('AgentCard selects local Bob artwork or honestly retains the existing monogram', async () => {
  const {createServer} = await import('vite');
  const server = await createServer({
    server: {middlewareMode: true}, appType: 'custom',
    optimizeDeps: {noDiscovery: true, include: []},
  });
  try {
    const {default: AgentCard} = await server.ssrLoadModule('/src/components/AgentCard.tsx');
    const base = {name: 'Bob', provider: 'bob', model: null, modelSource: null,
      status: 'running', activitySource: 'process', pid: 42, startedAt: Date.now()};
    const html = renderToStaticMarkup(createElement(AgentCard, {agent: base}));
    assert.match(html, /aria-label="Bob harness activity"/);
    if (fs.existsSync(path.join(__dirname, '../src/assets/bob-standing-BECrMjXJ.webp'))) {
      assert.match(html, /class="bob-artwork"/);
      assert.match(html, /alt="IBM Bob"/);
      assert.doesNotMatch(html, /class="bob-avatar"/);
    } else {
      assert.match(html, /class="bob-avatar"/);
      assert.doesNotMatch(html, /class="bob-artwork"/);
    }
    assert.doesNotMatch(html, /https?:\/\/bob\.ibm\.com/);
    for (const [provider, name] of [['codex', 'OpenAI'], ['claude', 'Claude']]) {
      const other = renderToStaticMarkup(createElement(AgentCard, {agent: {...base, provider, name}}));
      assert.match(other, new RegExp(`alt="${name}"`));
      assert.doesNotMatch(other, /class="bob-artwork"|class="bob-avatar"/);
    }
    assert.match(renderToStaticMarkup(createElement(AgentCard, {agent: null})), /class="poster"/);
  } finally {
    await server.close();
  }
});
