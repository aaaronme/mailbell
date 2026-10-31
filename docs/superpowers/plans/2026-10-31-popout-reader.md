# Popout reader (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the popout tab (`popup.html?view=tab`) into a three-pane Gmail reader (sidebar, thread list, reading pane) with every folder, All inboxes, categories, search, paging, multi-select, sender identity, remote-content and suspicious-mail protection, undoable actions, labels menus, Gmail keyboard shortcuts, preloading, mark-read, and notification clicks that open the popout, and live updates (10-second checks with in-place patches) while Mailbell is open.

**Architecture:** The popout gets its own route (`/mail`) whose search params hold the account, folder, category, query and selected thread. In the popout, the router uses hash history, so reload, back and forward work. The toolbar popup keeps memory history and its existing routes untouched. The page calls `gmail.googleapis.com` directly through the existing `gmailFetch`. Its token source is swapped, in the page only, for a `getAccessToken` message to the background, so only the background ever refreshes or stores tokens. Pure logic lives in `lib/mail/*` with unit tests:
- identity, suspicion and remote-content rules;
- undo inverses;
- the All inboxes merge;
- preload targets.

React components live in `entrypoints/popup/popout/*` and `components/mail/*`. The `components/mail/*` part is the thread view, shared with the popup's `DetailPage`.

**Tech Stack:** WXT 0.21 MV3, React 19, TanStack Router (hash history in the popout) and TanStack Query (`useInfiniteQuery`), Tailwind v4, radix-ui, lucide, sonner. DOMPurify for sanitizing. One new dependency, `tldts` (it bundles the Public Suffix List). Tests use vitest 4 browser mode with `@webext-core/fake-browser` and `vitest-browser-react`.

**Spec:** `docs/superpowers/specs/2026-10-31-popout-mail-client-design.md`. Read its sections *My calls → Layout and navigation, Data, Sender identity, Remote content and suspicious mail, Actions and Undo, All inboxes and categories* before starting.

## Global Constraints

- `STYLE_GUIDE.md` is binding, and `lib/design/design.test.ts` must stay green. Its rules:
  - monochrome `foreground/N` only;
  - the `bell` accent for one-time codes only;
  - flat and square, with one filled button per view;
  - sentence case;
  - `// design-exempt: <why>` for exceptions;
  - color transitions only, no other animation.
- No new required manifest permissions or host permissions. Required host permissions stay `https://oauth2.googleapis.com/*` and `https://gmail.googleapis.com/*`.
- OAuth scope stays `gmail.modify` only. Part 1 uses no other scope.
- Every mail-body HTML sink goes through `sanitizeMail` (`lib/sanitizeMail.ts`). The build stays unminified, with no remote code.
- The toolbar popup's routes and pages keep working unchanged, except that it now shows sender identity, the remote-content bar and the suspicious view through the shared thread view.
- Firefox 140+ and Chrome 120+.
- Only the background refreshes or writes tokens. Page code never calls `getAccessToken` from `lib/auth/oauth.ts` directly.
- Nothing in the popout navigates to `mail.google.com`, except an explicit "Open in Gmail" item in an overflow menu. `c` (compose) still calls `newEmail()` until Part 2 replaces it; that is accepted, since the parts are released together.
- These values are fixed:
  - undo toast duration 6000 ms, with one toast at a time (sonner id `'undo'`);
  - live checks every 10 000 ms while a view is visible;
  - mark-read delay 2000 ms;
  - preload of the first 10 rows plus 3 on each side of the selection, at a concurrency of 2;
  - `threads.list` `maxResults` 50;
  - breakpoints: the sidebar collapses below 1000 px, and the layout goes single-pane below 700 px.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work happens in a worktree (`EnterWorktree`), never by checking out a branch in the main checkout. Subagents get the worktree's absolute path and `cd` into it first.
- Gate per task: `pnpm vitest run <touched tests>` plus `pnpm compile`. Gate at the end: `pnpm test`, `pnpm compile`, `pnpm build` and `pnpm build:firefox`. Use whichever package manager the lockfile shows. The commands below assume pnpm; swap in `npm run` if the lockfile is `package-lock.json`.

## Review Focus

1. **A thread changes under an open view.** The poll arrives, or a thread is acted on in the popup while the popout shows it. Expect the list to refresh without losing the selection or the scroll position, and the reading pane not to blank. *Test: Task 17, "refreshPopup keeps the selected thread selected".*
2. **Undo after the row has already gone,** including after a newer action replaced the toast. Expect `z` to undo only the most recent action, and an undo of an action whose API call failed not to be offered. *Test: Task 7, "a failed action offers no undo" and "z undoes only the latest".*
3. **A mail with no `Authentication-Results`, or with several** (forwarded mail carries old ones). Expect only Gmail's own header to count, which is the first header, added by `mx.google.com`; with none, the status is "unverified", never "failed". *Test: Task 3, "uses only the first mx.google.com header" and "missing header is unverified".*
4. **Remote content smuggled past the image rule:**
   - `srcset`;
   - `background=` attributes;
   - `style="background:url(http…)"`;
   - `<style>` with `@import` or `@font-face`;
   - `<video poster>`;
   - `<input type=image>`, which is already forbidden.

   Expect none of them to fetch while blocked, and trackers never to fetch, even after "Show images". *Test: Task 5, "blocks every remote vector".*
5. **An account whose token can't be refreshed** (revoked) while the popout is open. Expect that account's sidebar section to show "Reconnect", the other accounts to keep working, and the popout not to throw or retry in a loop. *Test: Task 1, "token failure surfaces as OAuthError to the page".*

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `lib/api/mailbox.ts` | Folder-level Gmail API calls: labels with counts, thread-list pages, metadata rows, full thread with labels, modify/trash/untrash |
| `lib/mail/folders.ts` | System folder definitions, folder → list query, the label tree (nesting on `/`), the category list |
| `lib/mail/identity.ts` | `Authentication-Results`, DKIM, mailed-by, TLS and Reply-To → `SenderIdentity`; registrable domain (tldts) |
| `lib/mail/suspicion.ts` | Lookalike check, display-name spoof check, `suspicionOf(...)` → reasons |
| `lib/mail/correspondents.ts` | Per-account store of addresses the user has written to (first-time sender, "senders I've replied to", lookalike base) |
| `lib/mail/remoteContent.ts` | Tracker detection, the CSS `url()` blocker, the trusted-senders store |
| `lib/mail/safeText.ts` | Sanitized HTML → plain text with links written out as their real URLs |
| `lib/mail/actions.ts` | `MailAction` type, label ops and inverses, `applyAction`, optimistic cache patching |
| `lib/mail/undo.ts` | The latest undoable action; the sonner toast; `undoLatest()` |
| `lib/mail/merge.ts` | All inboxes merge cut-off |
| `lib/mail/preload.ts` | `preloadTargets(...)` and a concurrency-2 prefetch queue |
| `lib/mail/queries.ts` | Query keys and hooks: labels, thread list (infinite), All inboxes, thread |
| `lib/mail/markRead.ts` | `useMarkRead(...)` |
| `lib/mail/live.ts` | The popout's own `historyId` check, `history.list` → cache patches |
| `components/mail/ThreadView.tsx` | The thread view moved out of `DetailPage` (messages, collapse, attachments, meeting bar, reply box) |
| `components/mail/SenderHeader.tsx` | Name and full address, emphasised domain, check mark / via / failed, details toggle, "Replies go to", first-time note |
| `components/mail/ProtectedContent.tsx` | The remote-content bar and the suspicious safe view around `MailContent` |
| `entrypoints/popup/popout/MailRoute.tsx` | The `/mail` route component: the three-pane shell and responsive behavior |
| `entrypoints/popup/popout/Sidebar.tsx` | All inboxes, account sections, folders, the label tree, counts, settings and accounts |
| `entrypoints/popup/popout/ThreadList.tsx` | Header, search, All / Unread switch, category tabs, rows, infinite scroll, multi-select |
| `entrypoints/popup/popout/ThreadListRow.tsx` | One row (named so it doesn't clash with the `ThreadRow` data type) |
| `entrypoints/popup/popout/ReadingPane.tsx` | Action bar, labels menus, overflow menu, `ThreadView`, empty state |
| `entrypoints/popup/popout/usePopoutShortcuts.ts` | The popout's key map |
| `entrypoints/popup/popout/ShortcutSheet.tsx` | The `?` dialog |
| `entrypoints/popup/popout/mailSearch.ts` | The `/mail` search-param schema and its helpers |

Each file gets a `.test.ts(x)` next to it, where a task says so.

**Modified:**

- `lib/api/gmail.ts`: token source injection, exports, identity on `Message`, extract version 4.
- `lib/messager.ts`: `getAccessToken` (bg) and `openThread` (popup).
- `entrypoints/background.ts`: the `getAccessToken` handler, the notification click, and the fast check while a view is visible.
- `entrypoints/popup/main.tsx`: page token source, and the `openThread` listener in the popout.
- `entrypoints/popup/router.tsx`: the `/mail` route, hash history in the popout, `/` → `/mail` in the popout.
- `entrypoints/popup/App.tsx`: invalidates the mail queries on `refreshPopup`.
- `entrypoints/popup/pages/DetailPage.tsx`: uses `components/mail/ThreadView`.
- `lib/sanitizeMail.ts`: options and result.
- `lib/settings.ts`: `markRead` and `remoteImages`.
- `lib/useShortcuts.ts`: two-key sequences.
- `package.json`: `tldts`.

---

### Task 1: Tokens come from the background

**Files:**
- Modify: `lib/api/gmail.ts` (the `gmailFetch` and `mapLimit` area, about lines 130–170)
- Modify: `lib/messager.ts`, `entrypoints/background.ts`, `entrypoints/popup/main.tsx`
- Test: `lib/api/gmail.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `export type TokenSource = (account: string, force?: boolean) => Promise<string>`;
  - `export function setTokenSource(source: TokenSource): void`. The default is `getAccessToken` from `lib/auth/oauth.ts`;
  - `export async function gmailFetch<T>(account, path, init?)`, now exported;
  - `export async function mapLimit(...)`, now exported;
  - `export function header(part, name)`, now exported;
  - `bgMessager` message `getAccessToken(data: { account: string; force?: boolean }): string`.
- The 401 retry in `gmailFetch` keeps its logic and calls the source in place of `getAccessToken`.

- [ ] **Step 1: Write the failing tests** in `lib/api/gmail.test.ts`:
  - `uses the injected token source`: `setTokenSource(async () => 'T1')`, stub `fetch` to return `200 {}`, call `gmailFetch('a@x', '/labels')`, and expect the `Authorization` header to be `'Bearer T1'`.
  - `on 401 asks the source again, forcing only if unchanged`: the source returns `'T1'`, `'T1'` and then `'T2'` with `force === true`. `fetch` returns 401 and then 200. Expect the source calls to be `[['a@x', undefined], ['a@x', undefined], ['a@x', true]]` and the second fetch to carry `Bearer T2`.
  - `token failure surfaces as OAuthError to the page`: the source rejects with `new OAuthError('revoked')`. Expect `gmailFetch` to reject with an `OAuthError`, and `fetch` never to be called.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/api/gmail.test.ts`. Expected: FAIL, `setTokenSource` is not exported.
- [ ] **Step 3: Implement.**
  - Add `setTokenSource` and the exports to `gmail.ts`.
  - Add `getAccessToken` to `bgMessager`'s map in `lib/messager.ts`.
  - In `background.ts`, `bgMessager.onMessage('getAccessToken', ({ data }) => getAccessToken(data.account, data.force))`, registered with the other handlers, before the first await.
  - In `main.tsx`, before rendering: `setTokenSource((account, force) => bgMessager.sendMessage('getAccessToken', { account, force }))`. This covers the popup's attachment downloads too.
  - Messaging serializes errors. In the page source, rethrow a rejection whose message starts with the `OAuthError` text as `new OAuthError(message)`, so callers can tell it apart.
- [ ] **Step 4: Run them.** The same command; expected: PASS. Then `pnpm compile`.
- [ ] **Step 5: Commit** `feat: page asks the background for Gmail tokens`.

### Task 2: Mailbox API layer

**Files:**
- Create: `lib/api/mailbox.ts`, `lib/mail/folders.ts`
- Test: `lib/api/mailbox.test.ts`, `lib/mail/folders.test.ts`

**Interfaces:**
- Consumes: `gmailFetch`, `mapLimit` and `header` (Task 1). Also `threadToMail`, `threadUrl` and `parseMailbox` from `gmail.ts`. Export `buildThread`'s inline-data step as `fetchInlineData`, which is currently internal.
- Produces (`lib/mail/folders.ts`):
  - `type SystemFolder = 'INBOX' | 'STARRED' | 'SENT' | 'DRAFT' | 'ALL' | 'SPAM' | 'TRASH' | 'IMPORTANT'`;
  - `SYSTEM_FOLDERS: { id: SystemFolder; name: string }[]`, in that order. The names are Inbox, Starred, Sent, Drafts, All mail, Spam, Trash and Important;
  - `type Category = 'primary' | 'social' | 'promotions' | 'updates' | 'forums'`;
  - `CATEGORY_LABEL: Record<Category, string>`, mapping to `CATEGORY_PERSONAL`, `_SOCIAL`, `_PROMOTIONS`, `_UPDATES` and `_FORUMS`;
  - `listQuery(folder: string, opts: { category?: Category; q?: string; unread?: boolean }): { labelIds: string[]; q?: string; includeSpamTrash: boolean }`;
  - `interface LabelNode { id: string; name: string; path: string; children: LabelNode[]; color?: { backgroundColor: string; textColor: string } }`;
  - `labelTree(labels: GmailLabel[]): LabelNode[]`, for user labels only, sorted by name.
- Produces (`lib/api/mailbox.ts`):
  - `interface GmailLabel { id: string; name: string; type: 'system' | 'user'; threadsUnread?: number; threadsTotal?: number; color?: {...} }`;
  - `listLabels(account): Promise<GmailLabel[]>`. This is `labels.list`, then `labels.get` (mapLimit 4) for the user labels, the 5 `CATEGORY_*` labels and INBOX, SPAM and DRAFT, so they carry counts;
  - `interface ThreadRow { url: string; account: string; threadId: string; subject: string; snippet: string; from: { name: string; email: string }; to: string[]; date: string /* ISO, newest message */; labelIds: string[] /* union over messages */; messageCount: number; hasAttachment: boolean; authResults?: string /* newest message's first Authentication-Results */ }`;
  - `listThreadPage(account, query: ReturnType<typeof listQuery>, pageToken?: string): Promise<{ rows: ThreadRow[]; nextPageToken?: string }>`. This is `threads.list` with maxResults 50, then `threads.get?format=metadata&metadataHeaders=From&…=To&…=Subject&…=Authentication-Results&…=Content-Type`, mapLimit 4;
  - `interface OpenThread extends ThreadMail { url: string; account: string; labelIds: string[] }`;
  - `getOpenThread(account, threadId): Promise<OpenThread>`, with `format=full` and inline data;
  - `modifyThreads(account, ids: string[], add: string[], remove: string[]): Promise<void>`, mapLimit 4 over `threads/{id}/modify`;
  - `trashThreads(account, ids)` and `untrashThreads(account, ids)`.
- `listQuery` rules:
  - `ALL` → no labelIds;
  - `SPAM` / `TRASH` → `includeSpamTrash: true`;
  - INBOX plus a category → `['INBOX', CATEGORY_LABEL[c]]`;
  - `unread` → adds `UNREAD`;
  - a non-empty `q` replaces the labels with only the query. A folder filter is not combined with a search; the spec says search covers the account.

- [ ] **Step 1: Write the failing tests:**
  - `folders.test.ts` `listQuery`:
    - `listQuery('INBOX', { category: 'social', unread: true })` → `{ labelIds: ['INBOX', 'CATEGORY_SOCIAL', 'UNREAD'], includeSpamTrash: false }`;
    - `listQuery('TRASH', {})` → `{ labelIds: ['TRASH'], includeSpamTrash: true }`;
    - `listQuery('ALL', {})` → `{ labelIds: [], includeSpamTrash: false }`;
    - `listQuery('INBOX', { q: 'from:bob' })` → `{ labelIds: [], q: 'from:bob', includeSpamTrash: false }`.
  - `folders.test.ts` `labelTree`:
    - labels `Work`, `Work/Clients` and `Home` → two roots, `Home` then `Work`, and `Work` has one child named `Clients` with path `Work/Clients`;
    - `Orphan/Child` with no `Orphan` label → a synthetic root `Orphan` with no `id`, typed `id: ''`, holding the child.
  - `mailbox.test.ts`, with `fetch` stubbed from a route table and the token source stubbed:
    - `listThreadPage builds rows from metadata`: one thread with two messages. The second is newer, from `Bob <b@x.com>` and labeled `UNREAD`; the first has an attachment part. Expect `from.email` to be `'b@x.com'`, `labelIds` to contain `UNREAD`, `hasAttachment` to be true, `messageCount` to be 2, and `nextPageToken` to be passed through;
    - `modifyThreads posts each thread`: expect 2 POST bodies `{ addLabelIds: ['INBOX'], removeLabelIds: [] }`.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/mail/folders.test.ts lib/api/mailbox.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement both files to the interfaces above.** `hasAttachment` comes from metadata: a message's top-level `Content-Type` header starts with `multipart/mixed`.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm compile`.
- [ ] **Step 5: Commit** `feat: mailbox API for folders, labels and thread pages`.

### Task 3: Sender identity

**Files:**
- Create: `lib/mail/identity.ts`
- Modify: `lib/api/gmail.ts`. `Message` gains `identity: SenderIdentity` and `labelIds: string[]`, and `messageToMail` fills them. Bump `CURRENT_EXTRACT_VERSION` to 4 and add the line `// Version 4: sender identity and labels per message.`
- Modify: `package.json`, adding `tldts`
- Test: `lib/mail/identity.test.ts`

**Interfaces:**
- Produces:
  - `type AuthStatus = 'verified' | 'unverified' | 'failed'`;
  - `interface SenderIdentity { status: AuthStatus; reason?: string; fromDomain: string; signedBy?: string; mailedBy?: string; via?: string; tls?: boolean; replyTo?: string; replyToMismatch: boolean }`;
  - `registrableDomain(hostOrAddress: string): string`, which is tldts `getDomain`, falling back to the host;
  - `splitAddress(email: string): { local: string; host: string; domain: string }`, where `domain` is the registrable part and `host` is the full host;
  - `senderIdentity(headers: { name: string; value: string }[], fromEmail: string): SenderIdentity`.
- Rules:
  - Only the **first** `Authentication-Results` header whose authserv-id is `mx.google.com` counts.
  - `failed` if `spf=fail`, `dkim=fail` or `dmarc=fail` appears in it. `softfail` and `neutral` are not failures.
  - `verified` if `dmarc=pass`, and either the `header.from` domain's registrable domain equals the DKIM `header.i`/`header.d` registrable domain, or it equals the SPF `smtp.mailfrom` registrable domain.
  - Otherwise `unverified`, with `reason` set to `'No DMARC policy'` or `'Checks passed without alignment'`. A missing header gives `'Not checked by Gmail'`.
  - `signedBy` is the DKIM `header.d` (or the `d=` of the first `DKIM-Signature`).
  - `mailedBy` is the domain of `Return-Path`.
  - `via` is `signedBy`'s registrable domain when it differs from `fromDomain`'s.
  - `tls` is true if any `Received` header contains `ESMTPS` or `version=TLS`, and undefined if there is no `Received` header.
  - `replyToMismatch` holds when the registrable domains differ.

- [ ] **Step 1: Write the failing tests:**
  - `verified when dmarc passes with aligned dkim`: the header `mx.google.com; dkim=pass header.i=@mail.springfield.gov; spf=pass smtp.mailfrom=bounce.springfield.gov; dmarc=pass header.from=springfield.gov`, from `notices@mail.springfield.gov` → `status: 'verified'`, `fromDomain: 'springfield.gov'`, `via` undefined.
  - `failed on dmarc fail` → `status: 'failed'`.
  - `uses only the first mx.google.com header`: two headers, the first a pass and the second (forwarded, `authserv-id other.example`) a fail → `'verified'`.
  - `missing header is unverified` → `{ status: 'unverified', reason: 'Not checked by Gmail' }`.
  - `via when signed by another domain`: `dkim=pass header.i=@sendgrid.net`, `spf=pass smtp.mailfrom=sendgrid.net`, `dmarc=pass header.from=shop.com` → `via: 'sendgrid.net'`.
  - `registrableDomain` cases: `'springfield.gov.x7.ru'` → `'x7.ru'`, `'a.b.co.uk'` → `'b.co.uk'`, `'x@mail.github.com'` → `'github.com'`.
  - `replyToMismatch` on Reply-To `x@gmail.com` with From `ceo@corp.com`.
  - In the existing `lib/api` thread tests, a built `Message` has `identity.status` and `labelIds`, and `extractVersion === 4`.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/mail/identity.test.ts`. Expected: FAIL.
- [ ] **Step 3: Install and implement.** `pnpm add tldts`, then the rules above. `messageToMail` passes `msg.payload.headers` and `from.email`.
- [ ] **Step 4: Run them.** `pnpm vitest run lib/mail lib/api lib/StateManager.test.ts`. Expected: PASS. The StateManager tests must still pass with version 4; fixtures that hard-code 3 should use `CURRENT_EXTRACT_VERSION`.
- [ ] **Step 5: Commit** `feat: parse sender identity from Authentication-Results`.

### Task 4: Correspondents and suspicion

**Files:**
- Create: `lib/mail/correspondents.ts`, `lib/mail/suspicion.ts`
- Test: `lib/mail/correspondents.test.ts`, `lib/mail/suspicion.test.ts`

**Interfaces:**
- Consumes: `registrableDomain`, `SenderIdentity` (Task 3); `gmailFetch`, `mapLimit`, `header` (Task 1).
- Produces (`correspondents.ts`):
  - the storage key `'correspondents'` holds `Record<account, string[]>` of lower-cased addresses, capped at 5000 per account (newest kept);
  - `addCorrespondents(account, emails: string[]): Promise<void>`;
  - `getCorrespondents(account): Promise<Set<string>>`;
  - `bootstrapCorrespondents(account): Promise<void>`. It runs once per account (flag key `'correspondentsBootstrapped'`, a `string[]` of accounts): `messages.list?labelIds=SENT&maxResults=200`, then `messages.get?format=metadata&metadataHeaders=To&metadataHeaders=Cc` at mapLimit 4, adding every address;
  - `useCorrespondents(account)`, a TanStack Query hook keyed `['correspondents', account]`.
- Produces (`suspicion.ts`):
  - `type SuspicionReason = 'spam' | 'auth-failed' | 'name-spoof' | 'lookalike'`;
  - `REASON_TEXT: Record<SuspicionReason, string>`:
    - `spam`: `'This is in Spam'`;
    - `auth-failed`: `'This mail failed sender checks'`;
    - `name-spoof`: `'The sender's name shows a different address'`;
    - `lookalike`: `'This domain looks like one you've written to'`;
  - `isLookalike(domain: string, known: Set<string>): boolean`. It is true when some known registrable domain is not equal to `domain` but is within Damerau–Levenshtein distance 1, or equal after mapping `0→o, 1→l, rn→m, vv→w`;
  - `nameSpoofs(displayName: string, email: string): boolean`. It is true when the name contains an address (`/[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}/i`) that differs from `email`;
  - `suspicionOf(input: { labelIds: string[]; identity: SenderIdentity; senderName: string; senderEmail: string; knownDomains: Set<string> }): SuspicionReason[]`.

- [ ] **Step 1: Write the failing tests:**
  - `isLookalike('paypa1.com', new Set(['paypal.com']))` → true;
  - `isLookalike('paypal.com', new Set(['paypal.com']))` → false;
  - `isLookalike('rnicrosoft.com', new Set(['microsoft.com']))` → true;
  - `isLookalike('github.com', new Set(['gitlab.com']))` → false (distance 2);
  - `nameSpoofs('support@paypal.com', 'x@evil.ru')` → true;
  - `nameSpoofs('Bob', 'bob@x.com')` → false;
  - `nameSpoofs('bob@x.com', 'bob@x.com')` → false;
  - `suspicionOf` with `labelIds: ['SPAM']` and a failed identity → `['spam', 'auth-failed']`;
  - `addCorrespondents` lower-cases and dedupes, and the cap keeps the newest 5000;
  - `bootstrapCorrespondents` runs once: the second call makes no fetch.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/mail/suspicion.test.ts lib/mail/correspondents.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement to the interfaces.** `knownDomains` comes from the correspondents' registrable domains, built by the caller.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: correspondents store and suspicious-mail checks`.

### Task 5: Remote content blocking

**Files:**
- Create: `lib/mail/remoteContent.ts`, `lib/mail/safeText.ts`
- Modify: `lib/sanitizeMail.ts`, `lib/settings.ts`
- Test: `lib/sanitizeMail.test.ts`, `lib/mail/remoteContent.test.ts`, `lib/mail/safeText.test.ts`, `lib/settings.test.ts`

**Interfaces:**
- Produces (`sanitizeMail.ts`):
  - `sanitizeMail(html: string, opts?: { remote?: boolean }): { html: string; blocked: number }`. `remote` defaults to false, which means blocked. Update the existing caller in `DetailPage` and the existing tests.
  - `sanitizeStyles(css: string, opts?: { remote?: boolean }): string`, for the `<style>` contents that `prepareHtml` extracted.
- Produces (`remoteContent.ts`):
  - `isTracker(img: { src: string; width?: string; height?: string; style?: string }): boolean`;
  - `TRACKER_HOSTS: string[]`, a bundled list of about 20 well-known open-tracking hosts that the implementer picks and comments with the source;
  - `blockCssUrls(css: string): { css: string; blocked: number }`;
  - `getTrustedSenders(account): Promise<Set<string>>` and `trustSender(account, email)`, under the storage key `'trustedSenders'` as `Record<account, string[]>`;
  - `shouldShowRemote(setting: Settings['remoteImages'], ctx: { trusted: boolean; repliedTo: boolean }): boolean`.
- Produces (`settings.ts`):
  - `Settings.markRead: 'delay' | 'immediate' | 'manual'`, default `'delay'`;
  - `Settings.remoteImages: 'ask' | 'always' | 'replied'`, default `'ask'`.
- Produces (`safeText.ts`): `safeText(html: string): string`. It applies `sanitizeMail`, then DOMParser, then the text content with each `<a>` rendered as `text (url)`, or just `url` when text equals url, and block elements as line breaks.
- Blocking rules while `remote` is false:
  - `img` / `source`: an http(s) `src` or `srcset` → the attribute is removed and the original kept in `data-remote-src`, with `width` and `height` kept;
  - `video[poster]`, `audio` / `video` `src`, and `[background]` http(s) → removed;
  - inline `style` → `blockCssUrls`;
  - `link` is already forbidden.
- Trackers (`isTracker`) are removed entirely, **in both modes**: width or height ≤ 1, `display:none` / `visibility:hidden` / opacity 0 in the style, or a host in `TRACKER_HOSTS`.
- `cid:` and `data:` sources are left alone.
- `blocked` counts the removed non-tracker resources.
- Every link gets `title` set to its `href`, in both modes.

- [ ] **Step 1: Write the failing tests** in `lib/sanitizeMail.test.ts`:
  - `blocks every remote vector`: `<img src="https://a/x.png" width=40 height=20>`, `<img srcset="https://a/1x.png 1x">`, `<td background="https://a/bg.png">`, `<div style="background:url(https://a/b.png)">`, `<video poster="https://a/p.png">`. Expect the result HTML to contain no `https://a/` outside `data-remote-src`, `blocked` to be 5, and the first img to keep `width="40"`.
  - `keeps cid and data images`.
  - `trackers never load, even with remote`: `<img src="https://a/p.gif" width=1 height=1>` and a `TRACKER_HOSTS[0]` src, under `{ remote: true }` → both gone.
  - `remote: true restores normal images`.
  - `links get their real destination as title`.
  - `sanitizeStyles blocks @import and url() in font-face` → no `https://` left.
- [ ] **Step 2: Write the remaining failing tests:**
  - `safeText('<p>Hi <a href="https://evil.ru/x">PayPal</a></p>')` → contains `PayPal (https://evil.ru/x)` and no `<`.
  - `shouldShowRemote('replied', { trusted: false, repliedTo: true })` → true.
  - `shouldShowRemote('ask', { trusted: false, repliedTo: true })` → false.
  - `shouldShowRemote('ask', { trusted: true, repliedTo: false })` → true.
  - The settings defaults include `markRead: 'delay'` and `remoteImages: 'ask'`.
- [ ] **Step 3: Run them.** `pnpm vitest run lib/sanitizeMail.test.ts lib/mail/remoteContent.test.ts lib/mail/safeText.test.ts lib/settings.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Do the blocking in DOMPurify `uponSanitizeElement` and `afterSanitizeAttributes` hooks on the module's purify instance, driven by a module-level `mode` variable set around each synchronous `sanitize` call.
  - Hook contract: a hook increments a counter that the call returns.
  - `blockCssUrls` replaces `url(<http(s)…>)` with `url("")`, drops `@import` rules with http(s) URLs, and counts each one.
- [ ] **Step 5: Run them.** Expected: PASS. Then `pnpm compile`.
- [ ] **Step 6: Commit** `feat: block remote content and tracking pixels in mail`.

### Task 6: Shared thread view with identity and protection

**Files:**
- Create: `components/mail/ThreadView.tsx`, `components/mail/SenderHeader.tsx`, `components/mail/ProtectedContent.tsx`
- Modify: `entrypoints/popup/pages/DetailPage.tsx`. Move `MailContent`, `MailMessage`, `CollapsedMessagesIndicator`, `MeetingBar`, `ReplyBox`, `downloadAttachment`, the style constants and `DARK_MODE_RULES` into `components/mail/ThreadView.tsx`, and re-export `DARK_MODE_RULES` from `DetailPage` so its existing tests still import it. `DetailPage` keeps its toolbar and renders `<ThreadView thread={thread} />`.
- Test: `components/mail/ThreadView.test.tsx`; the existing `entrypoints/popup/pages/DetailPage.test.tsx` must still pass

**Interfaces:**
- Consumes:
  - `Message.identity` and `Message.labelIds` (Task 3);
  - `suspicionOf`, `REASON_TEXT`, `useCorrespondents`, `addCorrespondents` (Task 4);
  - `sanitizeMail`, `sanitizeStyles`, `safeText`, `shouldShowRemote`, `trustSender`, `getTrustedSenders`, `getSettings` (Task 5).
- Produces:
  - `ThreadView(props: { thread: EmailThread | OpenThread; onEngage?: () => void })`. `onEngage` fires on pointer-down, wheel or scroll inside the view, and on focus within it; Task 13 uses it for mark-read;
  - `SenderHeader(props: { message: Message; account: string; firstTime: boolean })`;
  - `ProtectedContent(props: { account: string; message: Message; styles: string[]; suspicion: SuspicionReason[] })`.
- Behavior:
  - **`SenderHeader`:**
    - the name, then the full address, with the registrable-domain suffix wrapped in `font-medium text-foreground/80` and the rest `text-foreground/40`;
    - for `verified`, a lucide `BadgeCheckIcon`, size 3.5, `text-foreground/60`, titled `Sent from ${fromDomain} (verified)`;
    - for `failed`, a `TriangleAlertIcon` with the reason;
    - `via` shows as ` via sendgrid.net` in `text-foreground/40`;
    - a "Details" toggle lists mailed-by, signed-by, security (`TLS` / `No TLS` / omitted) and Reply-To;
    - `replyToMismatch` → a line `Replies go to ${replyTo}` in `font-medium`;
    - `firstTime` → `You haven't written to this address before`;
    - when both of the last two apply, a single line: `Replies go to ${replyTo}, and you haven't written to this address before`;
    - the time, To and Cc as today.
  - **`ProtectedContent`:**
    - when `suspicion` is non-empty and the user hasn't clicked **Show formatted**, render a warning line with the `REASON_TEXT`s joined by `. `, and a `<pre className="whitespace-pre-wrap font-sans">` of `safeText(contentHtml)`, plus a ghost **Show formatted** button;
    - otherwise render `MailContent` with `remote = shouldShowRemote(...) || shownForThisMail`, and while `blocked > 0 && !remote`, a bar `Images are hidden to protect your privacy` with ghost buttons **Show images** and **Always show from this sender** (the latter calls `trustSender`);
    - one-time-code highlighting (wherever `getThreadCode` is used for the bell accent) is skipped for a suspicious thread.
  - **`ThreadView`:**
    - computes `firstTime` from `useCorrespondents`, for messages not sent by the account;
    - calls `addCorrespondents(account, [...to, ...cc])` for each message whose sender is the account itself.

- [ ] **Step 1: Write the failing tests** in `components/mail/ThreadView.test.tsx`. Render with a `QueryClientProvider` and fakeBrowser storage, as in `IndexPage.test.tsx`, using a `ThreadMail` fixture built through `threadToMail`:
  - `verified sender shows check with domain wording`: `getByTitle('Sent from springfield.gov (verified)')` is visible.
  - `emphasises the registrable domain`: for `notices@mail.springfield.gov.x7.ru`, the element with `font-medium` reads `x7.ru`.
  - `replies-go-to warning`: shows the text `Replies go to x@gmail.com`.
  - `spam mail opens as safe text`: the message carries `labelIds: ['SPAM']` and an `<a href="https://evil.ru">Login</a>` body. Expect `This is in Spam`, the text `Login (https://evil.ru)`, no `a[href]` inside the view, and that clicking **Show formatted** renders the shadow content.
  - `remote images bar`: a body with a remote img shows `Images are hidden to protect your privacy`. Clicking **Show images** removes the bar, and the shadow root's img has `src` set.
  - `always show from this sender persists`: after clicking, `getTrustedSenders(account)` has the sender.
- [ ] **Step 2: Run them.** `pnpm vitest run components/mail entrypoints/popup/pages/DetailPage.test.tsx`. Expected: the new tests fail, and the `DetailPage` tests pass before the move.
- [ ] **Step 3: Move and implement** as described. No visual change to the popup beyond the new header lines and bars.
- [ ] **Step 4: Run them, plus the design test.** `pnpm vitest run components/mail entrypoints/popup lib/design`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: shared thread view with sender identity and safe rendering`.

### Task 7: Actions with Undo

**Files:**
- Create: `lib/mail/actions.ts`, `lib/mail/undo.ts`
- Test: `lib/mail/actions.test.ts`, `lib/mail/undo.test.ts`

**Interfaces:**
- Consumes: `modifyThreads`, `trashThreads`, `untrashThreads` (Task 2); `bgMessager.sendMessage('poll')`.
- Produces (`actions.ts`):
  - the type:
    ```ts
    type MailAction =
      | { kind: 'archive' | 'trash' | 'restore' | 'spam' | 'notSpam' | 'read' | 'unread' | 'star' | 'unstar' }
      | { kind: 'label'; labelId: string; name: string }   // Label as
      | { kind: 'unlabel'; labelId: string; name: string }
      | { kind: 'move'; labelId: string; name: string; from: string } // Move to: add labelId, remove `from` (current folder label, e.g. INBOX)
    ```
  - `interface ActionTarget { account: string; threadId: string; url: string }`;
  - `labelOps(a: MailAction): { add: string[]; remove: string[] } | 'trash' | 'untrash'`;
  - `inverse(a: MailAction): MailAction`;
  - `ACTION_TEXT(a: MailAction, count: number): string`. The past-tense toast text is `Archived`, `Moved to Trash`, `Restored`, `Marked as spam`, `Moved to Inbox` (notSpam), `Marked as read`, `Marked as unread`, `Starred`, `Unstarred`, `Labeled “X”`, `Removed “X”` or `Moved to “X”`, with ` · N conversations` appended when count > 1;
  - `applyAction(a: MailAction, targets: ActionTarget[]): Promise<void>`. It groups by account, then patches the cache optimistically (below), calls the API, then sends `bgMessager.sendMessage('poll')` (errors ignored). On API failure it rolls the cache back and rethrows;
  - `removesFromFolder(a: MailAction, folder: string): boolean`. Archive, trash, spam and move remove the row from every folder except `ALL` (and TRASH/SPAM for their own kinds); `read`/`unread`/`star` don't.
- Produces (`undo.ts`):
  - `runUndoable(a: MailAction, targets: ActionTarget[]): Promise<void>`. It awaits `applyAction`. On success it stores `{ a, targets }` as the latest and shows `toast(ACTION_TEXT(a, n), { id: 'undo', duration: 6000, action: { label: 'Undo', onClick: undoLatest } })`. On failure it shows `toast.error('Couldn’t ' + verb + '. Try again.')` and keeps the previous latest;
  - `undoLatest(): Promise<void>`. It applies `inverse` of the latest to the same targets, clears the latest, then shows `toast('Undone', { id: 'undo', duration: 2000 })`. It is a no-op when nothing is stored;
  - `runSilent(a, targets)` for mark-read: no toast, and it doesn't change the latest.
- Optimistic patching uses `queryClient.setQueriesData({ queryKey: ['mail', 'list'] }, ...)` over infinite-query data:
  - it removes rows when `removesFromFolder(a, key[3])` (every list key carries its folder at index 3), else edits each row's `labelIds`;
  - it also patches `['mail', 'thread', account, threadId]` labelIds;
  - the previous data is snapshotted for rollback.
  - The key shapes are fixed by Task 9's `mailKeys`, so import `mailKeys` from `lib/mail/queries.ts`. Create that file in this task with only `mailKeys`; Task 9 fills in the rest.

- [ ] **Step 1: Write the failing tests:**
  - `inverse` pairs: archive↔`{label INBOX}`-equivalent. Specifically, `labelOps(inverse({kind:'archive'}))` → `{ add: ['INBOX'], remove: [] }`. Also trash↔restore, spam↔notSpam, read↔unread, star↔unstar, label↔unlabel, and `move` → `{ kind: 'move', labelId: from, from: labelId }`.
  - `labelOps({kind:'spam'})` → `{ add: ['SPAM'], remove: ['INBOX'] }`.
  - `labelOps({kind:'notSpam'})` → `{ add: ['INBOX'], remove: ['SPAM'] }`.
  - `applyAction` optimistic: seed `queryClient` with a list key holding rows A and B for INBOX. Start `applyAction({kind:'archive'}, [A])` with the `modifyThreads` fetch pending, and expect the cached rows to be `[B]` before it resolves.
  - `applyAction rolls back on failure`: the fetch returns 500 → the rows are back to `[A, B]` and the promise rejects.
  - `a failed action offers no undo`: `runUndoable` with a failing fetch → `toast.error` is called (spy on sonner) and `undoLatest()` makes no fetch.
  - `z undoes only the latest`: run archive on A, then star on B, then `undoLatest()` → exactly one fetch, `unstar` on B. A second `undoLatest()` makes no fetch.
  - `bulk undo is one group`: archive on [A, B], then undo → both get `INBOX` re-added.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/mail/actions.test.ts lib/mail/undo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement to the interfaces.** Use the app's single `queryClient` from `lib/queryClient.ts`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: undoable mail actions with optimistic updates`.

### Task 8: Two-key shortcuts

**Files:**
- Modify: `lib/useShortcuts.ts`
- Test: `lib/useShortcuts.test.tsx` (extend)

**Interfaces:**
- Produces: `useShortcuts` keys may be a two-key sequence written `'g i'`. After the first key of any sequence, the next key within 1000 ms completes it. Otherwise the pending prefix is dropped, and the second key is handled on its own. Single keys that are also a sequence prefix (`g`) only start the sequence. Everything else is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `runs a two-key sequence`: `{ 'g i': fn }`; press `g` then `i` → `fn` is called once.
  - `sequence times out`: press `g`, advance fake timers by 1001 ms, press `i` → `fn` is not called.
  - `a non-matching second key runs on its own`: `{ 'g i': a, j: b }`; press `g` then `j` → `b` is called and `a` is not.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/useShortcuts.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with a ref holding `{ prefix, at }`.
- [ ] **Step 4: Run them.** Expected: PASS, with the old tests green too.
- [ ] **Step 5: Commit** `feat: two-key shortcut sequences`.

### Task 9: Popout route, URL state and three-pane shell

**Files:**
- Create: `entrypoints/popup/popout/mailSearch.ts`, `entrypoints/popup/popout/MailRoute.tsx`
- Modify: `lib/mail/queries.ts` (fill in), `entrypoints/popup/router.tsx`
- Test: `entrypoints/popup/popout/mailSearch.test.ts`, `entrypoints/popup/popout/MailRoute.test.tsx`

**Interfaces:**
- Produces (`mailSearch.ts`):
  - `interface MailSearch { account: string /* address, or 'all' */; folder: string /* SystemFolder or label id */; cat?: Category; q?: string; unread?: boolean; thread?: string /* threadUrl() */ }`;
  - `validateMailSearch(raw: Record<string, unknown>): MailSearch`. It defaults to `{ account: 'all', folder: 'INBOX', cat: 'primary' }`, drops unknown categories, and drops `cat` when the folder isn't INBOX.
- Produces (`queries.ts`):
  - `mailKeys` = `{ labels: (account) => ['mail','labels',account], list: (account, folder, query: ReturnType<typeof listQuery>) => ['mail','list',account,folder,query], all: (cat, unread, q) => ['mail','list','all','INBOX',{cat,unread,q}], thread: (account, threadId) => ['mail','thread',account,threadId] }`;
  - `useLabels(account)`;
  - `useThreadList(search: MailSearch)`, which is `useInfiniteQuery` over `listThreadPage`; for `account === 'all'` it delegates to Task 12's hook;
  - `useOpenThread(url?: string)`, which is `useQuery` over `getOpenThread` with `staleTime: 60_000`.
- Produces (`router.tsx`):
  - `mailRoute` at `/mail` with `validateSearch: validateMailSearch` and component `MailRoute`;
  - in the popout (`isPopoutTab`), `createAppRouter` uses `createHashHistory()`, and `/` redirects to `/mail`;
  - in the popup, nothing changes, including `?page=`;
  - `createAppRouter(initialEntries, opts?: { popout?: boolean })` so tests can pick either.
- Produces (`MailRoute.tsx`): the grid has three columns, sidebar 224 px, list 360 px and the reading pane taking the rest, with full height and `border-foreground/10` separators.
  - Below 1000 px, the sidebar is hidden behind a `PanelLeftIcon` toggle button in the list header and opens as an overlay column.
  - Below 700 px, it is single-pane: with `thread` set, only the reading pane shows, with a back button that clears `thread`; otherwise only the list.
  - Width comes from `window.matchMedia('(min-width: 1000px)')` and `'(min-width: 700px)'` via a small `useMediaQuery(query): boolean` hook in the same file.
  - `main.tsx` already skips `fixed-width-popup` in the popout, so the shell fills the tab.
  - `MailRoute` renders `Sidebar`, `ThreadList` and `ReadingPane`. Until Tasks 10, 11 and 13 land, these are placeholder `<div>`s with test ids `sidebar`, `thread-list` and `reading-pane`.

- [ ] **Step 1: Write the failing tests:**
  - `validateMailSearch({})` → `{ account: 'all', folder: 'INBOX', cat: 'primary' }`;
  - `validateMailSearch({ folder: 'SENT', cat: 'social' })` → `cat` is undefined;
  - `validateMailSearch({ cat: 'bogus' })` → `cat: 'primary'`;
  - `MailRoute.test.tsx`: render `createAppRouter(['/mail'], { popout: true })` at viewport 1200×800 (`page.viewport`) → all three test ids are visible;
  - at 900×800 → `sidebar` is hidden and the toggle titled `Show sidebar` is visible;
  - at 600×800 with `?thread=…` → only `reading-pane` shows, and `Back` clears it;
  - `popup router unchanged`: `createAppRouter(['/'])` still renders `IndexPage` (reuse an `IndexPage.test.tsx` assertion).
- [ ] **Step 2: Run them.** `pnpm vitest run entrypoints/popup/popout`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run them.** `pnpm vitest run entrypoints/popup lib/design`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: popout mail route with URL state and three panes`.

### Task 10: Sidebar

**Files:**
- Create: `entrypoints/popup/popout/Sidebar.tsx`
- Test: `entrypoints/popup/popout/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `useLabels`, `labelTree`, `SYSTEM_FOLDERS` (Tasks 2 and 9); `getAccounts` via the existing `lib/useAccounts.ts`; `bgMessager.sendMessage('addAccount', loginHint)`; `MailSearch` navigation via `useNavigate({ from: '/mail' })`.
- Produces: `Sidebar(props: { onNavigate?: () => void })`. `onNavigate` closes the overlay when the sidebar is collapsed.
- Behavior:
  - The top entry is "All inboxes" (`account: 'all', folder: 'INBOX'`) with the summed Inbox unread count.
  - Then one collapsible section per account, headed by the address, listing `SYSTEM_FOLDERS` and then the label tree.
  - Children of the label tree are indented 12 px per level, and nodes with children are collapsible.
  - Counts (`threadsUnread`) show only for INBOX, SPAM, DRAFT and user labels, and only when > 0, in `text-foreground/40 tabular-nums`.
  - The active entry uses the inverted style from the mockup (`bg-foreground text-background`), and its count uses `text-background/70`.
  - A user label with a Gmail color shows an 8 px square before its name in that color, with a `// design-exempt: Gmail label color` comment. This is the one sanctioned non-foreground color.
  - When an account's labels query fails with `OAuthError`, its section shows a `Reconnect` ghost button calling `addAccount(email)`.
  - At the bottom: `Settings` (navigates to `/settings`) and `Add account`.
  - Each account calls `bootstrapCorrespondents(account)` once on mount (Task 4), fire-and-forget.

- [ ] **Step 1: Write the failing tests.** Stub `fetch` for the labels endpoints with two accounts in storage:
  - renders "All inboxes" with the summed count `5` (3 + 2);
  - renders `Work` with the nested child `Clients`;
  - clicking `Spam` under account B navigates so that `router.state.location.search` has `{ account: B, folder: 'SPAM' }`;
  - `OAuthError` on B's labels → a `Reconnect` button in B's section, while A's folders still render.
- [ ] **Step 2: Run them.** `pnpm vitest run entrypoints/popup/popout/Sidebar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire it into `MailRoute` in place of the placeholder.
- [ ] **Step 4: Run them, plus the design test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: popout sidebar with accounts, folders and labels`.

### Task 11: Thread list

**Files:**
- Create: `entrypoints/popup/popout/ThreadList.tsx`, `entrypoints/popup/popout/ThreadListRow.tsx`
- Test: `entrypoints/popup/popout/ThreadList.test.tsx`

**Interfaces:**
- Consumes: `useThreadList`, `useLabels`, `MailSearch`, `CATEGORY_LABEL`; `getThreadCode` from `lib/otp.ts` (fed with subject + snippet); `suspicionOf` with the row's `authResults` parsed through `senderIdentity`; `runUndoable`.
- Produces:
  - `ThreadList(props: { checked: Set<string>; onCheckedChange: (next: Set<string>) => void; searchRef: React.RefObject<HTMLInputElement> })`. Rows are keyed by `row.url`. `checked` is lifted to `MailRoute`, because the shortcuts (Task 14) and the reading pane need it;
  - `ThreadListRow(props: { row: ThreadRow; selected: boolean; checked: boolean; showAccount: boolean; folder: string; onSelect(): void; onCheck(shift: boolean): void })`.
- Behavior:
  - **Header:** the folder name (Source Serif, as `PageTitle`) and an All / Unread segmented switch that sets `unread`.
  - **Search:** a field (`Search mail`, placeholder `Search`) sets `q` on Enter, and a clear button removes it. While `q` is set, the header reads `Results for “q”`.
  - **Category tabs** show above an INBOX list when any of SOCIAL/PROMOTIONS/UPDATES/FORUMS has `threadsTotal > 0`. Only tabs with `threadsTotal > 0` show (Primary always), each with its unread count.
  - **Row:**
    - sender name, or `To: …` in SENT/DRAFT;
    - date (`HH:mm` today, `ddd` this week, `D MMM` otherwise);
    - subject and snippet;
    - unread dot plus `font-medium` when it has `UNREAD`;
    - a star toggle button (`runUndoable` star/unstar);
    - a paperclip when `hasAttachment`;
    - the code in `text-bell` when `getThreadCode` finds one and the row isn't suspicious;
    - a `TriangleAlertIcon` when suspicious;
    - a checkbox, revealed on hover or when anything is checked;
    - in All inboxes, the account's initial in a 16 px square `bg-foreground/10`.
  - **Interaction:**
    - Clicking a row sets `thread`.
    - Clicking the checkbox toggles it, and shift-click checks the range from the last checked row.
    - An `IntersectionObserver` sentinel at the bottom calls `fetchNextPage` while `hasNextPage`.
    - With anything checked, the header is replaced by a bulk bar showing `N selected`, with Archive, Delete, Spam, Read and Unread ghost buttons (`runUndoable` over all checked) and `Clear`.
  - **Empty state:** `Nothing here`, in `text-foreground/40`.

- [ ] **Step 1: Write the failing tests.** Stub `fetch` with a page of 50 and a `nextPageToken`, then a second page of 10:
  - `renders rows and loads the next page on scroll`: 50 rows; scroll the sentinel into view → 60.
  - `unread switch`: clicking `Unread` makes the next `threads.list` request carry `labelIds=UNREAD`.
  - `category tabs only for used categories`: SOCIAL total 4 and the others 0 → tabs `Primary` and `Social` only.
  - `search sets q`: type `from:bob`, press Enter → the location search has `q: 'from:bob'` and the header reads `Results for “from:bob”`.
  - `shift-click checks a range`: check row 2, shift-check row 5 → 4 checked, and the bulk bar shows `4 selected`.
  - `suspicious row hides the code`: a row with a failing `authResults` and the snippet `Your code is 482913` → no `.text-bell` and a warning icon present.
- [ ] **Step 2: Run them.** `pnpm vitest run entrypoints/popup/popout/ThreadList.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire it into `MailRoute`.
- [ ] **Step 4: Run them, plus the design test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: popout thread list with paging, categories, search and multi-select`.

### Task 12: All inboxes

**Files:**
- Create: `lib/mail/merge.ts`
- Modify: `lib/mail/queries.ts` (`useAllInboxes`)
- Test: `lib/mail/merge.test.ts`

**Interfaces:**
- Produces:
  - `interface AccountPages { account: string; rows: ThreadRow[]; exhausted: boolean }`;
  - `mergeInboxes(pages: AccountPages[]): { rows: ThreadRow[]; limiting: string[] }`. `rows` holds every row with `date >= cutoff`, sorted newest first. `cutoff` is the **latest** of the oldest loaded dates among non-exhausted accounts; with all accounts exhausted there is no cutoff. `limiting` lists the non-exhausted accounts whose oldest row is the cutoff, or is older than nothing else loaded, which are the ones to page next;
  - `useAllInboxes(search: MailSearch)`, a `useInfiniteQuery` whose `pageParam` is `Record<account, string | null | undefined>` (undefined = not started, null = exhausted).
    - The first page fetches every account.
    - `getNextPageParam` asks only `limiting` accounts for their next token.
    - `select` flattens per account and runs `mergeInboxes`.
    - It returns the same shape `ThreadList` reads from `useThreadList`: `{ rows, hasNextPage, fetchNextPage, isPending, error }`. Make `useThreadList` return that shape too.
    - Each account's query is `listQuery('INBOX', { category, unread, q })`; search in All inboxes searches every account (my call, recorded in the code comment).
    - A failed account is treated as exhausted, so the others still show, and the sidebar shows its `Reconnect`.

- [ ] **Step 1: Write the failing tests:**
  - `cuts at the latest oldest date`: A has rows dated 10, 9 and 8 (not exhausted); B has 9.5 and 5 (not exhausted). Expect the row dates to be `[10, 9.5, 9, 8]` and `limiting` to be `['A']`. B's 5 is held back, since A may still have mail between 8 and 5.
  - `exhausted accounts don't hold the cut`: B is exhausted with `[9.5, 5]` → all five rows, `limiting: ['A']`.
  - `all exhausted shows everything`.
  - `empty account that is exhausted is ignored`.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/mail/merge.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then hook `useAllInboxes` into `useThreadList` for `account === 'all'`.
- [ ] **Step 4: Run them**, plus `entrypoints/popup/popout`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: All inboxes merges accounts in date order`.

### Task 13: Reading pane, mark read and preload

**Files:**
- Create: `entrypoints/popup/popout/ReadingPane.tsx`, `lib/mail/markRead.ts`, `lib/mail/preload.ts`
- Test: `lib/mail/markRead.test.tsx`, `lib/mail/preload.test.ts`, `entrypoints/popup/popout/ReadingPane.test.tsx`

**Interfaces:**
- Consumes: `useOpenThread`, `ThreadView` (with `onEngage`), `runUndoable`, `runSilent`, `useLabels` and `getSettings`. Also `openMailInWeb` from `gmail.ts`, for the overflow menu only.
- Produces:
  - `ReadingPane(props: { checked: Set<string> })`;
  - `useMarkRead(thread: OpenThread | undefined, mode: Settings['markRead']): { engage(): void }`:
    - `'delay'` → after 2000 ms on the same thread, `runSilent({kind:'read'})` if the thread has UNREAD; leaving earlier cancels it;
    - `'immediate'` → at once;
    - `'manual'` → never, unless `engage()` is called;
    - `engage()` marks it read now in `'delay'` and `'immediate'` modes, not in `'manual'`;
    - it never marks the same thread twice per selection;
  - `preloadTargets(rows: string[], selected: number): string[]`. This is the first 10 plus `selected-3 … selected+3`, deduped, in priority order: the neighbours nearest first, then the first rows. `selected = -1` means only the first 10;
  - `usePreload(rows: ThreadRow[], selectedUrl?: string)`. It runs `queryClient.prefetchQuery(mailKeys.thread…)` for the targets not already cached, at most 2 at a time, and abandons queued ones when the targets change.
- **Action bar**, which acts on the checked threads when any are checked, else on the open thread:
  - ghost icon buttons with titles carrying the shortcut:
    - `Archive (e)`;
    - `Delete (#)`;
    - `Spam (!)`;
    - `Mark unread (Shift+U)`;
    - `Star (s)`;
  - in SPAM, `Not spam` replaces Spam, and in TRASH, `Restore` replaces Delete;
  - a `Label as (l)` menu: radix `DropdownMenu` of user labels with checkmarks for the current ones, toggling label/unlabel;
  - a `Move to (v)` menu that moves from the current folder's label;
  - an overflow `…` menu with `Open in Gmail`;
  - after an action that removes the thread from the folder, the selection moves to the next row (or the previous, at the end).
- **Empty state** (no `thread`): `No conversation selected`, in `text-foreground/40`, centered.

- [ ] **Step 1: Write the failing tests:**
  - `preloadTargets(ids(30), 12)` → starts `[ids[13], ids[11], ids[14], ids[10], ids[15], ids[9]]`, then `ids[0..9]` (excluding duplicates), 16 entries in all.
  - `preloadTargets(ids(5), -1)` → all 5.
  - `useMarkRead`, with fake timers and a `modifyThreads` spy:
    - `'delay'`: at 1999 ms, no call; at 2000 ms, one call removing `UNREAD`;
    - switching thread at 1500 ms → no call for the first;
    - `engage()` at 100 ms → an immediate call, and none again at 2000 ms;
    - `'manual'` + `engage()` → no call;
    - a thread without UNREAD → never.
  - `usePreload` never sends a modify request; assert there is no `/modify` in the fetch log.
  - `ReadingPane`:
    - in TRASH it shows `Restore` and no `Delete`;
    - clicking `Archive` calls `runUndoable` with archive and selects the next row;
    - with 3 checked, `Archive` acts on the 3;
    - `Open in Gmail` is reachable only through the overflow menu: there's no `a[href^="https://mail.google.com"]` in the pane outside it.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/mail/markRead.test.tsx lib/mail/preload.test.ts entrypoints/popup/popout/ReadingPane.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire `ReadingPane` and `usePreload` (called in `MailRoute` with the list rows) into `MailRoute`.
- [ ] **Step 4: Run them, plus the design test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: reading pane with actions, labels menus, mark read and preload`.

### Task 14: Keyboard

**Files:**
- Create: `entrypoints/popup/popout/usePopoutShortcuts.ts`, `entrypoints/popup/popout/ShortcutSheet.tsx`
- Modify: `entrypoints/popup/popout/MailRoute.tsx`; `components/mail/ThreadView.tsx` (`ReplyBox` takes `shortcuts?: boolean`, default true, and the popout passes false so the popout map owns `r`/`a`)
- Test: `entrypoints/popup/popout/usePopoutShortcuts.test.tsx`

**Interfaces:**
- Consumes: `useShortcuts` with sequences (Task 8), `runUndoable`, `undoLatest`, `useMarkRead().engage`, the list rows, `checked`, `searchRef`, and the reading pane's label menus (opened through a `labelMenu: 'label' | 'move' | null` state in `MailRoute`).
- Produces: `usePopoutShortcuts(ctx: { rows: ThreadRow[]; search: MailSearch; checked: Set<string>; setChecked; navigate; engage(): void; openReply(mode: 'reply' | 'all'): void; openLabelMenu(kind: 'label' | 'move'): void; searchRef; showSheet(): void })`.
- The map:

| Key | Action |
|---|---|
| `j` / `k` | select the next / previous row (from none: the first) |
| `Enter`, `o` | `engage()` and focus the reading pane |
| `u` | clear `thread` |
| `x` | toggle the selected row's check |
| `e` | archive |
| `#`, `Delete`, `Backspace` | trash, or restore in TRASH |
| `!` | spam, or notSpam in SPAM |
| `s` | star toggle |
| `U` (Shift+U) | unread |
| `I` (Shift+I) | read |
| `z` | `undoLatest()` |
| `r` / `a` | `openReply` |
| `c` | `newEmail(account)` (Part 2 replaces this) |
| `/` | focus search |
| `g i` / `g s` / `g t` / `g d` | Inbox / Starred / Sent / Drafts of the current account (All inboxes → INBOX of `all`) |
| `?` | shortcut sheet |
| `l` / `v` | label / move menus |

- `f` (forward) isn't mapped until Part 2.
- Action keys act on the checked threads when any are checked.
- **Shortcut sheet:** a radix Dialog, if radix-ui exports one (it does), styled like the menus (`menu-surface`), listing the map above in two columns, with `Esc` to close.

- [ ] **Step 1: Write the failing tests.** Render `MailRoute` with stubbed rows A, B and C:
  - `j` twice → B selected;
  - `e` → archive called for B, and C selected;
  - `z` → undo called;
  - with A and C checked, `#` → trash on [A, C];
  - `g` then `s` → `folder: 'STARRED'`;
  - `/` → the search input is focused;
  - typing `e` in the search input → no archive;
  - `?` → the dialog `Keyboard shortcuts` is visible.
- [ ] **Step 2: Run them.** `pnpm vitest run entrypoints/popup/popout/usePopoutShortcuts.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, and call it from `MailRoute`.
- [ ] **Step 4: Run them**, plus `entrypoints/popup` and `lib/design`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Gmail keyboard shortcuts in the popout`.

### Task 15: Notification click opens the popout

**Files:**
- Modify: `lib/messager.ts` (`popupMessager` gains `openThread(url: string): boolean`), `entrypoints/background.ts` (the onClicked handler at about line 98), `entrypoints/popup/main.tsx`
- Create: `lib/openPopout.ts`
- Test: `lib/openPopout.test.ts`

**Interfaces:**
- Produces:
  - `popoutUrl(threadUrl: string): string` → `browser.runtime.getURL('/popup.html') + '?view=tab#/mail?account=<acct>&folder=INBOX&thread=<encoded threadUrl>'`. Build the hash with the router's search serializer, or `URLSearchParams`, as long as `validateMailSearch` round-trips it;
  - `openPopoutOn(threadUrl: string): Promise<void>`. It tries `popupMessager.sendMessage('openThread', threadUrl)`; if that resolves true, it's done. Otherwise, or on throw (no listener), `browser.tabs.create({ url: popoutUrl(threadUrl) })`.
- In `main.tsx`, only when `isPopoutTab`: `popupMessager.onMessage('openThread', async ({ data }) => { navigate to /mail with that thread; const tab = await browser.tabs.getCurrent(); await browser.tabs.update(tab.id, { active: true }); await browser.windows.update(tab.windowId, { focused: true }); return true })`. The toolbar popup doesn't register it.
- `background.ts`: the notification click calls `openPopoutOn(id.slice(NOTIFICATION_PREFIX.length))`, replacing both `openPopup()` and the `openMailInWeb` fallback.

- [ ] **Step 1: Write the failing tests:**
  - `opens a new tab when no popout listens`: `popupMessager.sendMessage` rejects → `tabs.create` with a URL whose hash parses through `validateMailSearch` to `{ account, folder: 'INBOX', thread: threadUrl }`.
  - `reuses an open popout`: `sendMessage` resolves true → no `tabs.create`.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/openPopout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run them**, then `pnpm compile`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: notification click opens the popout on that mail`.

### Task 16: Live updates while Mailbell is open

**Files:**
- Create: `lib/mail/live.ts`
- Modify: `lib/messager.ts` (bg gains `viewVisible(visible: boolean): void`), `entrypoints/background.ts` (the port handler at about line 133 and the alarm block at about line 159), `entrypoints/popup/main.tsx`, `entrypoints/popup/popout/MailRoute.tsx`, and `lib/api/mailbox.ts` (`getProfile`, `listHistory`)
- Test: `lib/mail/live.test.ts`, `entrypoints/background.test.ts` (create if absent; else put the timer logic in `lib/fastPoll.ts` with `lib/fastPoll.test.ts`)

**Interfaces:**
- Consumes: `gmailFetch` (Task 1), `mailKeys` and the `ThreadRow`/`listThreadPage` metadata fetch (Task 2), `labelOps`-style row patching from `lib/mail/actions.ts` (Task 7; reuse its patch helper rather than writing a second one).
- Produces (`mailbox.ts`):
  - `getProfile(account): Promise<{ historyId: string }>`;
  - `listHistory(account, startHistoryId): Promise<{ history: HistoryRecord[]; historyId: string } | 'expired'>`. It follows `nextPageToken`, uses `historyTypes=messageAdded&historyTypes=messageDeleted&historyTypes=labelAdded&historyTypes=labelRemoved`, and maps a 404 to `'expired'`;
  - `HistoryRecord` has only the used fields: `messagesAdded`, `messagesDeleted`, `labelsAdded` and `labelsRemoved`, each carrying `message: { id, threadId, labelIds }` and, for the label kinds, `labelIds`.
- Produces (`lib/fastPoll.ts`, used by `background.ts`):
  - `FAST_POLL_MS = 10_000`;
  - `createFastPoll(poll: () => Promise<void>)` returns `{ setVisible(viewId: string, visible: boolean): void; drop(viewId: string): void }`.
    - While any view is visible, it runs `poll` every 10 s with `setTimeout` chaining, so a run never overlaps the next. The open port keeps the worker alive.
    - When the count of visible views goes from 0 to 1, it polls at once.
    - When no view is visible, it stops. The `fetchThreads` alarm is untouched and keeps running.
  - In `background.ts`, `poll` is `stateManager.fetchThreads()`, which already short-circuits on an unchanged profile `historyId`.
  - `viewVisible` messages carry the sender's port name and id. The id is `sender.tab?.id ?? 'popup'`; a disconnecting port calls `drop`.
- Produces (`main.tsx`): on load and on every `visibilitychange`, `bgMessager.sendMessage('viewVisible', document.visibilityState === 'visible')`.
- Produces (`live.ts`):
  - `applyHistory(account: string, records: HistoryRecord[]): Promise<'patched' | 'reload'>`:
    - `labelsAdded` / `labelsRemoved` patch the `labelIds` of cached rows and threads. A row leaves every cached list whose folder label it lost: INBOX removed → gone from Inbox lists; TRASH or SPAM added → gone from every list except that folder.
    - `messagesAdded` fetch that thread's row (the metadata call from Task 2) and put it at the top of each cached first page whose `listQuery` labels it has, replacing an existing row with the same `threadId`.
    - `messagesDeleted` remove the row when its thread has no messages left; otherwise refetch the row.
    - More than 50 records → `'reload'`.
    - A cached list whose query has `q` (search) can't be matched locally → invalidate just that query.
  - `useLiveUpdates(accounts: string[])` lives in `MailRoute`:
    - it keeps `lastHistoryId` per account in a ref, seeded from `getProfile` on mount;
    - while `document.visibilityState === 'visible'`, every `FAST_POLL_MS` and on `focus`, it runs `checkNow()`;
    - `checkNow()`: for each account, `getProfile`; if the id changed, `listHistory`; `'expired'` or `'reload'` → `invalidateQueries({ queryKey: ['mail'] })` for that account; then store the new id;
    - it is exported for Task 17's `refreshPopup` hook;
    - it also invalidates `mailKeys.labels(account)` when anything changed, so the counts follow;
    - at most one `checkNow` runs at a time; a call while one runs is folded into it.

- [ ] **Step 1: Write the failing tests:**
  - `fastPoll` (fake timers):
    - `setVisible('t1', true)` → `poll` is called at once, then again at 10 s and at 20 s;
    - `setVisible('t1', false)` at 25 s → no call at 30 s;
    - two views, one hidden → it keeps polling;
    - `drop` of the last visible view → it stops;
    - a `poll` that takes 15 s → the next call starts 10 s after it resolves, never overlapping.
  - `applyHistory`:
    - seed an INBOX list holding A and B and a STARRED list holding A;
    - `labelsRemoved INBOX` on A → the INBOX list is `[B]` and STARRED still has A;
    - `labelsAdded STARRED` on B → after the metadata fetch, the STARRED list contains B (B is inserted only if its row data is cached or fetched);
    - `messagesAdded` on a new thread C labeled INBOX/UNREAD → C is the first row of the INBOX list, and the STARRED list is unchanged;
    - `labelsRemoved UNREAD` on A → A's row no longer has UNREAD;
    - 51 records → `'reload'`.
  - `checkNow`:
    - an unchanged profile `historyId` → no `history` request;
    - a changed id → one `history` request with `startHistoryId=<old>`;
    - a 404 from history → `['mail']` queries for that account are invalidated, and the stored id is updated.
- [ ] **Step 2: Run them.** `pnpm vitest run lib/fastPoll.test.ts lib/mail/live.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire it into `background.ts`, `main.tsx` and `MailRoute`.
- [ ] **Step 4: Run them.** `pnpm vitest run lib entrypoints/popup`. Expected: PASS. Then `pnpm compile`.
- [ ] **Step 5: Commit** `feat: live updates while Mailbell is open`.

### Task 17: Freshness and final verification

**Files:**
- Modify: `entrypoints/popup/App.tsx`
- Test: `entrypoints/popup/popout/MailRoute.test.tsx` (extend)

**Interfaces:**
- Consumes: `mailKeys`, `checkNow()` (Task 16).
- Behavior: on `refreshPopup`, the popout calls `checkNow()` (Task 16), which patches the caches in place or falls back to `queryClient.invalidateQueries({ queryKey: ['mail'] })`. Refetching keeps the previous data (`placeholderData: keepPreviousData` on the list queries), so the selection and scroll stay put. An open thread that is gone after the refetch stays shown until the user moves.

- [ ] **Step 1: Write the failing test:** `refreshPopup keeps the selected thread selected`. Select B, trigger the `refreshPopup` handler, and have the stubbed list return A and B with B's snippet changed → B is still selected and the new snippet shows. The reading pane never shows the empty state during the refetch: assert it is never rendered, using a MutationObserver or by polling `queryByText('No conversation selected')` across `waitFor`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole gate:** `pnpm test`, `pnpm compile`, `pnpm build` and `pnpm build:firefox`. Expected: all green. The design test must pass with no new violations. `grep -rn "mail.google.com" entrypoints/popup/popout` should match only the overflow-menu call site comment, if any.
- [ ] **Step 5: Manual smoke** in `pnpm dev`, with a real account:
  - open the popout;
  - go through each folder, plus All inboxes and categories;
  - search;
  - archive, then undo with `z`;
  - delete from Trash's neighbour, then restore;
  - open a Spam mail and see the safe view;
  - see an image-heavy newsletter blocked, and **Show images** working;
  - click a notification: an existing popout is focused on that mail.

  Note anything off in the PR description.
- [ ] **Step 6: Commit** `feat: popout refreshes in place on new mail`.
