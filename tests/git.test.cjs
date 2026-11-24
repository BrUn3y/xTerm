const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {mkdtemp, mkdir, rm} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {githubRepository, githubFromConfig, gitInfo} = require('../electron/git.cjs');
const exec = promisify(execFile);
const repository = {owner: 'BrUn3y', repo: 'xTerm', url: 'https://github.com/BrUn3y/xTerm'};

test('GitHub remotes normalize HTTPS, SCP SSH and SSH URLs without .git', () => {
  for (const remote of [
    'https://github.com/BrUn3y/xTerm.git', 'https://GITHUB.COM/BrUn3y/xTerm/',
    'git@github.com:BrUn3y/xTerm.git', 'github.com:BrUn3y/xTerm',
    'ssh://git@github.com/BrUn3y/xTerm.git', 'ssh://git@github.com:22/BrUn3y/xTerm',
    'ssh://git@ssh.github.com:443/BrUn3y/xTerm.git', 'http://github.com/BrUn3y/xTerm',
    'git://github.com/BrUn3y/xTerm.git', ' https://github.com/BrUn3y/xTerm.git ',
  ]) assert.deepEqual(githubRepository(remote), repository, remote);
  assert.deepEqual(githubRepository('https://user:password@github.com/BrUn3y/xTerm.git'), repository);
  assert.equal(githubRepository('https://github.com/owner/.github.git').repo, '.github');
});

test('unsupported or malformed remotes never manufacture a GitHub destination', () => {
  for (const remote of [
    null, undefined, 42, '', '/local/project', 'file:///repo', 'https://gitlab.com/owner/repo',
    'git@github.example:owner/repo', 'https://github.com.evil.test/owner/repo',
    'https://github.com@evil.test/owner/repo', 'https://evil.test/github.com/owner/repo',
    'https://github.com:8080/owner/repo', 'ftp://github.com/owner/repo', 'https://ssh.github.com/owner/repo',
    'https://github.com/owner', 'https://github.com/owner/repo/tree/main',
    'https://github.com/owner/repo?x=1', 'https://github.com/owner/repo#main',
    'https://github.com/owner/repo%2Fother', 'https://github.com/owner/repo\nother',
    'https://github.com/owner\\repo', 'https://github.com/first/../owner/repo',
    'https://github.com/owner/..', 'git@github.com:owner/.git', 'git@github.com:owner/..',
  ]) assert.equal(githubRepository(remote), null, String(remote));
});

test('remote resolution prefers GitHub origin, then the first GitHub fetch URL', () => {
  const config = [
    'remote.upstream.url\nhttps://github.com/upstream/project.git',
    'remote.origin.url\ngit@github.com:BrUn3y/xTerm.git',
    'remote.origin.pushurl\nhttps://github.com/wrong/push-only.git',
  ].join('\0') + '\0';
  assert.deepEqual(githubFromConfig(config), repository);
  assert.deepEqual(githubFromConfig(config.replace('git@github.com:BrUn3y/xTerm.git', 'git@gitlab.com:owner/repo')),
    {owner: 'upstream', repo: 'project', url: 'https://github.com/upstream/project'});
});

test('no remote, non-GitHub URLs and multiline values fail closed', () => {
  assert.equal(githubFromConfig(''), null);
  assert.equal(githubFromConfig('remote.origin.url\nhttps://gitlab.com/owner/repo\0'), null);
  assert.equal(githubFromConfig('remote.origin.url\nhttps://github.com/owner/repo\nextra\0'), null);
});

test('Git errors are silent; remote-query failure preserves branch and change count', async () => {
  const run = async (_file, args) => {
    if (args[0] === 'config') throw new Error('No remotes');
    return {stdout: args[0] === 'branch' ? '' : ' M file.txt\n'};
  };
  assert.deepEqual(await gitInfo('/tmp/repo', run), {branch: 'detached', changed: 1, github: null});
  assert.equal(await gitInfo('/tmp/repo', async () => {throw new Error('Git missing or timeout');}), null);
});

test('real Git discovers parent repositories, isolated worktrees and remote changes locally', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'xterm-git-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const repo = path.join(home, 'repo'), nested = path.join(repo, 'src', 'nested'), plain = path.join(home, 'plain');
  await mkdir(nested, {recursive: true}); await mkdir(plain);
  const git = (...args) => exec('git', args, {cwd: repo});
  await git('init', '--initial-branch=main');
  assert.equal(await gitInfo(plain), null);
  assert.deepEqual(await gitInfo(nested), {branch: 'main', changed: 0, github: null});
  await git('remote', 'add', 'origin', 'https://gitlab.com/owner/repo.git');
  assert.equal((await gitInfo(nested)).github, null);
  await git('remote', 'add', 'upstream', 'https://github.com/upstream/project.git');
  assert.equal((await gitInfo(nested)).github.url, 'https://github.com/upstream/project');
  await git('remote', 'set-url', 'origin', 'git@github.com:BrUn3y/xTerm.git');
  assert.deepEqual((await gitInfo(nested)).github, repository);
  await git('-c', 'user.name=xTerm Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
  const worktree = path.join(home, 'worktree');
  await git('worktree', 'add', '-b', 'fixture', worktree);
  await mkdir(path.join(worktree, 'child'));
  assert.deepEqual((await gitInfo(path.join(worktree, 'child'))).github, repository);
  await git('remote', 'remove', 'origin'); await git('remote', 'remove', 'upstream');
  assert.equal((await gitInfo(nested)).github, null);
});
