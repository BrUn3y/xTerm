const semver = require('semver');
const fs = require('node:fs');
const path = require('node:path');

const FEED = Object.freeze({ provider: 'github', owner: 'BrUn3y', repo: 'xTerm' });
const RETRIES = [30_000, 120_000, 600_000];
const PERIOD = 6 * 60 * 60 * 1000;

function updateError(code) {
  return Object.assign(new Error('Invalid update metadata.'), { code });
}

function releaseDecision(info, installed, platform, arch) {
  if (!info || typeof info.version !== 'string' || info.version.length > 100 || !semver.valid(info.version)) {
    throw updateError('ERR_UPDATER_INVALID_UPDATE_INFO');
  }
  const version = semver.valid(info.version);
  if (info.draft === true || info.prerelease === true || semver.prerelease(version) || !semver.gt(version, installed)) return null;
  if (typeof info.tag !== 'string' || info.tag.length > 101 || semver.valid(info.tag) !== version) {
    throw updateError('ERR_UPDATER_INVALID_UPDATE_INFO');
  }
  const extension = { darwin: '.zip', win32: '.exe', linux: '.AppImage' }[platform];
  const files = info.files;
  if (info.packages != null) throw updateError('ERR_UPDATER_INVALID_UPDATE_INFO');
  if (!Array.isArray(files) || !files.length || files.length > 32 || !extension) throw updateError('ERR_UPDATER_NO_FILES_PROVIDED');
  for (const file of files) {
    // GitHub release assets are filenames, never renderer-controlled URLs or paths.
    if (!file || typeof file.url !== 'string' || file.url.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.url) ||
        typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) {
      throw updateError('ERR_UPDATER_INVALID_UPDATE_INFO');
    }
  }
  if (!files.some(file => file.url.endsWith(extension) && (file.url.includes(`-${arch}.`) || file.url.includes(`-${arch}-`) ||
      platform === 'darwin' && file.url.includes('-universal.')))) throw updateError('ERR_UPDATER_NO_FILES_PROVIDED');
  return { version, releaseUrl: `https://github.com/BrUn3y/xTerm/releases/tag/${encodeURIComponent(info.tag)}` };
}

function safeError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (/CHECKSUM|SIGNATURE|CODE_SIGNATURE|ZIP/.test(code)) return 'The update could not be verified. Nothing was installed. Retry the download.';
  if (/CHANNEL_FILE|NO_FILES|NO_PUBLISHED|LATEST_VERSION/.test(code)) return 'Update metadata or a matching release asset is unavailable. Try checking again later.';
  if (/INVALID/.test(code)) return 'The release metadata is invalid. Nothing was downloaded or installed.';
  return 'The update request failed. Check your connection and try again. Your terminals are still running.';
}

function dismissalStore(directory) {
  const file = path.join(directory, 'update-dismissals.json');
  return {
    load() {
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.length < 100 && semver.valid(item)).slice(-32) : [];
      } catch { return []; }
    },
    save(versions) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(versions.slice(-32)), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    },
  };
}

class UpdateController {
  constructor({ updater, installed, enabled, unavailableReason, platform, arch, store, notify = () => {},
    confirmRestart = async () => false, install = () => updater.quitAndInstall(false, true),
    setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.updater = updater;
    this.installed = installed;
    this.enabled = enabled;
    this.platform = platform;
    this.arch = arch;
    this.store = store;
    this.notify = notify;
    this.confirmRestart = confirmRestart;
    this.install = install;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.deferred = new Set(store?.load() || []);
    this.retryCount = 0;
    this.busy = false;
    this.confirming = false;
    this.disposed = false;
    this.state = { status: enabled ? 'idle' : 'unavailable', installedVersion: installed, version: null,
      releaseUrl: null, progress: null, dismissed: false, message: enabled ? '' : unavailableReason };
    this.listeners = [];
    if (enabled) {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.autoRunAppAfterInstall = true;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      updater.forceDevUpdateConfig = false;
      updater.requestHeaders = null;
      updater.setFeedURL(FEED);
      this.listen('download-progress', value => {
        if (this.state.status !== 'downloading' || !Number.isFinite(value?.percent)) return;
        this.publish({ progress: Math.round(Math.max(0, Math.min(100, value.percent))) });
      });
      // An error event can arrive after MacUpdater's download promise resolved.
      this.listen('error', error => this.fail(error));
    }
  }
  listen(event, callback) { this.updater.on(event, callback); this.listeners.push([event, callback]); }
  snapshot() { return { ...this.state }; }
  publish(update) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    this.notify(this.snapshot());
  }
  schedule(delay) {
    this.clearTimer(this.timer);
    if (this.disposed || !this.enabled) return;
    this.timer = this.setTimer(() => void this.check(false), delay);
    this.timer?.unref?.();
  }
  start() { if (this.enabled) this.schedule(15_000); }
  fail(error) {
    if (this.disposed || !this.enabled) return;
    this.publish({ status: 'error', message: safeError(error), progress: null });
  }
  async check(manual = true) {
    if (!this.enabled || this.busy || this.confirming || ['ready', 'installing'].includes(this.state.status)) {
      if (manual && this.state.status === 'ready') this.publish({ dismissed: false });
      return this.snapshot();
    }
    this.busy = true;
    this.clearTimer(this.timer);
    if (manual) this.retryCount = 0;
    this.publish({ status: 'checking', version: null, releaseUrl: null, progress: null, dismissed: !manual, message: '' });
    try {
      const result = await this.updater.checkForUpdates();
      if (!result?.updateInfo) throw updateError('ERR_UPDATER_INVALID_UPDATE_INFO');
      const release = releaseDecision(result.updateInfo, this.installed, this.platform, this.arch);
      this.retryCount = 0;
      this.publish(release && result.isUpdateAvailable === false
        ? { status: 'unavailable', message: 'This release is not eligible for this system yet.', dismissed: !manual }
        : release ? { status: 'available', ...release, dismissed: !manual && this.deferred.has(release.version), message: '' } :
        { status: 'up-to-date', message: 'You are using the latest stable version.', dismissed: !manual });
      this.schedule(PERIOD);
    } catch (error) {
      this.fail(error);
      const delay = RETRIES[this.retryCount++];
      // After three bounded retries, wait for the normal periodic check.
      this.schedule(delay ?? PERIOD);
    } finally { this.busy = false; }
    return this.snapshot();
  }
  later() {
    if (this.state.version) {
      this.deferred.add(this.state.version);
      try { this.store?.save([...this.deferred]); } catch {
        this.publish({ message: 'Deferred for this run. Could not save the deferral for the next launch.' });
      }
    }
    this.publish({ dismissed: true });
    return this.snapshot();
  }
  async download() {
    if (!this.enabled || this.busy || this.confirming || !this.state.version ||
        !['available', 'error'].includes(this.state.status)) return this.snapshot();
    this.busy = true;
    this.clearTimer(this.timer);
    this.publish({ status: 'downloading', progress: 0, dismissed: false, message: '' });
    try {
      await this.updater.downloadUpdate();
      // Only the supported updater's successful promise admits a verified download.
      // On macOS the ZIP checksum is checked here; Squirrel checks the signature
      // when quitAndInstall is requested, before its native quit event.
      if (this.state.status === 'downloading') this.publish({ status: 'ready', progress: 100, message:
        this.platform === 'darwin' ? 'Download verified. macOS will verify the code signature before installation.' : 'Download verified. Ready to restart.' });
    } catch (error) { this.fail(error); }
    finally { this.busy = false; }
    return this.snapshot();
  }
  async restart() {
    if (!this.enabled || this.busy || this.confirming || this.state.status !== 'ready') return this.snapshot();
    this.confirming = true;
    try {
      const accepted = await this.confirmRestart(this.state.version);
      if (accepted !== true || this.state.status !== 'ready' || this.disposed) return this.snapshot();
      this.publish({ status: 'installing', dismissed: false, message: 'Verifying and restarting...' });
      await this.install();
    } catch (error) { this.fail(error); }
    finally { this.confirming = false; }
    return this.snapshot();
  }
  dispose() {
    this.disposed = true;
    this.clearTimer(this.timer);
    for (const [event, callback] of this.listeners) this.updater.removeListener(event, callback);
  }
}

function registerUpdateIpc(ipcMain, controller, getWindow) {
  const validSender = event => {
    const window = getWindow();
    return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  };
  ipcMain.handle('updates:state', (event, ...args) => {
    if (!validSender(event) || args.length) throw new Error('Invalid update request.');
    return controller.snapshot();
  });
  ipcMain.handle('updates:action', (event, action, ...args) => {
    if (!validSender(event) || args.length || typeof action !== 'string' || !['check', 'download', 'later', 'restart'].includes(action)) {
      throw new Error('Invalid update request.');
    }
    if (action === 'check') return controller.check(true);
    return controller[action]();
  });
}

function restartDialog(version, count) {
  return {
    type: 'warning', title: 'Restart and update xTerm',
    message: `Restart xTerm to install v${version}?`,
    detail: `${count} active terminal session${count === 1 ? '' : 's'} will close. Running shells and processes will end and sessions will not be restored. Appearance preferences and saved workspace folders are kept.`,
    buttons: ['Cancel', 'Restart and update'], defaultId: 0, cancelId: 0, noLink: true,
  };
}

function installUpdate(updater, nativeUpdater, platform) {
  if (platform !== 'darwin') return updater.quitAndInstall(false, true);
  // MacUpdater has already prepared its authenticated loopback ZIP feed. Stage
  // through Squirrel only after consent, and do not leave an install listener
  // behind if native signature validation fails or times out.
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      nativeUpdater.removeListener('error', failed);
      nativeUpdater.removeListener('update-downloaded', verified);
    };
    const failed = error => { cleanup(); reject(error); };
    const verified = () => {
      cleanup();
      try { updater.quitAndInstall(false, true); resolve(); } catch (error) { reject(error); }
    };
    const timer = setTimeout(() => failed(new Error('Native update verification timed out.')), 120_000);
    timer.unref?.();
    nativeUpdater.once('error', failed);
    nativeUpdater.once('update-downloaded', verified);
    try { nativeUpdater.checkForUpdates(); } catch (error) { failed(error); }
  });
}

module.exports = { UpdateController, releaseDecision, safeError, dismissalStore, registerUpdateIpc, restartDialog, installUpdate, FEED, RETRIES, PERIOD };
