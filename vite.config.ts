import { build, defineConfig, type Rollup } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const alias = {
  '@core': resolve(__dirname, 'core'),
  '@providers': resolve(__dirname, 'providers'),
  '@adapters': resolve(__dirname, 'adapters'),
  '@shared': resolve(__dirname, 'shared'),
};

export default defineConfig(({ mode }) => ({
  base: './',
  resolve: {
    alias,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'extension/popup/index.html'),
        background: resolve(__dirname, 'extension/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  plugins: [
    {
      name: 'classic-content-script',
      apply: 'build',
      async generateBundle() {
        const parentBuild = this;
        // Manifest content scripts cannot import the popup's shared ES modules.
        const result = await build({
          configFile: false,
          mode,
          logLevel: 'silent',
          resolve: { alias },
          build: {
            write: false,
            lib: {
              entry: resolve(__dirname, 'extension/content/content-script.ts'),
              name: 'KomaContent',
              formats: ['iife'],
              fileName: () => 'content.js',
            },
          },
          plugins: [
            {
              name: 'watch-content-dependencies',
              buildEnd() {
                for (const id of this.getModuleIds()) {
                  if (!id.startsWith('\0')) parentBuild.addWatchFile(id);
                }
              },
            },
          ],
        });
        const bundles = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
        for (const { output } of bundles) {
          for (const file of output) {
            this.emitFile({
              type: 'asset',
              fileName: file.fileName,
              source: file.type === 'chunk' ? file.code : file.source,
            });
          }
        }
      },
    },
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
}));
