# Popout mail client: design

Date: 2026-10-31. Status: draft for approval.

## Intent

Mailbell's toolbar popup is a quick unread list, and the owner is happy with it. The popout tab (`popup.html?view=tab`) today shows that same narrow list stretched across a tab. The owner wants the popout to become a full mail client, a desktop-style app in a browser tab, with Mimestream (the native macOS Gmail client) as the reference for *what it can do*.

The deeper why: the owner should be able to do all their Gmail work without ever opening `mail.google.com`, and ideally without being signed in to Google in the browser at all. Everything goes through the Gmail API with the extension's own OAuth token.

In the owner's words: "basically just copy Mimestream but as a browser extension", "sidebar with accounts and labels, list and reading pane, review read messages too, trash, spam", "undo for delete action visible for a moment", "own compose window please", "formatting and attachments too", "so nothing goes to gmail domain directly".

## Goals

1. **Three-pane layout in the popout tab:** sidebar (accounts and labels), thread list, reading pane. The owner picked this over a two-pane, open-in-place layout.
2. **Any folder, read mail included:** Inbox, Starred, Sent, Drafts, All Mail, Spam, Trash and the user's own labels, for each account. Read mail is listed, not only unread.
3. **Search** in Gmail's own query syntax.
4. **Actions with Undo:** archive, delete, spam, mark read or unread, star, plus "Not spam" and "Restore" in Spam and Trash. A toast with **Undo** shows for a few seconds after each of these.
5. **Mailbell's own compose:** new mail, reply, reply all and forward, with formatting, attachments, drafts, send-as aliases and signatures. No Gmail compose window.
6. **No Gmail website needed.** Once an account is signed in, nothing in the popout requires `mail.google.com`. Sign-in itself still goes through `accounts.google.com` once per account, which can't be avoided; after that the browser doesn't need a Google session.

## Non-goals

- **The toolbar popup doesn't change.** It keeps its unread list, its plain-text quick reply and its "Open in Gmail" links. The owner said it is "mostly ok" as is.
- **No snooze and no scheduled send:** the Gmail API exposes neither.
- **No full offline mirror of the mailbox:** folders load on demand, page by page.
- **No new OAuth scopes in this project.** Everything here fits within `gmail.modify`. Contacts autocomplete through the People API would need a new scope, so every user would have to re-consent; it's left for later (see Later).
- **No servers and no push.** Polling stays as it is.

## Anti-goals (failure even if it works)

- **Copying Mimestream's code, assets or visual identity.** Features are the reference; the look is Mailbell's own (`STYLE_GUIDE.md`), and nothing is taken from the Mimestream binary.
- **Breaking or slowing the toolbar popup**, or regressing notifications and one-time codes.
- **Anything in the popout that silently sends the user to `mail.google.com`.** "Open in Gmail" may stay as an explicit, secondary menu item.
- **Rendering untrusted mail or pasted HTML without DOMPurify** (`lib/sanitizeMail.ts`). AMO reviews this.
- **Losing a message being written:** an unsent draft must survive a closed window or a crash.

## Constraints

- **Stack:** WXT 0.21 MV3, React 19, TanStack Router and Query, Tailwind v4, radix-ui, lucide, sonner. Tests use vitest 4 browser mode with `@webext-core/fake-browser`. Firefox 140+ and Chrome 120+.
- **Design:** `STYLE_GUIDE.md` is binding, and `lib/design/design.test.ts` enforces it: monochrome `foreground/N`, the `bell` accent for one-time codes only, flat, square, one filled button per view, sentence case.
- **Permissions:** no new manifest permissions or host permissions. Host access is `oauth2.googleapis.com` and `gmail.googleapis.com` only.
- **AMO review:** the build stays unminified; every HTML sink goes through DOMPurify; no remote code.
- **GPL-3.0.**
- **Shared code:** the popup and popout share one page (`entrypoints/popup`), and `isPopoutTab` (`entrypoints/popup/view.ts`) tells them apart. The popup's routes and pages must keep working unchanged.

## Decided by the owner

- The three-pane layout (option A of the mockups).
- Read mail is shown, alongside unread.
- Trash and Spam are browsable.
- Undo appears briefly after a delete (and, by extension, other destructive actions).
- Compose is Mailbell's own, with formatting and attachments.
- The popout should work with no Google session in the browser.
- Mimestream is the feature reference, and in general "think full-fledged mail client".

## My calls (proposed; the owner can override)

### Layout and navigation
- **Sidebar:** one collapsible section per signed-in account, listing Inbox, Starred, Sent, Drafts, All Mail, Spam, Trash, then the user's labels.
  - Labels named `a/b` nest under `a`.
  - Unread counts come from the labels API (`threadsUnread`) and show for Inbox, Spam, Drafts and user labels.
  - Settings and the account switcher (add, reconnect) sit at the bottom.
  - Inbox categories (Primary, Social, Promotions) are not separate entries in v1.
- **List:**
  - The header has the folder name and an All / Unread switch.
  - A search field searches the current account. When a search is active, the list shows the results for that account, and clearing it returns to the folder.
  - Rows show the sender (or the recipients, in Sent), subject, snippet, time, an unread dot, a star, an attachment icon and the one-time code (bell accent) when there is one.
  - The list pages with infinite scroll, using the Gmail API's `pageToken`.
  - Multi-select: checkboxes, `x`, and shift-click for ranges, for bulk actions.
- **Reading pane:** the thread view that `DetailPage` already provides (collapsed earlier messages, attachments, meeting invites, unsubscribe), with an action bar on top and the reply composer at the bottom. If nothing is selected, it shows an empty state.
- **Narrow tabs:** under about 1000 px wide the sidebar collapses to a toggle; under about 700 px it falls back to list-then-detail navigation.
- **URL state:** the popout tab's URL holds the account, folder, search and selected thread, so reload, back and forward work.
- **Notification click** *(my call)*:
  - If a popout tab is open, focus it and select that thread (Inbox of its account).
  - Otherwise, open the toolbar popup as today.
  - If the popup can't open, open a popout tab on that thread instead of `mail.google.com`. This replaces the current `openMailInWeb` fallback in `entrypoints/background.ts`.
- **Marking read** *(owner)*:
  - A selected thread is marked read after the user stays on it for about 2 seconds, so `j`/`k` past a thread doesn't mark it.
  - It's marked read at once when the user goes into the mail itself: clicking or scrolling in the reading pane, or `Enter`/`o`.
  - A setting offers "After 2 seconds" (the default), "Immediately" and "Only by hand".
  - This mark-read is silent (no Undo toast); `Shift+U` reverts it.
- **Keyboard:** Gmail's shortcuts, which work while the focus is in the list as well as in the reading pane *(owner: "shortcuts to delete from the side pane")*.
  - Movement: `j`/`k` move and the reading pane follows; `Enter`/`o` open, `u` deselects.
  - Actions: `e` archive, `#`, `Delete` and `Backspace` delete, `!` spam, `s` star, `Shift+U` unread, `Shift+I` read, `z` undo. They act on the selected thread, or on every checked thread when there is a multi-selection.
  - Writing: `c` compose, `r`/`a`/`f` reply, reply all and forward.
  - `/` focuses search, `g` then `i` / `s` / `t` / `d` go to Inbox, Starred, Sent and Drafts, and `?` shows a shortcut sheet.

### Data
- **Token ownership:** only the background service worker refreshes and stores tokens. The popout asks the background for a valid access token (a new message, e.g. `getAccessToken(account)`) and then calls `gmail.googleapis.com` directly from the page. This also fixes the earlier finding that an attachment download's token refresh could overwrite one being saved.
- **Queries:** TanStack Query, keyed by account, folder or search, and page.
  - Rows come from `threads.list` and then `threads.get?format=metadata`, a few in parallel. The full thread is fetched (`format=full`, through the existing `threadToMail`) only when it's opened.
  - The cache is in memory, plus `storage.session` for the last-viewed folder so the popout reopens instantly *(builder may simplify)*.
- **Preloading** *(owner: "preload messages so it's quick to navigate through")*:
  - The full threads for the first rows of a folder, and for the few rows either side of the selection, are fetched in the background, so `j`/`k` show the next mail without waiting. My call: the first 10 rows and 3 each side.
  - Preloading never marks anything read, and it runs at low concurrency so it doesn't delay what the user actually clicked.
  - Inline images are fetched with the thread; remote content follows the rules under **Remote content and suspicious mail**.
- **Freshness:** when the background poll sees a new `historyId` it already pushes `refreshPopup`; the popout invalidates its folder and label-count queries on that push. After any action, the affected rows update at once (optimistic), and the background is asked to poll so the badge and the popup agree.
- **Existing code:** the popup's unread list, `StateManager` and the inbox cache stay as they are, and the popout doesn't depend on them.

### Remote content and suspicious mail

*(owner: "a no asset loading mode, pixel tracking blocker, especially for more suspicious emails, show maybe the raw first to protect the user")*

This applies to every place Mailbell shows a mail body: the popout and the toolbar popup *(my call; the popup renders the same `MailContent`)*. It's done in `lib/sanitizeMail.ts` through DOMPurify hooks.

- **Remote content is blocked by default.**
  - Blocked: `<img src>`/`srcset` over http(s), CSS `url(...)` in inline styles and `<style>` sheets (backgrounds, `@import`, `@font-face`), `<video>`/`<audio>` sources and `<link>`.
  - Inline `cid:` and `data:` images still show, since they came with the mail.
  - Blocked images keep their size as an empty box, so the layout doesn't jump when they load.
- **Tracking pixels never load**, even after "Show images". These are images 1×1 or smaller (by attribute or style), hidden images, and URLs from known open-tracking hosts. The host list is a small bundled list the builder picks; no remote list is fetched.
- **The bar:** above a mail with blocked content, a quiet bar reads "Images are hidden to protect your privacy" with **Show images** and **Always show from this sender**.
- **Settings:** remote images can be "Ask" (the default), "Always show" or "Show from senders I've replied to". Trusted senders are kept in local storage, per account, and can be cleared in Settings.
- **Suspicious mail shows a safe view first.** A mail counts as suspicious when any of these is true:
  - it's in Spam;
  - its `Authentication-Results` show SPF, DKIM or DMARC failing;
  - its display name contains an email address different from the real sender.

  It then opens as plain text, with links shown as their real URLs and not clickable, under a warning that says why ("This mail failed sender checks" / "This is in Spam"). **Show formatted** switches to the normal view, and remote content is still blocked there until the user allows it.
- **Links** in any mail show their real destination on hover (`title`).
- **The list preview:** a row for a suspicious mail gets a small warning icon. One-time codes in suspicious mail aren't highlighted with the bell accent, since phishing mail often fakes them *(my call)*.

### Actions and Undo
- **Applied at once, reversed on Undo:**
  - Archive removes `INBOX`, and Undo adds it back.
  - Delete uses `threads.trash`, and Undo uses `threads.untrash`.
  - Spam adds `SPAM` and removes `INBOX`, and Undo does the reverse.
  - Read and unread toggle `UNREAD`.
  - Moving between labels can be undone the same way.
  - Bulk actions undo as a group.
- **The toast:** about 6 seconds, one at a time. A new action replaces the previous toast, but the earlier action stays done. `z` undoes the most recent one.
- **Spam and Trash folders:** "Not spam" removes `SPAM` and adds `INBOX`; "Restore" uses `untrash`. "Delete forever" is **not** offered, since `gmail.modify` can't do it and the owner didn't ask for it.
- **Labels:** "Label as" and "Move to" menus in the action bar and on the `l` / `v` keys apply or move a thread between user labels.

### Compose
- **Where:** new mail opens in its own browser popup window (`browser.windows.create({ type: 'popup' })`) on a compose route of the same page. Reply, reply all and forward open inline at the bottom of the reading pane, with a button to pop them out into a window. In the toolbar popup, the existing plain-text quick reply stays.
- **Fields:** From (send-as aliases from `settings.sendAs.list`, which works under `gmail.modify`), To, Cc, Bcc (Cc and Bcc revealed on demand), subject and a rich-text body. Recipient autocomplete draws on the addresses seen in loaded mail, kept in local storage, so no Contacts scope is needed.
- **Formatting:** bold, italic, underline, strikethrough, bulleted and numbered lists, links, quote, and clear formatting. The editor library is the builder's choice: it must be maintained, work unminified and cope with pasted HTML. Anything pasted goes through DOMPurify.
- **Signatures:** the alias's HTML signature from `sendAs` is inserted and changes when From changes.
- **Attachments:** a file picker, drag and drop, and pasted images. Images pasted or dropped into the body are inline images (`cid:`); everything else is a regular attachment.
  - The size limit is Gmail's 25 MB. The UI shows the running total and refuses anything over it with a clear message (no Drive links).
  - Sending uses `messages.send` with `uploadType=multipart`; a message is built as `multipart/mixed` + `multipart/alternative` (HTML and a text fallback) + `multipart/related` for inline images. This extends the RFC 822 code in `lib/reply.ts`.
- **Forwarding:** the original's attachments are included unless they're removed.
- **Drafts:** saved to Gmail through the drafts API: created on the first edit, then updated a few seconds after typing stops and when the window closes. Opening a thread in Drafts opens it in compose. Discarding deletes the draft.
- **Undo send:** "Send" waits 10 seconds, with "Sending… Undo" before it actually sends. The background service worker holds that delay so closing the compose window doesn't lose the message; on Undo the draft reopens.
- **Shortcuts:** `Ctrl/Cmd+Enter` sends and `Esc` closes, keeping the draft.

### No Gmail website
- In the popout, "Open in Gmail" moves into a secondary overflow menu, and nothing else links to `mail.google.com`.
- A mailto unsubscribe (`background.ts`, now `composeUrl`) opens Mailbell's compose pre-filled with the address, subject and body the sender asked for, so the user sees it and clicks Send *(my call)*.
- The popout's compose replaces `newEmail()`'s Gmail window. The popup's compose button opens Mailbell's compose window too *(my call; it's a one-line change and serves the "no Gmail" goal)*.

### Small extras in v1 *(my call; the owner answered the other question but not this one, so I took my own suggestion)*
- Mute a thread: it skips the inbox when new replies arrive. Mailbell applies the `MUTED` label where the API accepts it; otherwise it archives each new reply when polling.
- Print a thread: the browser's print dialog on a clean, print-styled view.
- Show original: the raw source (`format=raw`), as text in a new tab of the extension.
- Later, not v1: creating, renaming and deleting labels; blocking senders (which needs Gmail filters, and so the `gmail.settings.basic` scope).

## Order of work

Two parts, built in this order but **released together** *(my call)*. Part 1 on its own would still have to send the user to Gmail's compose, which breaks the "no Gmail website" goal, so no release carries the new popout until compose is in.

1. **Reader:** the popout layout, sidebar, folders, search, list paging and multi-select, reading pane, actions with Undo, labels menus, keyboard, and the token-via-background change.
2. **Compose:** the compose window, inline reply, rich text, attachments, drafts, aliases, signatures, Undo send, and switching the popup's compose button.

## Later (not in this project)

- An "All inboxes" view merging every account into one list, if paging across accounts proves worth it.
- Inbox category tabs (Primary, Social, Promotions).
- Contacts autocomplete via the People API, which needs a new scope.
- Gmail filters and vacation-responder settings.

## Left to the builder

- The component structure, and how much of `DetailPage` is reused versus split.
- The rich-text editor library.
- Caching details beyond what's stated.
- Exact breakpoints, animation (color transitions only, per the style guide), and toast timing within a second or two.
- Test strategy, beyond: the popout's data layer and Undo logic have unit tests, MIME building has tests against known-good output, and the design test stays green.
