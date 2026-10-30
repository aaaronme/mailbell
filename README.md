# Mailbell for Gmail

A Firefox and Chrome toolbar extension that tells you when new Gmail arrives and lets you read, archive, delete or unsubscribe without opening Gmail.

Mailbell signs in with Google OAuth and talks to the official [Gmail API](https://developers.google.com/gmail/api). It never reads your Gmail cookies or scrapes the Gmail web page.

## Features

- Desktop notifications for new unread mail in your inbox: for all mail, Primary only or Important only, with quiet hours, and on or off per account.
- A notification sound per account: four built-in sounds or your own file (Firefox).
- Several Google accounts side by side.
- Read whole threads in the popup, including HTML mail, inline images and attachments, with automatic dark mode.
- Archive, delete, mark as read or unread, or report spam, for one thread or in bulk.
- Quick reply and reply all from the opened thread, in plain text.
- Meeting invites and video-call links (Google Meet, Zoom, Teams, Webex): join in one click, or add the event to Google Calendar.
- Gmail's keyboard shortcuts: `j`/`k` to move, `Enter` to open, `e` archive, `#` trash, `Shift+I` mark as read, `!` spam, `u` back, `c` compose.
- One-click unsubscribe (RFC 8058) when the sender supports it.
- One-time codes from verification emails shown ready to copy.

## Privacy

Your mail goes only between your browser and Google. Mailbell has no server, no analytics and no telemetry. Tokens and cached mail stay in the extension's local storage. Removing an account revokes its token with Google.

Mailbell asks for the `gmail.modify` scope. That scope lets it read mail, change labels (read, archive, spam, trash) and send mail; Mailbell sends only the replies you write in the popup. It cannot delete mail permanently.

## Sign-in: your own Google client

Google lets an app read Gmail only through an OAuth client registered in Google Cloud, and classes the Gmail scopes as *restricted*: a client shared by many users needs Google's yearly security assessment. Mailbell therefore ships without one. Each user creates their own, which is free and takes about five minutes:

1. Open the popup. With no client yet, it shows **Set up your Google client**, a step-by-step guide with the redirect URI to copy.
2. Create the client in Google Cloud as the guide says, paste its ID and secret, and click **Save and sign in**.

Sign-in then shows a "Google hasn't verified this app" screen, because your client is unverified. That's expected for a client only you use: click **Advanced → Go to (your app name)**. [docs/SETUP.md](docs/SETUP.md) has the long version and troubleshooting. You can change the client later under **Settings → Google OAuth client**.

A publisher can also build a client into a release (`.env`, see [.env.example](.env.example)); users can still override it with their own.

## Development

```sh
pnpm install
cp .env.example .env    # optional: built-in OAuth client, see docs/SETUP.md
pnpm dev:firefox        # or: pnpm dev (Chrome); then load the add-on, see below
pnpm test               # vitest in headless Chromium
pnpm compile            # type-check
pnpm zip:firefox        # AMO upload + sources zip in .output/
pnpm zip                # Chrome Web Store upload in .output/
```

Needs Node 22.12 or newer, and Firefox 140 or newer. The dev command doesn't open a browser: load `.output/firefox-mv3/manifest.json` in `about:debugging` → **This Firefox** → **Load Temporary Add-on**. A temporary add-on loses its storage when it is removed.

In Chrome, run `pnpm build` and load `.output/chrome-mv3` from `chrome://extensions` with **Developer mode** on → **Load unpacked**.

Without a `.env`, the build has no built-in client and the popup opens on the setup guide.

Releasing to AMO and the Chrome Web Store: [docs/RELEASING.md](docs/RELEASING.md).

UI work follows [STYLE_GUIDE.md](STYLE_GUIDE.md). `pnpm test` enforces its rules.

## Credits

Mailbell is a fork of [rxliuli/gmail-notifier](https://github.com/rxliuli/gmail-notifier). The original reads Gmail through your browser session; Mailbell replaces that layer with OAuth and the Gmail API.

## License

[GPL-3.0](LICENSE.md)
