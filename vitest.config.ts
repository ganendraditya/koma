import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'core'),
      '@providers': resolve(__dirname, 'providers'),
      '@adapters': resolve(__dirname, 'adapters'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
