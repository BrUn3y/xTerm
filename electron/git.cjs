const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const exec = promisify(execFile);

function githubRepository(remote) {
  if (typeof remote !== 'string') return null;
  const value = remote.trim();
  if (!value || /[\s\\?#%]/.test(value)) return null;
  let pathname;
  if (value.includes('://')) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null;
      if (url.hostname.toLowerCase() !== 'github.com'
        && !(url.protocol === 'ssh:' && url.hostname.toLowerCase() === 'ssh.github.com')) return null;
      if (url.port && url.protocol !== 'ssh:') return null;
      // Use the original path so URL normalization cannot turn ../ into another repository.
      pathname = value.slice(value.indexOf('/', value.indexOf('://') + 3));
    } catch { return null; }
  } else {
    const match = value.match(/^(?:[^@/:\s]+@)?(?:github\.com|ssh\.github\.com):(.+)$/i);
    if (!match) return null;
    pathname = match[1];
  }
  const match = pathname.match(/^\/?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)\/?$/);
  if (!match) return null;
  const owner = match[1], repo = match[2].replace(/\.git$/, '');
  if (!repo || repo === '.' || repo === '..') return null;
  return {owner, repo, url: `https://github.com/${owner}/${repo}`};
}

function githubFromConfig(output) {
  const candidates = [];
  // git config --null separates records with NUL and keys from values with a newline.
  for (const record of output.split('\0')) {
    const separator = record.indexOf('\n');
    if (separator < 0) continue;
    const key = record.slice(0, separator).match(/^remote\.(.+)\.url$/);
    const repository = githubRepository(record.slice(separator + 1));
    if (key && repository) candidates.push({name: key[1], repository});
  }
  return (candidates.find(candidate => candidate.name === 'origin') || candidates[0])?.repository || null;
}

async function gitInfo(cwd, run = exec) {
  try {
    const [{stdout: branch}, {stdout: status}, github] = await Promise.all([
      run('git', ['branch', '--show-current'], {cwd, timeout: 2500, maxBuffer: 65536}),
      run('git', ['status', '--porcelain', '-uno'], {cwd, timeout: 2500, maxBuffer: 262144}),
      run('git', ['config', '--local', '--null', '--get-regexp', '^remote\\..*\\.url$'],
        {cwd, timeout: 2500, maxBuffer: 65536})
        .then(({stdout}) => githubFromConfig(stdout)).catch(() => null),
    ]);
    return {branch: branch.trim() || 'detached', changed: status.trim() ? status.trim().split('\n').length : 0, github};
  } catch { return null; }
}

module.exports = {githubRepository, githubFromConfig, gitInfo};
