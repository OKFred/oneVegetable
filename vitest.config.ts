import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    // Keep Windows cold Vue imports below the existing timeout when the whole
    // suite runs alongside the local workbench and native browser processes.
    ...(process.platform === 'win32' ? { maxWorkers: 2 } : {}),
    setupFiles: ['./packages/ui/test/setup.ts'],
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'apps/api/test-worker/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] }
  }
});
