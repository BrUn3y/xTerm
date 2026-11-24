export function createAppKeyHandler(
  terminal: {hasSelection(): boolean; getSelection(): string},
  copy: (text: string) => void,
  paste: () => void,
): (event: KeyboardEvent) => boolean;
