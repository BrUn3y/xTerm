import type { Terminal } from '@xterm/xterm';

interface InputService {
  triggerDataEvent(data: string, userInput?: boolean): void;
}

// The public onData event combines keystrokes, paste, and emulator replies.
// Keep this integration with the pinned xterm version in one place.
export function bindTerminalInput(
  terminal: Terminal, input: (data: string) => void, response?: (data: string) => void,
) {
  const service = (terminal as unknown as {_core: {coreService: InputService}})._core.coreService;
  const trigger = service.triggerDataEvent;
  let fromUser = false;
  const disposable = terminal.onData(data => {
    if (fromUser) input(data);
    else response?.(data);
  });
  service.triggerDataEvent = function (data, userInput) {
    fromUser = !!userInput;
    try { trigger.call(this, data, userInput); }
    finally { fromUser = false; }
  };
  return {
    dispose() {
      service.triggerDataEvent = trigger;
      disposable.dispose();
    },
  };
}
