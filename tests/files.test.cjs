const {test} = require('node:test');
const assert = require('node:assert/strict');
const {listDirectory, fileDetails, resolveLink} = require('../electron/files.cjs');
const dirent = (name,directory=false,symlink=false) => ({name,isDirectory:()=>directory,isSymbolicLink:()=>symlink});

test('home listing never touches child folders or follows protected symlink targets', async () => {
  const calls = [];
  const io = {
    readdir: async (...args) => {calls.push(args); return [dirent('link-to-private-file',false,true),dirent('notes.txt'),dirent('Desktop',true),dirent('Documents',true)];},
    stat: () => {throw new Error('Child stat must not be called');},
    lstat: () => {throw new Error('Child lstat must not be called');},
    realpath: () => {throw new Error('Symlink targets must not be resolved');},
  };
  const result = await listDirectory('/Users/test',io);
  assert.equal(calls.length,1); assert.equal(calls[0][0],'/Users/test');
  assert.deepEqual(result.entries.map(entry=>entry.name),['Desktop','Documents','link-to-private-file','notes.txt']);
  assert.ok(result.entries.every(entry=>entry.size === null && entry.modified === null));
  assert.equal(result.entries.find(entry=>entry.name==='link-to-private-file').symlink,true);
});

test('selected-file details use lstat without following links', async () => {
  const calls = [];
  const result = await fileDetails('/Users/test/link', {lstat:async value=>{calls.push(value);return {isFile:()=>false,size:128,mtime:new Date('2026-11-23T00:00:00Z')};}});
  assert.deepEqual(calls,['/Users/test/link']); assert.equal(result.size,null);
  await assert.rejects(fileDetails('relative'), /absolute/);
});

test('directory links can still be followed after an explicit user open action', async () => {
  const calls=[];
  const result=await resolveLink('/Users/test/link',{stat:async value=>{calls.push(value);return {isDirectory:()=>true};},realpath:async()=>'/Users/test/Projects'});
  assert.deepEqual(calls,['/Users/test/link']);assert.deepEqual(result,{directory:true,path:'/Users/test/Projects'});
});
