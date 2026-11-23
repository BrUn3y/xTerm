const {test} = require('node:test');
const assert = require('node:assert/strict');
const colors = import('../src/lib/terminal-colors.mjs');

test('map truecolor and ANSI gray harness panels to a readable light surface', async () => {
  const {lightPanelColors, ansiColor} = await colors;
  for (const background of ['#262626','rgb(30, 30, 30)','#000000',ansiColor(235,[],'#f3f2ed','#353c32')]) {
    const result = lightPanelColors(background, '#eeeeee');
    assert.equal(result.background, '#e9eddf'); assert.equal(result.foreground, '#353c32');
  }
  assert.equal(lightPanelColors('#262626','#353c32').foreground, '#353c32');
});

test('preserve semantic colored backgrounds and light application backgrounds', async () => {
  const {lightPanelColors} = await colors;
  assert.equal(lightPanelColors('#065f46','#ffffff'), null);
  assert.equal(lightPanelColors('#7f1d1d','#ffffff'), null);
  assert.equal(lightPanelColors('#f3f2ed','#353c32'), null);
  assert.equal(lightPanelColors('transparent','#ffffff'), null);
});

test('retain colored foreground identity while restoring contrast on adapted panels', async () => {
  const {lightPanelColors, ansiColor} = await colors;
  const result = lightPanelColors('#262626','#bbff99');
  assert.notEqual(result.foreground, '#bbff99'); assert.notEqual(result.foreground, '#353c32');
  const red = parseInt(result.foreground.slice(1,3),16), green = parseInt(result.foreground.slice(3,5),16);
  assert.ok(green > red);
  assert.equal(ansiColor(16,[],'#f3f2ed','#353c32'), '#000000');
  assert.equal(ansiColor(231,[],'#f3f2ed','#353c32'), '#ffffff');
  assert.equal(ansiColor(257,[],'#f3f2ed','#353c32'), '#f3f2ed');
});
