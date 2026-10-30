# Mailbell for Gmail

A Firefox toolbar extension that tells you when new Gmail arrives and lets you read, archive, delete or unsubscribe without opening Gmail.

Mailbell signs in with Google OAuth and talks to the official [Gmail API](https://developers.google.com/gmail/api). It never reads your Gmail cookies or scrapes the Gmail web page.

## Features

- Desktop notifications for new unread mail in your inbox, with an optional custom sound.
- Several Google accounts side by side.
- Read whole threads in the popup, including HTML mail, inline images and attachments, with automatic dark mode.
- Archive, delete, mark as read or unread, or report spam, for one thread or in bulk.
- One-click unsubscribe (RFC 8058) when the sender supports it.
- One-time codes from verification emails shown ready to copy.

## Privacy

Your mail goes only between your browser and Google. Mailbell has no server, no analytics and no telemetry. Tokens and cached mail stay in the extension's local storage. Removing an account revokes its token with Google.

Mailbell asks for the `gmail.modify` scope. That scope lets it read mail and change labels (read, archive, spam, trash). It cannot delete mail permanently or send mail.

## Sign-in and the "unverified app" warning

Google classes Gmail scopes as *restricted*. Until an app passes Google's verification and security assessment, Google treats it as unverified:

- Sign-in shows a "Google hasn't verified this app" screen. Click **Advanced → Go to Mailbell (unsafe)** to continue.
- The built-in client is limited to 100 users in total.

To avoid both, use your own Google Cloud OAuth client. Go to **Settings → Google OAuth client** in the popup and follow [docs/SETUP.md](docs/SETUP.md). It takes about five minutes, is free, and the client is used only by you.

## Development

```sh
pnpm install
cp .env.example .env    # optional: built-in OAuth client, see docs/SETUP.md
pnpm dev:firefox        # or: pnpm dev (Chrome); then load the add-on, see below
pnpm test               # vitest in headless Chromium
pnpm compile            # type-check
pnpm zip:firefox        # AMO upload + sources zip in .output/
```

Needs Node 22.12 or newer, and Firefox 140 or newer. The dev command doesn't open a browser: load `.output/firefox-mv3/manifest.json` in `about:debugging` → **This Firefox** → **Load Temporary Add-on**. A temporary add-on loses its storage when it is removed.

Without a `.env`, the build has no built-in client. Add a client under **Settings** before you sign in.

UI work follows [STYLE_GUIDE.md](STYLE_GUIDE.md). `pnpm test` enforces its rules.

## Credits

Mailbell is a fork of [rxliuli/gmail-notifier](https://github.com/rxliuli/gmail-notifier). The original reads Gmail through your browser session; Mailbell replaces that layer with OAuth and the Gmail API.

## License

[GPL-3.0](LICENSE.md)
