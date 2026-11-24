const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const exec = promisify(execFile);

function tokens(text) {
  const result = [];
  let word = '', quoted = false, quote = '', escaped = false;
  for (const character of text) {
    if (escaped) { word += character; escaped = false; continue; }
    if (character === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; else word += character; continue; }
    if (character === '"' || character === "'") { quote = character; quoted = true; continue; }
    if (/\s/.test(character)) { if (word || quoted) result.push(word); word = ''; quoted = false; }
    else if (character === '#') break;
    else word += character;
  }
  if (quote || escaped) return null;
  if (word || quoted) result.push(word);
  return result;
}

const safeText = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x20\x7f]/.test(value) ? value : null;
const portNumber = value => /^\d{1,5}$/.test(value || '') && +value > 0 && +value <= 65535 ? +value : null;
const valueOptions = new Set('BbcDEeFIiJLlmOopQRSWw'.split(''));
const flagOptions = new Set('46AaCfGgKkMNnqsTtVvXxYy'.split(''));

function parseSshArgs(args) {
  if (!args?.length || !/^ssh(?:\.exe)?$/.test(path.basename(args[0]))) return null;
  const options = {};
  let index = 1, excluded = false;
  for (; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--') { index++; break; }
    if (!argument.startsWith('-') || argument === '-') break;
    for (let offset = 1; offset < argument.length; offset++) {
      const option = argument[offset];
      if ('fGOQVW'.includes(option)) excluded = true;
      if (valueOptions.has(option)) {
        const value = argument.slice(offset + 1) || args[++index];
        if (value == null) return null;
        const key = {p: 'port', l: 'user', J: 'proxyjump'}[option];
        if (key && !Object.hasOwn(options, key)) options[key] = value;
        if (option === 'F') options.configFile = value;
        if (option === 'o') {
          const match = /^(\w+)(?:=|\s+)(.*)$/.exec(value);
          if (!match) return null;
          const key = match[1].toLowerCase();
          if (!Object.hasOwn(options, key)) options[key] = match[2].trim();
        }
        break;
      }
      if (!flagOptions.has(option)) return null;
    }
  }
  if (excluded || !args[index]) return null;
  const destination = args[index];
  let target, user, uriPort;
  if (destination.startsWith('ssh://')) {
    try {
      const url = new URL(destination);
      if (url.password || url.pathname && url.pathname !== '/' || url.search || url.hash) return null;
      target = url.hostname.replace(/^\[|\]$/g, '');
      user = url.username ? decodeURIComponent(url.username) : null;
      uriPort = url.port;
    } catch { return null; }
  } else {
    const at = destination.lastIndexOf('@');
    user = at >= 0 ? destination.slice(0, at) : null;
    target = destination.slice(at + 1).replace(/^\[|\]$/g, '');
  }
  if (!safeText(target) || target.startsWith('-') || user && !safeText(user)) return null;
  return {target, user: safeText(options.user || user), port: portNumber(options.port || uriPort),
    options, destination};
}

function findForegroundSsh(rootPid, processes) {
  const root = processes.find(value => value.pid === rootPid);
  if (!root || root.foregroundGroup <= 0) return null;
  const parents = new Map();
  for (const process of processes) {
    if (!parents.has(process.ppid)) parents.set(process.ppid, []);
    parents.get(process.ppid).push(process);
  }
  const queue = [{...root, depth: 0}], seen = new Set();
  while (queue.length) {
    const process = queue.shift();
    if (seen.has(process.pid) || process.depth > 20) continue;
    seen.add(process.pid);
    if (process.pgid === root.foregroundGroup && !/[ZTX]/.test(process.state)) {
      const args = process.argv || tokens(process.command);
      const request = parseSshArgs(args);
      if (request) return {pid: process.pid, request};
    }
    for (const child of parents.get(process.pid) || []) queue.push({...child, depth: process.depth + 1});
  }
  return null;
}

function isLocalShellForeground(root, shell) {
  const executable = path.basename((root?.argv || tokens(root?.command || ''))?.[0] || '').replace(/^-/, '');
  return !!root && root.foregroundGroup > 0 && root.foregroundGroup === root.pgid &&
    !/[ZTX]/.test(root.state) && executable === shell;
}

function matchesHost(patterns, host) {
  let positive = false;
  for (let pattern of patterns) {
    const negative = pattern.startsWith('!');
    if (negative) pattern = pattern.slice(1);
    const expression = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    if (new RegExp(expression, 'i').test(host)) {
      if (negative) return false;
      positive = true;
    }
  }
  return positive;
}

// Read a deliberately limited static subset; never run ssh -G (Match exec can execute).
async function readSshConfig(request, {home = os.homedir(), cwd = home, readFile = fs.readFile, readdir = fs.readdir} = {}) {
  const values = {};
  let active = true, complete = true, count = 0;
  const stack = new Set();
  async function read(file, required = false, depth = 0) {
    if (depth > 8 || count++ > 32 || stack.has(file)) { complete = false; return; }
    let text;
    try { text = await readFile(file, 'utf8'); }
    catch (error) { if (required || error.code !== 'ENOENT') complete = false; return; }
    if (text.length > 256 * 1024) { complete = false; return; }
    stack.add(file);
    for (const line of text.split(/\r?\n/)) {
      const parts = tokens(line.replace(/^(\s*\w+)\s*=\s*/, '$1 '));
      if (!parts) { complete = false; continue; }
      const key = parts.shift()?.toLowerCase();
      if (!key) continue;
      if (key === 'host') active = matchesHost(parts, request.target);
      else if (key === 'match') { complete = false; active = false; }
      else if (key === 'include' && active) {
        for (const include of parts) {
          if (/[%$[\]]/.test(include)) { complete = false; continue; }
          const expanded = include.startsWith('~/') ? path.join(home, include.slice(2)) :
            path.isAbsolute(include) ? include : path.join(file.startsWith('/etc/ssh/') ? '/etc/ssh' : home + '/.ssh', include);
          if (/[*?]/.test(expanded)) {
            const directory = path.dirname(expanded);
            if (/[*?]/.test(directory)) { complete = false; continue; }
            try {
              const names = (await readdir(directory)).sort();
              for (const name of names) if (matchesHost([path.basename(expanded)], name)) await read(path.join(directory, name), true, depth + 1);
            } catch (error) { if (error.code !== 'ENOENT') complete = false; }
          } else await read(expanded, true, depth + 1);
        }
      } else if (active && ['hostname', 'user', 'port', 'proxyjump', 'proxycommand', 'canonicalizehostname'].includes(key)) {
        if (!Object.hasOwn(values, key)) values[key] = parts.join(' ');
      }
    }
    stack.delete(file);
  }
  const custom = request.options.configFile;
  if (custom !== 'none') {
    if (custom) await read(path.resolve(cwd, custom.startsWith('~/') ? path.join(home, custom.slice(2)) : custom), true);
    else {
      await read(path.join(home, '.ssh/config'));
      // Host/Match state crosses Includes, not separate top-level config files.
      active = true;
      await read('/etc/ssh/ssh_config');
    }
  }
  // CLI values remain useful even if static configuration is too complex to resolve safely.
  const config = complete ? values : {};
  for (const key of ['hostname', 'user', 'port', 'proxyjump', 'proxycommand', 'canonicalizehostname']) {
    if (Object.hasOwn(request.options, key)) config[key] = request.options[key];
  }
  const expand = value => {
    if (!value) return null;
    let unsupported = false;
    const expanded = value.replace(/%(.)/g, (_match, token) => {
      if (token === '%') return '%';
      if (token === 'h') return request.target;
      unsupported = true; return '';
    });
    return unsupported || /[%$]/.test(expanded) ? null : safeText(expanded);
  };
  const hostname = expand(config.hostname || (complete ? request.target : null));
  const user = request.user || safeText(config.user) || (complete ? os.userInfo().username : null);
  const port = request.port || portNumber(config.port) || (complete ? 22 : null);
  const jumpHost = config.proxyjump && config.proxyjump !== 'none' ? safeText(config.proxyjump) : null;
  const proxied = !!jumpHost || !!config.proxycommand && config.proxycommand !== 'none';
  const routingKnown = complete && hostname !== null &&
    (!config.canonicalizehostname || config.canonicalizehostname === 'no');
  return {configuredHost: hostname, user, port, jumpHost, routing: !routingKnown ? 'unknown' : proxied ? 'proxy' : 'direct',
    configStatus: complete ? 'static' : 'unavailable'};
}

function decodeAddress(value) {
  if (value.length !== 8 && value.length !== 32 || !/^[A-Fa-f0-9]+$/.test(value)) return null;
  const bytes = [];
  for (let index = 0; index < value.length; index += 8) {
    bytes.push(...Buffer.from(value.slice(index, index + 8), 'hex').reverse());
  }
  if (value.length === 8) return bytes.join('.');
  if (bytes.slice(0, 10).every(byte => byte === 0) && bytes[10] === 255 && bytes[11] === 255) return bytes.slice(12).join('.');
  return Array.from({length: 8}, (_, index) => ((bytes[index * 2] << 8) | bytes[index * 2 + 1]).toString(16)).join(':');
}

function parseProcTcp(text, inodes) {
  return text.split('\n').flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (!inodes.has(fields[9]) || !['01', '02'].includes(fields[3])) return [];
    const [hex, port] = fields[2].split(':');
    const address = decodeAddress(hex);
    return address ? [{address, port: parseInt(port, 16), state: fields[3] === '01' ? 'established' : 'connecting'}] : [];
  });
}

function parseLsof(text) {
  let address = null, port = null, established = false;
  const result = [];
  const flush = () => { if (established && net.isIP(address || '') && port) result.push({address, port, state: 'established'}); };
  for (const line of text.split('\n')) {
    if (line.startsWith('f')) { flush(); address = null; port = null; established = false; }
    if (line.startsWith('n') && line.includes('->')) {
      const match = /->(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(line);
      address = match?.[1] || match?.[2]; port = portNumber(match?.[3]);
    }
    if (line === 'TST=ESTABLISHED') established = true;
  }
  flush();
  return result;
}

async function inspectTransport(pid) {
  if (process.platform === 'linux') {
    const directory = `/proc/${pid}`;
    const entries = await fs.readdir(directory + '/fd');
    const links = await Promise.all(entries.map(entry => fs.readlink(directory + '/fd/' + entry).catch(() => '')));
    const inodes = new Set(links.flatMap(link => /^socket:\[(\d+)\]$/.exec(link)?.slice(1) || []));
    const tables = await Promise.all(['tcp', 'tcp6'].map(name => fs.readFile(directory + '/net/' + name, 'utf8').catch(() => '')));
    return tables.flatMap(text => parseProcTcp(text, inodes));
  }
  if (process.platform === 'darwin') {
    const {stdout} = await exec('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-FfnT'], {timeout: 1200, maxBuffer: 65536});
    return parseLsof(stdout);
  }
  return [];
}

class SshMonitor {
  constructor(emit, {now = Date.now, resolve = readSshConfig, transport = inspectTransport} = {}) {
    this.emit = emit; this.now = now; this.resolve = resolve; this.transport = transport;
    this.ssh = null; this.identity = ''; this.generation = 0; this.busy = false; this.last = '';
  }
  publish() {
    const value = JSON.stringify(this.ssh);
    if (value !== this.last) { this.last = value; this.emit(this.ssh ? {...this.ssh} : null); }
  }
  async setProcess(process, context) {
    const identity = process ? `${process.pid}:${JSON.stringify(process.request)}` : '';
    if (!process) { this.reset(); return; }
    if (identity !== this.identity) {
      this.generation++; this.identity = identity; this.busy = false;
      this.ssh = {pid: process.pid, target: process.request.target, user: process.request.user, port: process.request.port,
        configuredHost: null, remoteHostname: null, endpoint: null, transportEndpoint: null, jumpHost: null,
        configStatus: 'unavailable', routing: 'unknown', status: 'unknown', statusDetail: 'Authentication not observable',
        startedAt: this.now(), durationKind: 'observed-process'};
      this.publish();
      const generation = this.generation;
      try {
        const metadata = await this.resolve(process.request, context);
        if (generation !== this.generation) return;
        Object.assign(this.ssh, metadata); this.publish();
      } catch { /* Configuration remains explicitly unavailable. */ }
      if (generation !== this.generation) return;
    }
    if (this.busy) return;
    this.busy = true;
    const generation = this.generation;
    try {
      const sockets = await this.transport(process.pid);
      if (generation !== this.generation) return;
      const established = sockets.filter(socket => socket.state === 'established');
      const socket = established.length === 1 ? established[0] : null;
      this.ssh.transportEndpoint = socket ? {address: socket.address, port: socket.port} : null;
      this.ssh.endpoint = socket && this.ssh.routing === 'direct' && socket.port === this.ssh.port ? this.ssh.transportEndpoint : null;
      this.ssh.status = !established.length && sockets.some(socket => socket.state === 'connecting') ? 'connecting' : 'unknown';
      this.ssh.statusDetail = this.ssh.status === 'connecting' ? 'TCP handshake observed' :
        socket ? 'TCP established; authentication unknown' : 'Authentication not observable';
      this.publish();
    } catch {
      if (generation === this.generation) {
        this.ssh.endpoint = null; this.ssh.transportEndpoint = null; this.ssh.status = 'unknown';
        this.ssh.statusDetail = 'Transport and authentication unavailable'; this.publish();
      }
    } finally { if (generation === this.generation) this.busy = false; }
  }
  reset() { this.generation++; this.identity = ''; this.ssh = null; this.busy = false; this.publish(); }
}

module.exports = {tokens, parseSshArgs, findForegroundSsh, isLocalShellForeground, readSshConfig, matchesHost, decodeAddress, parseProcTcp, parseLsof, inspectTransport, SshMonitor};
