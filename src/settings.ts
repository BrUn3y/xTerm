import type { Settings } from './types';
export const fonts = [
  {name: 'JetBrains Mono', value: '"JetBrains Mono Variable", monospace', detail: 'Precise. Made for code.'},
  {name: 'IBM Plex Mono', value: '"IBM Plex Mono", monospace', detail: 'Industrial character.'},
  {name: 'Menlo', value: 'Menlo, Consolas, monospace', detail: 'The macOS classic.'},
  {name: 'SF Mono', value: '"SF Mono", Menlo, monospace', detail: 'Simple and familiar.'},
];
export const defaultSettings: Settings = {
  font: fonts[0].value, fontSize: 13, lineHeight: 1.65, cursor: 'block',
  theme: 'light', background: 'blueprint', showHidden: false, scrollback: 10000, motion: true,
};
export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('xterm.settings') || '{}');
    return {
      font: fonts.some(f => f.value === saved.font) ? saved.font : defaultSettings.font,
      fontSize: typeof saved.fontSize === 'number' ? Math.max(10, Math.min(24, saved.fontSize)) : defaultSettings.fontSize,
      lineHeight: [1.25, 1.45, 1.65, 1.85].includes(saved.lineHeight) ? saved.lineHeight : defaultSettings.lineHeight,
      cursor: ['block','bar','underline'].includes(saved.cursor) ? saved.cursor : defaultSettings.cursor,
      // Legacy themes only styled the terminal; start the unified appearance in light mode.
      theme: ['light','dark'].includes(saved.theme) ? saved.theme : defaultSettings.theme,
      background: ['blueprint','clean','contours'].includes(saved.background) ? saved.background : defaultSettings.background,
      showHidden: typeof saved.showHidden === 'boolean' ? saved.showHidden : false,
      scrollback: [1000,10000,50000].includes(saved.scrollback) ? saved.scrollback : 10000,
      motion: typeof saved.motion === 'boolean' ? saved.motion : true,
    };
  } catch { return defaultSettings; }
}
export const themeColors = {
  dark: { background: '#20221f', foreground: '#d8dcd1', cursor: '#ff6537', selectionBackground: '#57634d88', black: '#42473e', red: '#ff836b', green: '#b5cd98', yellow: '#e3c983', blue: '#a3bcd0', magenta: '#c6a3c8', cyan: '#8ccbc1', white: '#d8dcd1', brightBlack: '#818977', brightRed: '#ffa58e', brightGreen: '#d3e7b9', brightYellow: '#f8df9c', brightBlue: '#c7dfec', brightMagenta: '#e4c3e5', brightCyan: '#aceade', brightWhite: '#f1f3eb' },
  light: { background: '#f3f2ed', foreground: '#353c32', cursor: '#ef572c', selectionBackground: '#c3c8b7', black: '#353c32', red: '#b83d2f', green: '#4f713c', yellow: '#8e6825', blue: '#35658a', magenta: '#83508b', cyan: '#28796e', white: '#6b7167', brightBlack: '#777e70', brightRed: '#cd503b', brightGreen: '#5e8348', brightYellow: '#a0792a', brightBlue: '#427ba7', brightMagenta: '#9c64a3', brightCyan: '#36998e', brightWhite: '#353c32' },
};
export const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || '/';
export const shortPath = (path: string, home: string) => path === home ? '~' : path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;
export const quoteShell = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export const formatSize = (size: number) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
