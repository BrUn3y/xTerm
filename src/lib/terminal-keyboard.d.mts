export function createAppKeyHandler(
  terminal: {hasSelection(): boolean; getSelection(): string},
  copy: (text: string) => void,
): (event: KeyboardEvent) => boolean;
