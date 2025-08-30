import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      include: ['lib/**/*.mjs'],
      provider: 'v8'
    },
    include: ['tests/*.test.js']
  }
})
