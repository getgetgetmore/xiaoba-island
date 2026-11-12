import { defineConfig } from 'vite';

// base: './' 使构建产物可被 Electron 以 file:// 加载
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: '127.0.0.1',
    watch: { ignored: ['**/shots/**', '**/dist/**'] },
  },
});
