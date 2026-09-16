import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'core'),
      '@providers': resolve(__dirname, 'providers'),
      '@adapters': resolve(__dirname, 'adapters'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'extension/popup/index.html'),
        background: resolve(__dirname, 'extension/background/service-worker.ts'),
        content: resolve(__dirname, 'extension/content/content-script.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          if (chunkInfo.name === 'content') {
            return 'content.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'extension/manifest.json',
          dest: '.',
        },
        {
          src: 'extension/icons',
          dest: '.',
        },
      ],
    }),
  ],
});
