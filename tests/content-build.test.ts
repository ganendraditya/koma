import { describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';
import { Script } from 'node:vm';

describe('Content script packaging', () => {
  it.each(['production', 'development'])(
    'emits a standalone classic script in %s mode',
    async (mode) => {
      let watchedFiles: string[] = [];
      const result = await build({
        mode,
        logLevel: 'silent',
        build: { write: false },
        plugins: [
          {
            name: 'inspect-watched-files',
            generateBundle() {
              watchedFiles = this.getWatchFiles();
            },
          },
        ],
      });
      const bundles = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
      const content = bundles
        .flatMap((bundle) => bundle.output)
        .find((file) => file.fileName === 'content.js');
      expect(content).toBeDefined();
      const code = content!.type === 'chunk' ? content!.code : String(content!.source);
      expect(() => new Script(code)).not.toThrow();
      expect(code).toContain('.md--reader-pages img.img');
      expect(code.includes('console.debug')).toBe(mode === 'development');
      expect(watchedFiles.some((path) => path.endsWith('/adapters/mangadex.ts'))).toBe(true);
    }
  );
});
