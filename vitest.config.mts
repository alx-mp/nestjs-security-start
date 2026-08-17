import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  plugins: [
    // SWC keeps decorator metadata; esbuild (vitest default) drops it.
    // ES module output is required: vitest 4 cannot be require()d.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
