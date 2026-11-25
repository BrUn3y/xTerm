const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

const HISTORY = 500;
const MAX_SNAPSHOT = 2 * 1024 * 1024;

class TerminalState {
  constructor(cols, rows, publish, setPaused) {
    this.terminal = new Terminal({
      cols, rows, scrollback: HISTORY, allowProposedApi: true, disableStdin: true,
      logLevel: 'off', vtExtensions: {kittyKeyboard: true},
    });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
    this.publish = publish;
    this.setPaused = setPaused;
    this.queue = [];
    this.queuedBytes = 0;
    this.sequence = 0;
    this.writing = false;
    this.paused = false;
    this.disposed = false;
  }

  enqueue(event) {
    this.queue.push(event);
    this.queuedBytes += event.data?.length ?? 0;
    if (this.queuedBytes >= 256 * 1024 && !this.paused) {
      this.paused = true;
      this.setPaused(true);
    }
    this.drain();
  }

  drain() {
    if (this.writing || this.disposed) return;
    while (this.queue.length) {
      const event = this.queue.shift();
      if (event.type === 'output') {
        this.writing = true;
        this.terminal.write(event.data, () => {
          if (this.disposed) return;
          this.queuedBytes -= event.data.length;
          if (this.paused && this.queuedBytes < 128 * 1024) {
            this.paused = false;
            this.setPaused(false);
          }
          this.writing = false;
          this.publish({...event, sequence: ++this.sequence});
          this.drain();
        });
        return;
      }
      if (event.type === 'clear') this.terminal.clear();
      else this.terminal.resize(event.cols, event.rows);
      this.publish({...event, sequence: ++this.sequence});
    }
  }

  snapshot() {
    const {terminal} = this;
    // The serializer cannot save an unfinished control sequence. Wait for a
    // parser boundary before letting a new subscriber follow the live stream.
    if (this.writing || terminal._core._inputHandler._parser.currentState !== 0) return null;
    const core = terminal._core;
    const buffer = core.buffer;
    const keyboard = core.coreService.kittyKeyboard;
    const alternate = terminal.buffer.active.type === 'alternate';
    const keys = (stack, flags) => stack.length
      ? `\x1b[=${stack[0]}u${[...stack.slice(1), flags].map(value => `\x1b[>${value}u`).join('')}`
      : flags ? `\x1b[=${flags}u` : '';
    const normalKeys = keys(keyboard.mainStack, alternate ? keyboard.mainFlags : keyboard.flags);
    const alternateKeys = alternate ? keys(keyboard.altStack, keyboard.flags) : '';
    const mouseEncoding = {SGR: '\x1b[?1006h', SGR_PIXELS: '\x1b[?1016h'}[core.mouseStateService.activeEncoding] ?? '';
    const origin = terminal.modes.originMode;
    const cursor = origin || buffer.scrollTop || buffer.scrollBottom !== terminal.rows - 1
      ? `\x1b[${Math.max(0, buffer.y - (origin ? buffer.scrollTop : 0)) + 1};${Math.min(buffer.x + 1, terminal.cols)}H`
      : '';
    const serialize = scrollback => normalKeys + this.serializer.serialize({scrollback}) + cursor + alternateKeys + mouseEncoding;
    const data = serialize(HISTORY);
    const bounded = Buffer.byteLength(data) <= MAX_SNAPSHOT
      ? data : serialize(0);
    if (Buffer.byteLength(bounded) > MAX_SNAPSHOT) throw new Error('This terminal screen is too large to share.');
    return {type: 'snapshot', data: bounded, cols: terminal.cols, rows: terminal.rows, sequence: this.sequence};
  }

  dispose() {
    this.disposed = true;
    this.queue.length = 0;
    this.terminal.dispose();
  }
}

module.exports = {TerminalState};
