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
6. **Sender identity shown properly:** the full name and address, and whether the sender is verified, on every mail.
7. **Full scope from the start** *(owner: "go full scope from the beginning")*: the features earlier set aside for later are all in this project, namely All inboxes, category tabs, contacts autocomplete, label management, blocking senders, and filters and vacation-responder settings.
8. **No Gmail website needed.** Once an account is signed in, nothing in the popout requires `mail.google.com`. Sign-in itself still goes through `accounts.google.com` once per account, which can't be avoided; after that the browser doesn't need a Google session.

## Non-goals

- **The toolbar popup doesn't change** beyond the shared mail view (sender identity, remote-content protection) and the compose button. It keeps its unread list, its plain-text quick reply and its "Open in Gmail" links. The owner said it is "mostly ok" as is.
- **No full offline mirror of the mailbox:** folders load on demand, page by page.
- **No permanent delete:** "Delete forever" and "Empty trash" need the full `https://mail.google.com/` scope, which this project doesn't request.
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
- **Permissions:** no new required manifest permissions. `https://people.googleapis.com/*` is added as an **optional** host permission, requested the first time contacts are used, so updating the extension doesn't show a new permission prompt or disable it in Chrome. The required host permissions stay `oauth2.googleapis.com` and `gmail.googleapis.com`.
- **OAuth scopes:** `gmail.modify` stays the only scope asked for at sign-in. The new scopes are requested incrementally, the first time a feature needs them, with `include_granted_scopes=true`:
  - `gmail.settings.basic` for filters, blocking senders and the vacation responder;
  - `contacts.readonly` and `contacts.other.readonly` for autocomplete.

  If a scope is refused, that feature shows an explanation and a retry, and everything else keeps working. Users bring their own client, so they also have to add these scopes on their consent screen and turn on the People API. The in-extension setup guide, `docs/SETUP.md` and the README cover this, and the feature's own prompt links to the step it's missing.
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
- Marking read after about 2 seconds, or at once when going into the mail.
- Shortcuts work from the list; messages are preloaded.
- Remote content blocked, tracking pixels never loaded, suspicious mail shown safely first.
- Sender identity and verified status shown properly.
- Full scope from the start.
- A notification click opens the popout on that mail.

## My calls (proposed; the owner can override)

### Layout and navigation
- **Sidebar:** one collapsible section per signed-in account, listing Inbox, Starred, Sent, Drafts, All Mail, Spam, Trash, then the user's labels.
  - Labels named `a/b` nest under `a`.
  - Unread counts come from the labels API (`threadsUnread`) and show for Inbox, Spam, Drafts and user labels.
  - Settings and the account switcher (add, reconnect) sit at the bottom.
  - Inbox categories appear as tabs above the Inbox list (see **All inboxes and categories**).
- **List:**
  - The header has the folder name and an All / Unread switch.
  - A search field searches the current account. When a search is active, the list shows the results for that account, and clearing it returns to the folder.
  - Rows show the sender (or the recipients, in Sent), subject, snippet, time, an unread dot, a star, an attachment icon and the one-time code (bell accent) when there is one.
  - The list pages with infinite scroll, using the Gmail API's `pageToken`.
  - Multi-select: checkboxes, `x`, and shift-click for ranges, for bulk actions.
- **Reading pane:** the thread view that `DetailPage` already provides (collapsed earlier messages, attachments, meeting invites, unsubscribe), with an action bar on top and the reply composer at the bottom. If nothing is selected, it shows an empty state.
- **Narrow tabs:** under about 1000 px wide the sidebar collapses to a toggle; under about 700 px it falls back to list-then-detail navigation.
- **URL state:** the popout tab's URL holds the account, folder, search and selected thread, so reload, back and forward work.
- **Notification click** *(owner)*: clicking a browser notification always opens the popout with that mail selected, in its account's Inbox.
  - If a popout tab is already open, it's focused (with its window) and navigates to the mail; otherwise a new popout tab opens.
  - This replaces both `openPopup()` and the `openMailInWeb` fallback in `entrypoints/background.ts`.
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

### Sender identity

*(owner: "show the sender properly, also their verified status")*

- **The header of each message** shows the display name and the full address, always visible (never only on hover), plus To/Cc and the date. A details toggle shows:
  - **mailed-by:** the envelope domain;
  - **signed-by:** the DKIM `d=` domain;
  - **security:** TLS, from the `Received` headers where present;
  - **Reply-To**, when it differs from From.
- **Verified status** comes from the `Authentication-Results` header Gmail adds, and is fetched along with the thread:
  - **Verified:** DMARC passes, with SPF or DKIM aligned to the From domain. A small check mark sits next to the address, and its tooltip reads "Verified: signed by example.com".
  - **Unverified:** no DMARC policy, or checks that pass without alignment. No mark, and the details say why.
  - **Failed:** SPF, DKIM or DMARC fails. This is a warning, and the mail counts as suspicious (below).
  - **"via":** "via sendgrid.net", like Gmail shows, when the signing domain differs from the From domain.
- **No logos are loaded:** avatars stay as initials *(my call)*. Fetching BIMI logos or favicons would tell outside servers that the mail was opened, which works against the privacy rules below. If the account has Contacts permission, a contact's own photo from the People API may be shown, since that goes only to Google.
- **Lookalike warning:** a display name that looks like another address, or a From domain that is one edit away from a domain the user has corresponded with (e.g. `paypa1.com`), counts as suspicious *(my call; the second check uses only local data)*.

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
  - its display name contains an email address different from the real sender;
  - it fails the lookalike check under **Sender identity**.

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
- **Label management:** create, rename, nest (`parent/child`), recolor (Gmail's label palette, shown as a small square in the sidebar) and delete user labels. This is done from the sidebar's context menu and from Settings. Delete asks for confirmation; it can't be undone, though the mail itself isn't deleted. Label colors from Gmail are the one place a non-foreground color shows in the UI, as an 8 px square *(`design-exempt`, my call)*.
- **Block sender:** creates a Gmail filter that sends that address to Trash, and moves the open thread there. Unblocking removes the filter. It needs `gmail.settings.basic`.

### Compose
- **Where:** new mail opens in its own browser popup window (`browser.windows.create({ type: 'popup' })`) on a compose route of the same page. Reply, reply all and forward open inline at the bottom of the reading pane, with a button to pop them out into a window. In the toolbar popup, the existing plain-text quick reply stays.
- **Fields:** From (send-as aliases from `settings.sendAs.list`, which works under `gmail.modify`), To, Cc, Bcc (Cc and Bcc revealed on demand), subject and a rich-text body.
- **Recipient autocomplete:** comes from the People API (the user's contacts plus "other contacts", the people they've emailed), searched with `people:searchContacts` and `otherContacts:search`, and from addresses seen in loaded mail. Without Contacts permission it falls back to the seen addresses alone. Recipients show as chips; pasting a list of addresses splits it.
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

### All inboxes and categories
- **All inboxes:** a sidebar entry above the accounts that merges every account's Inbox into one list, sorted by date. Each row shows a small account marker (the account's initial or a short name) *(my call)*.
  - It pages each account separately and merges the pages, showing rows only up to the oldest date every account has loaded, so the order is never wrong.
  - Actions and compose use each row's own account.
- **Category tabs:** above the Inbox list, Primary, Social, Promotions, Updates and Forums tabs (`CATEGORY_*` labels), when the account uses categories. Only the tabs with mail show, and the unread count is on each tab. All inboxes shows Primary across accounts, with the other categories as tabs too.

### Settings in the popout
- **Filters:** list, create, edit and delete Gmail filters through `settings.filters`, which needs `gmail.settings.basic`.
  - Criteria: from, to, subject, has the words, doesn't have, has attachment, size.
  - Actions: skip the inbox, mark read, star, apply a label, delete, never send to Spam, mark important, categorize.
  - "Filter messages like this" in a thread's menu pre-fills the criteria from that mail.
  - The Gmail API can't edit a filter in place, so editing deletes it and creates a new one; this isn't shown to the user.
- **Vacation responder:** on or off, subject, rich-text message, start and end dates, contacts-only and domain-only switches, via `settings.vacation` (also `gmail.settings.basic`). A quiet banner at the top of the popout shows while it's on, with a button to turn it off.
- **Signatures:** shown per alias. Editing them needs `gmail.settings.basic` (`sendAs.update`), so they can be edited here too.
- **Other settings:** the existing popup Settings (notifications, sounds, accounts, OAuth client) are reachable from the popout's sidebar, along with the new options: marking read, remote images, trusted senders and undo-send delay.

### Small extras
- **Mute a thread:** it skips the inbox when new replies arrive. The Gmail API can't apply Gmail's own mute *(builder to confirm whether a `MUTED` label is writable)*. If it isn't, Mailbell keeps its own muted-thread list in local storage and archives new replies to those threads when the background polls.
- **Print a thread:** the browser's print dialog on a clean, print-styled view.
- **Show original:** the raw source (`format=raw`) as text in a new tab of the extension, with the authentication results summarised at the top.
- **Important markers:** a marker on rows labeled `IMPORTANT`, with a toggle; and an "Important" folder in the sidebar.
- **Conversation view:** on by default. A setting turns it off so the list shows single messages (`messages.list`), not threads.

## Order of work

Four parts, built in this order but **released together** *(my call)*. Earlier parts on their own would still send the user to Gmail for compose or settings, which breaks the "no Gmail website" goal.

1. **Reader:**
   - the popout layout, sidebar, folders, All inboxes, category tabs, search, list paging and multi-select;
   - the reading pane with sender identity, and remote-content and suspicious-mail protection;
   - actions with Undo, labels menus, keyboard, preloading, and marking read;
   - the notification click, and the token-via-background change.
2. **Compose:** the compose window, inline reply, rich text, attachments, drafts, aliases, signatures, Undo send, the mailto-unsubscribe compose, and switching the popup's compose button.
3. **Scopes and contacts:**
   - incremental scope requests and the optional People host permission;
   - contacts autocomplete and contact photos;
   - the setup guide, `SETUP.md` and README updates for the new scopes and the People API.
4. **Management and settings:** label management, block sender, filters, the vacation responder, signature editing, mute, print, show original, important markers, the conversation-view toggle, and the popout's settings pages.

## Not possible with the Gmail API

Snooze and scheduled send: Gmail exposes neither. Permanent delete needs the full mail scope, which this project doesn't request.

## Left to the builder

- The component structure, and how much of `DetailPage` is reused versus split.
- The rich-text editor library.
- Caching details beyond what's stated.
- Exact breakpoints, animation (color transitions only, per the style guide), and toast timing within a second or two.
- Test strategy, beyond: the popout's data layer and Undo logic have unit tests, MIME building has tests against known-good output, and the design test stays green.
