import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  plugins: [
    // SWC emits the decorator metadata Nest's DI reads at runtime.
    // ES module output is required: vitest (4 and later) cannot be require()d.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
