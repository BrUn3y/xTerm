const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {existsSync} = require('node:fs');
const drops = import('../src/lib/dropped-paths.mjs');

test('file URI drops decode paths and ignore remote URLs and unrelated data', async()=>{
  const {pathsFromDropData}=await drops;
  assert.deepEqual(pathsFromDropData('', '# comment\r\nfile:///tmp/My%20file.txt\r\nhttps://example.com/a\r\nfile://remote/private'),['/tmp/My file.txt']);
  assert.deepEqual(pathsFromDropData('["/tmp/a","/tmp/b"]',''),['/tmp/a','/tmp/b']);
  assert.deepEqual(pathsFromDropData('["relative"]','file:///tmp/fallback'),['/tmp/fallback']);
  assert.deepEqual(pathsFromDropData('', 'file:///C:/My%20Files/a.txt'),['C:/My Files/a.txt']);
});

test('dropped POSIX paths survive shell parsing without expansion or extra commands', async()=>{
  const {quoteDroppedPaths}=await drops;
  const paths=["/tmp/my file's name.txt",'/tmp/$(printf INJECTED).txt','/tmp/`printf INJECTED`.txt','/tmp/a;printf INJECTED','/tmp/á日本語.txt','/tmp/line\nwith\ttab'];
  for(const shell of ['/bin/zsh','/bin/bash'].filter(existsSync)){
    const output=execFileSync(shell,['-c',`printf '%s\\0' ${quoteDroppedPaths(paths,shell)}`],{encoding:'utf8'});
    assert.deepEqual(output.split('\0').slice(0,-1),paths);
  }
  assert.ok(!quoteDroppedPaths(paths).includes('\n'));
  assert.ok(!quoteDroppedPaths(paths).includes('\r'));
});

test('multiple paths are separate quoted arguments and no path is executed automatically', async()=>{
  const {quoteDroppedPaths}=await drops;
  assert.equal(quoteDroppedPaths(['/tmp/one','/tmp/two files']),"'/tmp/one' '/tmp/two files' ");
  assert.throws(()=>quoteDroppedPaths(['relative']),/absolute/);
  assert.throws(()=>quoteDroppedPaths(['/tmp/\0bad']),/absolute/);
  assert.throws(()=>quoteDroppedPaths([]),/absolute/);
});

test('PowerShell and cmd receive shell-appropriate path quoting', async()=>{
  const {quoteDroppedPaths}=await drops;
  assert.equal(quoteDroppedPaths(['C:\\My Files\\$data.txt'],'pwsh'), '"C:\\My Files\\`$data.txt" ');
  assert.equal(quoteDroppedPaths(['C:\\My Files\\a.txt'],'cmd.exe'),'"C:\\My Files\\a.txt" ');
  assert.throws(()=>quoteDroppedPaths(['C:\\%PATH%\\a.txt'],'cmd.exe'),/safely/);
});
