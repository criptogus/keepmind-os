import { configDefaults, defineConfig } from 'vitest/config';

const integration = process.argv.includes('integration');

export default defineConfig({
  test: {
    projects: [{
      test: {
        name: integration ? 'integration' : 'unit',
        environment: 'node',
        include: integration
          ? ['test/integration/**/*.{test,spec}.{ts,tsx,mjs}']
          : ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx,mjs}'],
        exclude: integration
          ? [...configDefaults.exclude]
          : [...configDefaults.exclude, 'test/integration/**'],
      },
    }],
  },
});
