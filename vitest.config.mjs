import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      include: ['lib/**/*.mjs'],
      exclude: ['lib/index.mjs', 'lib/helpers/*.mjs', 'lib/parsers/xml.mjs', 'lib/remote/*.mjs'],
      provider: 'v8'
    },
    include: ['tests/*.test.js']
  }
})
