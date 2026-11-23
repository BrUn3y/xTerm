import {ansiColor, lightPanelColors} from './lib/terminal-colors.mjs';
import {themeColors} from './settings';
import type {Settings} from './types';

const names = ['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'] as const;
const palettes = {light: names.map(name => themeColors.light[name]), dark: names.map(name => themeColors.dark[name])};

// xterm's render event keeps buffer colors intact, including scrollback and dark-mode restoration.
export function adaptTerminalRows(root: HTMLElement, mode: Settings['theme'], start: number, end: number) {
  const rows = root.querySelector('.xterm-rows')?.children;
  if (!rows) return;
  const theme = themeColors[mode];
  for (let row = start; row <= Math.min(end, rows.length - 1); row++) {
    for (const span of rows[row].querySelectorAll<HTMLElement>('span')) {
      span.classList.remove('xterm-adapted-bg', 'xterm-adapted-fg');
      span.style.removeProperty('--xterm-adapted-fg');
      if (mode !== 'light' || span.classList.contains('xterm-cursor') || span.classList.contains('xterm-decoration-top')) continue;
      const bgClass = Array.from(span.classList).find(value => /^xterm-bg-\d+$/.test(value));
      const fgClass = Array.from(span.classList).find(value => /^xterm-fg-\d+$/.test(value));
      const background = span.style.backgroundColor || (bgClass ? +bgClass.slice(9) === 257 ? theme.foreground : ansiColor(+bgClass.slice(9), palettes[mode], theme.background, theme.foreground) : null);
      if (!background) continue;
      const foreground = span.style.color || (fgClass ? ansiColor(+fgClass.slice(9), palettes[mode], theme.background, theme.foreground) : theme.foreground);
      const colors = lightPanelColors(background, foreground);
      if (!colors) continue;
      span.classList.add('xterm-adapted-bg', 'xterm-adapted-fg');
      span.style.setProperty('--xterm-adapted-fg', colors.foreground);
    }
  }
}
