// Renders the website's link-preview cards (docs/assets/og/*.png, 1200×630)
// and the Chrome Web Store promo tiles (docs/assets/store/*.jpg: JPEG, as the
// store rejects an alpha channel). Run after changing any text:
// node scripts/og-images.mjs
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const cards = {
  home: ['Your Gmail, from the toolbar.', 'Nothing in between.'],
  features: ['Features', 'Notifications, a full reader, one-click actions and more.'],
  compare: ['How Mailbell compares', 'Against a Gmail tab, other notifiers and desktop apps.'],
  faq: ['Questions and answers', 'Privacy, permissions, browsers and signing in.'],
  privacy: ['Privacy policy', 'No server. Nothing collected. Your mail stays yours.'],
}

const icon = readFileSync('public/icon/128.png').toString('base64')
const html = (title, subtitle) => `<!doctype html>
<html><body style="margin:0">
<div style="width:1200px;height:630px;box-sizing:border-box;padding:80px 88px;display:flex;flex-direction:column;
  background:linear-gradient(120deg,#00111b,#06303f);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">
  <div style="display:flex;align-items:center;gap:20px;font-size:32px;font-weight:600">
    <img src="data:image/png;base64,${icon}" width="64" height="64">Mailbell for Gmail
  </div>
  <div style="margin-top:auto;font-size:76px;font-weight:700;line-height:1.05;letter-spacing:-0.025em">${title}</div>
  <div style="margin-top:24px;font-size:34px;line-height:1.3;color:rgb(255 255 255 / 0.7)">${subtitle}</div>
  <div style="margin-top:48px;font-size:24px;color:#7cd0e8">Free and open source · Firefox and Chrome</div>
</div></body></html>`

// A promo tile: the icon over the name and the tagline, scaled by `u`.
const tile = (width, height, u) => `<!doctype html>
<html><body style="margin:0">
<div style="width:${width}px;height:${height}px;box-sizing:border-box;padding:${48 * u}px ${56 * u}px;display:flex;flex-direction:column;justify-content:center;
  background:linear-gradient(120deg,#00111b,#06303f);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">
  <img src="data:image/png;base64,${icon}" width="${64 * u}" height="${64 * u}">
  <div style="margin-top:${24 * u}px;font-size:${44 * u}px;font-weight:700;letter-spacing:-0.025em">Mailbell for Gmail</div>
  <div style="margin-top:${10 * u}px;font-size:${22 * u}px;line-height:1.3;color:rgb(255 255 255 / 0.7)">Your Gmail, from the toolbar. Nothing in between.</div>
  <div style="margin-top:${20 * u}px;font-size:${16 * u}px;color:#7cd0e8">Private · Free and open source</div>
</div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
for (const [name, [title, subtitle]] of Object.entries(cards)) {
  await page.setContent(html(title, subtitle))
  await page.screenshot({ path: `docs/assets/og/${name}.png` })
}
for (const [name, width, height, u] of [
  ['promo-small', 440, 280, 0.62],
  ['promo-marquee', 1400, 560, 1.5],
]) {
  await page.setViewportSize({ width, height })
  await page.setContent(tile(width, height, u))
  await page.screenshot({ path: `docs/assets/store/${name}.jpg`, type: 'jpeg', quality: 92 })
}
await browser.close()
