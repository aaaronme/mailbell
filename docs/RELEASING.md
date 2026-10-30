# Releasing

One version goes to both stores. Releases ship without a built-in OAuth client: each user creates their own, and the popup walks them through it (docs/SETUP.md).

## 1. Cut the release

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v1.2.3 && git push origin v1.2.3`.
3. The **Release** workflow runs the type check and tests, builds both zips and attaches them to a GitHub release:
   - `mailbell-<version>-firefox.zip` and `mailbell-<version>-sources.zip` for AMO
   - `mailbell-<version>-chrome.zip` for the Chrome Web Store

To build locally instead: `pnpm zip:firefox && pnpm zip`, output in `.output/`.

## 2. Firefox (addons.mozilla.org)

1. Sign in at the [Add-on Developer Hub](https://addons.mozilla.org/developers/) and choose **Submit a New Add-on** (later: **Upload New Version** on the add-on's page).
2. Distribution: **On this site**.
3. Upload `mailbell-<version>-firefox.zip`.
4. Source code: yes, upload `mailbell-<version>-sources.zip` (the build is bundled). Reviewer notes:

   > Build with `pnpm install && pnpm zip:firefox` (Node 22); the output is unminified. No built-in OAuth client (`.env` is empty): users create their own. The validator's innerHTML warnings are inside React DOM (`dangerouslySetInnerHTML`) and DOMPurify. The one place Mailbell renders HTML is a mail body, in `entrypoints/popup/pages/DetailPage.tsx` (`MailContent`), sanitized first with DOMPurify (`lib/sanitizeMail.ts`), inside a shadow root, under the default MV3 CSP.
5. Listing: summary, category **Alerts & Updates**, the GPL-3.0 licence, homepage and support URL (the GitHub repo), screenshots. Privacy policy: "Mailbell has no server. Mail goes only between the browser and Google; nothing is collected." The manifest already declares `data_collection_permissions: none`.

Review usually takes from minutes to a few days. The add-on ID is fixed (`mailbell@aaaronme.github.io`), so the Firefox redirect URI users register stays the same across versions.

## 3. Chrome (Chrome Web Store)

1. One-time: register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (a one-time US$5 fee) and verify your email.
2. **New item** (later: the item's **Package → Upload new package**), upload `mailbell-<version>-chrome.zip`.
3. **Store listing**: description, category **Productivity → Communication**, a 128×128 icon (`public/icon/128.png`), at least one 1280×800 screenshot.
4. **Privacy practices**:
   - Single purpose: "Notifies of new Gmail mail and lets the user read and act on it from the toolbar."
   - Permission justifications: `identity` (Google sign-in), `storage` (settings and cached mail), `alarms` (checking for mail), `notifications` (new-mail alerts), `contextMenus` (the toolbar menu), `idle` (pausing while the screen is locked), host access to `oauth2.googleapis.com` and `gmail.googleapis.com` (sign-in and the Gmail API).
   - Remote code: no.
   - Data usage: tick **Personally identifiable information**, **Personal communications** and **Authentication information**; certify that it isn't sold, used for unrelated purposes or for creditworthiness. A privacy-policy URL is required: link the README's Privacy section.
5. Submit for review (usually 1–3 days, longer for a first item).

The store assigns the extension ID on first upload. A self-loaded copy has a different ID, and so a different redirect URI: users register the one the popup shows.

## No built-in client

Shipping a shared client would let users skip creating their own, but a client with the restricted `gmail.modify` scope needs Google's verification and a yearly CASA security assessment once it has more than 100 users. Until that's worth it, every user brings their own client. To add one later, set `WXT_GOOGLE_CLIENT_ID` and `WXT_GOOGLE_CLIENT_SECRET` as repository secrets and pass them to the zip steps in `.github/workflows/release.yaml`.
