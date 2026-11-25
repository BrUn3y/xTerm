const os = require('node:os');
const {createHash, randomBytes, timingSafeEqual} = require('node:crypto');

const HOUR = 60 * 60 * 1000;
const INVITATION_AGE = 5 * 60 * 1000;
const COOKIE = '__Host-xterm-remote';
const secret = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest();
const valid = (value, hash) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
  && !!hash && timingSafeEqual(digest(value), hash);

function elapsedClock(platform = process.platform) {
  // Electron's libuv uses mach_continuous_time on macOS, CLOCK_BOOTTIME or
  // /proc/uptime on Linux, and GetTickCount64 on Windows. All include sleep.
  if (platform === 'darwin') return Number(process.hrtime.bigint() / 1_000_000n);
  return os.uptime() * 1000;
}

class AccessDeadline {
  constructor(hours, wall = Date.now, elapsed = elapsedClock) {
    if (!Number.isInteger(hours) || hours < 1 || hours > 5) throw new Error('Choose a duration from 1 to 5 hours.');
    this.wall = wall;
    this.elapsed = elapsed;
    this.startedAt = wall();
    this.startedElapsed = elapsed();
    this.duration = hours * HOUR;
    this.expiresAt = this.startedAt + this.duration;
    this.lastElapsed = this.startedElapsed;
    this.lastRemaining = this.duration;
  }

  remaining() {
    if (!this.lastRemaining) return 0;
    const current = this.elapsed();
    const elapsed = current - this.startedElapsed;
    const wall = this.wall() - this.startedAt;
    if (!Number.isFinite(elapsed) || !Number.isFinite(wall) || current < this.lastElapsed
      || Math.abs(wall - elapsed) > 15_000) {
      this.lastRemaining = 0;
      return 0;
    }
    this.lastElapsed = current;
    this.lastRemaining = Math.max(0, Math.min(this.lastRemaining, this.duration - Math.max(elapsed, wall)));
    return this.lastRemaining;
  }
}

class RemoteAuth {
  constructor(deadline) {
    this.deadline = deadline;
    this.invitation = null;
    this.device = null;
  }

  invite(origin) {
    const remaining = this.deadline.remaining();
    if (!remaining || this.device) throw new Error('Revoke the paired device before creating another link.');
    const token = secret();
    const duration = Math.min(remaining, INVITATION_AGE);
    const expiresAt = this.deadline.wall() + duration;
    this.invitation = {
      link: `${origin}/#pair=${token}`, expiresAt, hash: digest(token),
      elapsedUntil: this.deadline.elapsed() + duration,
    };
  }

  availableInvitation() {
    const invitation = this.invitation;
    if (!invitation) return null;
    if (!this.deadline.remaining() || this.deadline.wall() >= invitation.expiresAt
      || this.deadline.elapsed() >= invitation.elapsedUntil) {
      this.invitation = null;
      return null;
    }
    return invitation;
  }

  pair(token, label) {
    if (this.device || !valid(token, this.availableInvitation()?.hash)) return null;
    this.invitation = null;
    const credential = secret();
    this.device = {label, hash: digest(credential)};
    return `${COOKIE}=${credential}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(this.deadline.remaining() / 1000)}`;
  }

  authorize(cookie) {
    if (!this.device || !this.deadline.remaining()) return false;
    const values = (cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(COOKIE + '='));
    return values.length === 1 && valid(values[0].slice(COOKIE.length + 1), this.device.hash);
  }

  revoke() {
    this.invitation = null;
    this.device = null;
  }
}

const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
module.exports = {AccessDeadline, RemoteAuth, clearCookie};
