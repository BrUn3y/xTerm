const http = require('node:http');
const path = require('node:path');
const {readFile} = require('node:fs/promises');
const {WebSocket, WebSocketServer} = require('ws');
const {AccessDeadline, RemoteAuth, clearCookie} = require('./remote-auth.cjs');
const {startCloudflare, URL_PATTERN} = require('./tunnels/cloudflare.cjs');

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const MAX_BODY = 1024;
const MAX_MESSAGE = 96 * 1024;
const MAX_BUFFER = 8 * 1024 * 1024;

function reply(response, status, value) {
  if (value !== undefined) response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.writeHead(status).end(value === undefined ? undefined : JSON.stringify(value));
}

async function readJson(request) {
  let bytes = 0;
  const parts = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw new Error('Request too large.');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

function deviceLabel(agent = '') {
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent) || /Macintosh.*Mobile/i.test(agent)) return 'iPad';
  if (/Android/i.test(agent)) return 'Android device';
  return 'Browser';
}

class RemoteMode {
  constructor({sessions, notify, power, assets, tunnel = startCloudflare, clock, setupOriginAllowed = URL_PATTERN}) {
    this.sessions = sessions;
    this.notify = notify;
    this.power = power;
    this.assets = assets;
    this.tunnel = tunnel;
    this.clock = clock;
    this.setupOriginAllowed = setupOriginAllowed;
    this.access = null;
    this.message = '';
    sessions.events.on('screen', (id, event) => this.publishScreen(id, event));
    sessions.events.on('metadata', id => {
      if (this.access?.ids.has(id)) this.sendState(this.access);
    });
    sessions.events.on('removed', (id, code) => {
      if (this.access?.ids.has(id)) this.remove(id, code);
    });
  }

  state() {
    const access = this.access;
    if (!access) return {status: 'disabled', message: this.message};
    const invitation = access.auth.availableInvitation();
    return {
      status: access.origin ? 'active' : 'starting',
      provider: 'cloudflare', permission: access.permission, ids: [...access.ids],
      expiresAt: access.deadline.expiresAt, remaining: access.deadline.remaining(),
      invitation: invitation ? {link: invitation.link, expiresAt: invitation.expiresAt} : null,
      device: access.auth.device ? {label: access.auth.device.label, connected: !!access.client} : null,
    };
  }

  emitState() { this.notify(this.state()); }

  async start(options) {
    if (this.access) throw new Error('Remote Mode is already open.');
    if (options?.provider !== 'cloudflare' || !['view', 'commands'].includes(options.permission)) throw new Error('Choose a provider and permission.');
    if (!Array.isArray(options.ids) || !options.ids.length || options.ids.length > 24
      || options.ids.some(id => typeof id !== 'string' || !this.sessions.get(id))) {
      throw new Error('Choose at least one running terminal.');
    }
    const deadline = new AccessDeadline(options.hours, this.clock?.wall, this.clock?.elapsed);
    const access = {
      ids: new Set(options.ids), permission: options.permission, deadline, auth: new RemoteAuth(deadline),
      server: null, ws: null, client: null, origin: null, host: null,
      abort: new AbortController(), sockets: new Set(), attempts: [], blocker: null, heartbeat: 0,
    };
    this.message = '';
    this.access = access;
    try {
      access.blocker = this.power.start();
      access.timer = setInterval(() => this.tick(), 1000);
      access.timer.unref();
      this.emitState();
      // Detect missing or incomplete mobile builds before making a tunnel.
      await readFile(path.join(this.assets, 'index.html'));
      if (!this.check(access)) return this.state();
      const port = await this.listen(access);
      if (!this.check(access)) return this.state();
      access.tunnel = this.tunnel(port, reason => this.stop(reason, access));
      const origin = await access.tunnel.connected;
      if (!this.check(access)) return this.state();
      if (!this.setupOriginAllowed.test(origin)) throw new Error('Cloudflare returned an invalid address.');
      access.host = new URL(origin).host;
      access.origin = origin;
      access.auth.invite(origin);
      this.emitState();
    } catch (error) {
      const reason = error.code === 'ENOENT' ? 'Build the xTerm mobile app before enabling Remote Mode.' : error.message;
      this.stop(reason || 'Could not start Remote Mode.', access);
    }
    return this.state();
  }

  listen(access) {
    const server = http.createServer({requestTimeout: 10_000, headersTimeout: 8000, keepAliveTimeout: 3000, maxHeaderSize: 8192, connectionsCheckingInterval: 2000},
      (request, response) => void this.request(access, request, response).catch(() => {
        if (!response.headersSent && !response.destroyed) reply(response, 400);
        else response.destroy();
      }));
    access.server = server;
    access.ws = new WebSocketServer({noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false});
    server.on('connection', socket => {
      access.sockets.add(socket);
      socket.once('close', () => access.sockets.delete(socket));
      if (access.sockets.size > 48) socket.destroy();
    });
    server.on('upgrade', (request, socket, head) => {
      if (!this.check(access) || request.url !== '/api/socket' || !this.matches(access, request)
        || request.headers.origin !== access.origin || !access.auth.authorize(request.headers.cookie)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      access.ws.handleUpgrade(request, socket, head, ws => this.connect(access, ws));
    });
    return new Promise((resolve, reject) => {
      access.abort.signal.addEventListener('abort', () => reject(new Error('Remote Mode was stopped.')), {once: true});
      server.on('error', () => {
        const reason = 'Could not run the Remote Mode listener.';
        reject(new Error(reason));
        this.stop(reason, access);
      });
      server.listen({host: '127.0.0.1', port: 0, signal: access.abort.signal}, () => resolve(server.address().port));
    });
  }

  check(access) {
    if (!access || this.access !== access) return false;
    if (access.deadline.remaining()) return true;
    this.stop('Remote Mode expired.', access, 4001);
    return false;
  }

  matches(access, request) {
    return !!access.origin && request.headers.host === access.host;
  }

  async request(access, request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const wsOrigin = access.origin ? new URL('/api/socket', access.origin).href.replace(/^http/, 'ws') : '';
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self' ${wsOrigin}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if (!this.check(access) || !this.matches(access, request)) return reply(response, 404);
    if (request.method === 'GET' && request.url === '/api/state') {
      if (!access.auth.authorize(request.headers.cookie)) return reply(response, 401);
      return reply(response, 200, this.clientState(access));
    }
    if (request.method === 'POST') {
      if (request.headers.origin !== access.origin || !['/api/pair', '/api/sign-out', '/api/disable'].includes(request.url)) return reply(response, 403);
      if (request.url === '/api/pair') {
        if (request.headers['content-type'] !== 'application/json') return reply(response, 415);
        const now = access.deadline.elapsed();
        access.attempts = access.attempts.filter(time => now - time < 60_000);
        if (access.attempts.length >= 12) return reply(response, 429);
        access.attempts.push(now);
        const body = await readJson(request);
        if (!this.check(access)) return reply(response, 403);
        const cookie = access.auth.pair(body?.token, deviceLabel(request.headers['user-agent']));
        if (!cookie) return reply(response, 403);
        response.setHeader('Set-Cookie', cookie);
        reply(response, 204);
        this.emitState();
        return;
      }
      if (!access.auth.authorize(request.headers.cookie)) return reply(response, 401);
      response.setHeader('Set-Cookie', clearCookie);
      if (request.url === '/api/sign-out') {
        this.revoke();
        return reply(response, 204);
      }
      // Revoke authorization synchronously. Let this HTTP response flush before
      // tearing down the listener and force-closing its connections.
      response.once('finish', () => this.stop('Remote Mode disabled.', access));
      access.auth.revoke();
      return reply(response, 204);
    }
    if (request.method !== 'GET') return reply(response, 405);
    const asset = /^\/assets\/([\w.-]+)$/.exec(request.url);
    const type = request.url === '/' ? 'text/html; charset=utf-8' : asset && TYPES[path.extname(asset[1])];
    if (!type) return reply(response, 404);
    const file = request.url === '/' ? 'index.html' : path.join('assets', asset[1]);
    const contents = await readFile(path.join(this.assets, file)).catch(() => null);
    if (!contents || !this.check(access)) return reply(response, 404);
    response.setHeader('Content-Type', type);
    response.writeHead(200).end(contents);
  }

  clientState(access) {
    return {
      type: 'state', expiresAt: access.deadline.expiresAt, remaining: access.deadline.remaining(), permission: access.permission,
      sessions: [...access.ids].flatMap(id => {
        const session = this.sessions.get(id);
        if (!session) return [];
        const {cwd, shell, agent, ssh, controller} = session;
        return [{
          id, cwd, shell, status: 'running', control: !!controller,
          agent: agent ? {name: agent.name, model: agent.model, status: agent.status} : null,
          ssh: ssh ? {target: ssh.target} : null,
        }];
      }),
    };
  }

  send(client, event) {
    const {ws} = client;
    if (ws.readyState !== WebSocket.OPEN) return false;
    const data = JSON.stringify(event);
    if (Buffer.byteLength(data) + ws.bufferedAmount > MAX_BUFFER) {
      ws.terminate();
      return false;
    }
    ws.send(data, error => { if (error) ws.terminate(); });
    return true;
  }

  sendState(access) {
    if (this.check(access) && access.client) this.send(access.client, this.clientState(access));
  }

  connect(access, ws) {
    if (access.client) this.disconnect(access, 4003, 'Opened in another tab');
    const client = {ws, id: null, following: false, alive: true, window: 0, messages: 0, bytes: 0};
    access.client = client;
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      if (access.client !== client) return;
      this.disconnect(access);
      if (this.check(access)) this.emitState();
    });
    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (raw, binary) => this.messageFrom(access, client, raw, binary));
    this.sendState(access);
    this.emitState();
  }

  messageFrom(access, client, raw, binary) {
    if (access.client !== client || !this.check(access) || !access.auth.device) return;
    const now = access.deadline.elapsed();
    if (now - client.window >= 1000) {
      client.window = now;
      client.messages = 0;
      client.bytes = 0;
    }
    client.bytes += raw.length;
    if (binary || ++client.messages > 100 || client.bytes > 256 * 1024) {
      this.disconnect(access, 1008, 'Message limit exceeded');
      this.emitState();
      return;
    }
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const id = message?.id;
    const session = access.ids.has(id) && this.sessions.get(id);
    if (!session) return;
    if (message.type === 'attach' && Number.isSafeInteger(message.subscription)) {
      if (client.id && this.sessions.get(client.id)?.controller === client) {
        this.sessions.setController(client.id, null);
      }
      client.id = id;
      client.subscription = message.subscription;
      client.following = false;
      this.trySnapshot(access, client, session);
      return;
    }
    if (!client.following || client.id !== id || client.subscription !== message.subscription || access.permission !== 'commands') return;
    if (message.type === 'claim') {
      this.sessions.setController(id, client);
    } else if (message.type === 'release' && session.controller === client) {
      this.sessions.setController(id, null);
    } else if (message.type === 'input' && session.controller === client
      && typeof message.data === 'string' && message.data.length <= 64 * 1024) {
      if (!this.sessions.write(id, message.data, client)) this.send(client, {type: 'notice', text: 'Input could not be delivered.'});
    }
  }

  trySnapshot(access, client, session) {
    try {
      const snapshot = session.screen.snapshot();
      if (snapshot) client.following = this.send(client, {...snapshot, id: session.id, subscription: client.subscription});
    } catch {
      this.send(client, {type: 'notice', text: 'This terminal screen is too large to share.'});
      client.id = null;
    }
  }

  publishScreen(id, event) {
    const access = this.access;
    const client = access?.client;
    if (!client || client.id !== id || !access.ids.has(id) || !this.check(access)) return;
    if (client.following) this.send(client, {...event, id, subscription: client.subscription});
    else this.trySnapshot(access, client, this.sessions.get(id));
  }

  tick() {
    const access = this.access;
    if (!this.check(access)) return;
    const client = access.client;
    if (client && ++access.heartbeat % 5 === 0) {
      if (!client.alive) this.disconnect(access, 4004, 'Connection lost');
      else {
        client.alive = false;
        if (client.ws.readyState === WebSocket.OPEN) client.ws.ping();
      }
    }
    this.emitState();
  }

  disconnect(access, code, reason) {
    const client = access.client;
    if (!client) return;
    access.client = null;
    if (client.id && this.sessions.get(client.id)?.controller === client) this.sessions.setController(client.id, null);
    if (code) {
      client.ws.close(code, reason);
      const timer = setTimeout(() => client.ws.terminate(), 400);
      timer.unref();
    }
  }

  share(id) {
    const access = this.access;
    if (!this.check(access) || typeof id !== 'string' || !this.sessions.get(id)) return this.state();
    access.ids.add(id);
    this.sendState(access);
    this.emitState();
    return this.state();
  }

  remove(id, code) {
    const access = this.access;
    if (!this.check(access) || !access.ids.delete(id)) return this.state();
    const client = access.client;
    if (client?.id === id) {
      client.id = null;
      client.following = false;
      if (this.sessions.get(id)?.controller === client) this.sessions.setController(id, null);
      this.send(client, {type: 'exit', id, code, subscription: client.subscription});
    }
    this.sendState(access);
    this.emitState();
    return this.state();
  }

  regenerate() {
    const access = this.access;
    if (this.check(access) && access.origin) {
      access.auth.invite(access.origin);
      this.emitState();
    }
    return this.state();
  }

  revoke() {
    const access = this.access;
    if (this.check(access)) {
      access.auth.revoke();
      this.disconnect(access, 4003, 'Device signed out');
      this.emitState();
    }
    return this.state();
  }

  stop(message = 'Remote Mode disabled.', access = this.access, code = 4001) {
    if (!access || this.access !== access) return this.state();
    this.access = null;
    this.message = message;
    access.auth.revoke();
    this.disconnect(access, code, message.length < 100 ? message : 'Remote Mode disabled.');
    clearInterval(access.timer);
    access.abort.abort();
    access.tunnel?.stop();
    access.server?.close();
    const closeSockets = () => {
      for (const socket of access.sockets) socket.destroy();
      access.ws?.close();
    };
    if (access.sockets.size) {
      const timer = setTimeout(closeSockets, 500);
      timer.unref();
    } else closeSockets();
    if (access.blocker !== null) this.power.stop(access.blocker);
    this.emitState();
    return this.state();
  }
}

module.exports = {RemoteMode};
