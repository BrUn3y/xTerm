const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createAppKeyHandler} = require('../src/lib/terminal-keyboard.mjs');
const event = (key, partial = {}) => ({key, code: key === 'Enter' ? 'Enter' : `Key${key.toUpperCase()}`,
  type: 'keydown', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...partial});
const terminal = {hasSelection: () => false, getSelection: () => 'selection'};

test('Enter variants and ordinary shell keys are delegated unchanged to xterm.js', () => {
  const handler = createAppKeyHandler(terminal, () => assert.fail('Unexpected copy'));
  for (const key of ['Enter', 'c', 'a', 'ArrowUp']) {
    for (const modifiers of [{}, {shiftKey: true}, {ctrlKey: true}, {altKey: true}]) {
      assert.equal(handler(event(key, modifiers)), true);
      assert.equal(handler(event(key, {...modifiers, type: 'keyup'})), true);
    }
  }
});

test('app shortcuts reserve matching keypress and keyup, including early modifier release', () => {
  const handler = createAppKeyHandler(terminal, () => {});
  for (const modifiers of [{metaKey: true}, {ctrlKey: true, shiftKey: true}]) {
    for (const key of ['c', 'k', 'f', 't', 'w', 'd', ',', 'o', 'b', '+', '-', '=']) {
      assert.equal(handler(event(key, modifiers)), false);
      assert.equal(handler(event(key, {...modifiers, repeat: true})), false);
      assert.equal(handler(event(key, {type: 'keypress'})), false);
      assert.equal(handler(event(key, {type: 'keyup'})), false);
      assert.equal(handler(event(key)), true, 'Next unmodified key is not swallowed');
    }
  }
});

test('copy selection and reserved-key state remain isolated per terminal', () => {
  const copied = [];
  const first = createAppKeyHandler({...terminal, hasSelection: () => true}, text => copied.push(text));
  const second = createAppKeyHandler(terminal, () => assert.fail('Unexpected copy'));
  assert.equal(first(event('c', {metaKey: true})), false);
  assert.deepEqual(copied, ['selection']);
  assert.equal(second(event('c', {type: 'keyup'})), true);
  assert.equal(first(event('c', {type: 'keyup'})), false);
  assert.equal(first(event('c', {ctrlKey: true})), true, 'Ctrl+C reaches the process');
});
