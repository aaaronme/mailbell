// Renders assets/icon/*.svg to the PNGs the manifest and setIcon use:
// public/icon/<size>.png (no unread mail) and public/icon/unread/<size>.png.
// Run after editing an SVG: node scripts/icons.mjs
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const SIZES = [16, 32, 48, 96, 128]
const OUT = { idle: 'public/icon', unread: 'public/icon/unread' }

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, dir] of Object.entries(OUT)) {
  const svg = await readFile(`assets/icon/${name}.svg`, 'utf8')
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`)
    await page.locator('svg').screenshot({ path: `${dir}/${size}.png`, omitBackground: true })
  }
}
await browser.close()
