import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx,mjs}'],
          exclude: [...configDefaults.exclude, 'test/integration/**'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.{test,spec}.{ts,tsx,mjs}'],
          exclude: [...configDefaults.exclude],
          testTimeout: 300000,
          hookTimeout: 300000,
        },
      },
    ],
  },
});
