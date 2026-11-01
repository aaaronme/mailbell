# Store screenshots

Renders the Chrome Web Store screenshots (`docs/assets/store/1-…5-*.png`, 1280×800) from the real popup and mail client, styled with Tailwind, against a fake Gmail API serving the made-up mail in `fixtures.ts`.

```sh
pnpm exec vitest run --config scripts/screenshots/vitest.config.ts
```
