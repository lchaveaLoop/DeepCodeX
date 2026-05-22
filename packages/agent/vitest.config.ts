import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        branches: 25,
        functions: 40,
        lines: 40,
        statements: 40,
      },
      include: ['src/**/*.ts'],
    },
  },
})
