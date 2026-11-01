// Renders the website's link-preview cards (docs/assets/og/*.png, 1200×630).
// Run after changing a card's text: node scripts/og-images.mjs
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

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
for (const [name, [title, subtitle]] of Object.entries(cards)) {
  await page.setContent(html(title, subtitle))
  await page.screenshot({ path: `docs/assets/og/${name}.png` })
}
await browser.close()
