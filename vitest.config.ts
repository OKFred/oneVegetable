import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'apps/api/test-worker/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] }
  }
});
