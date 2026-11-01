import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { resolve } from 'node:path'

// Store screenshots, rendered from the real UI with sample mail. Unlike the
// test config this one loads Tailwind, so the app is styled as it ships.
const root = resolve(import.meta.dirname, '../..')
process.env.TZ = 'America/New_York'

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  test: {
    include: ['scripts/screenshots/**/*.shots.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        contextOptions: { locale: 'en-US', timezoneId: 'America/New_York', deviceScaleFactor: 1, viewport: { width: 1800, height: 1200 } },
      }),
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
    },
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': root,
    },
  },
  optimizeDeps: {
    include: ['@webext-core/fake-browser'],
  },
})
