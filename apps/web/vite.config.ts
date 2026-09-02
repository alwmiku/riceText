import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const apiProxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    watch: {
      // 外部工具以「临时文件 + 原子替换」写文件时，Windows 上 fs.watch 会报
      // EBUSY 导致 watcher 崩溃、dev server 退出（表现为改代码不生效）。
      // 轮询 + 忽略临时文件可避免。
      usePolling: true,
      ignored: [/.tmp$/u, /.tmpdir/u],
    },
    proxy: {
      '/api': apiProxyTarget,
      '/uploads': apiProxyTarget,
    },
  },
  build: {
    sourcemap: true,
  },
});
