import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => ({
  plugins: [react()],
  base: './',
  server: {host: '127.0.0.1', port: 5173, strictPort: true},
  ...(mode === 'remote' ? {
    root: 'remote',
    build: {outDir: '../dist/remote', emptyOutDir: true, assetsInlineLimit: 0, rollupOptions: {output: {manualChunks: {terminal: ['@xterm/xterm']}}}},
  } : {
    build: {rollupOptions: {output: {manualChunks: {'terminal': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search', '@xterm/addon-web-links']}}}},
  }),
}));
