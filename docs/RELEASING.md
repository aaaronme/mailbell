# Releasing

One version goes to both stores. Releases ship with a built-in OAuth client (see [Built-in client](#built-in-client)); users can still use their own instead (docs/SETUP.md).

## 1. Cut the release

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v1.2.3 && git push origin v1.2.3`.
3. The **Release** workflow runs the type check and tests, builds both zips and attaches them to a GitHub release:
   - `mailbell-<version>-firefox.zip` and `mailbell-<version>-sources.zip` for AMO
   - `mailbell-<version>-chrome.zip` for the Chrome Web Store

To build locally instead: `pnpm zip:firefox && pnpm zip`, output in `.output/`.

When the Release workflow succeeds, **Publish to stores** uploads its zips to both stores and submits them for review (see [Automatic publishing](#automatic-publishing)). The steps below are for the first submission of each store, which has to be done by hand, and for when the workflow can't run.

## 2. Firefox (addons.mozilla.org)

1. Sign in at the [Add-on Developer Hub](https://addons.mozilla.org/developers/) and choose **Submit a New Add-on** (later: **Upload New Version** on the add-on's page).
2. Distribution: **On this site**.
3. Upload `mailbell-<version>-firefox.zip`.
4. Source code: yes, upload `mailbell-<version>-sources.zip` (the build is bundled). Reviewer notes:

   > Build with `pnpm install && pnpm zip:firefox` (Node 22); the output is unminified. The built-in OAuth client comes from `WXT_GOOGLE_CLIENT_ID` and `WXT_GOOGLE_CLIENT_SECRET`; the sources zip leaves them out, so a build from it asks for the user's own client. The validator's innerHTML warnings are inside React DOM (`dangerouslySetInnerHTML`) and DOMPurify. The one place Mailbell renders HTML is a mail body, in `entrypoints/popup/pages/DetailPage.tsx` (`MailContent`), sanitized first with DOMPurify (`lib/sanitizeMail.ts`), inside a shadow root, under the default MV3 CSP.
5. Listing: the text in `docs/STORE_LISTING.md`, the GPL-3.0 licence, homepage https://aaaronme.github.io/mailbell/, support URL (the repo's issues), screenshots, privacy policy https://aaaronme.github.io/mailbell/privacy. The manifest already declares `data_collection_permissions: none`.

Review usually takes from minutes to a few days. The add-on ID is fixed (`mailbell@aaaronme.github.io`), so the Firefox redirect URI users register stays the same across versions.

## 3. Chrome (Chrome Web Store)

1. One-time: register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (a one-time US$5 fee) and verify your email.
2. **New item** (later: the item's **Package → Upload new package**), upload `mailbell-<version>-chrome.zip`.
3. **Store listing**: description, category **Productivity → Communication**, a 128×128 icon (`public/icon/128.png`), at least one 1280×800 screenshot.
4. **Privacy practices**:
   - Single purpose: "Notifies of new Gmail mail and lets the user read and act on it from the toolbar."
   - Permission justifications: `identity` (Google sign-in), `storage` (settings and cached mail), `alarms` (checking for mail), `notifications` (new-mail alerts), `contextMenus` (the toolbar menu), `idle` (pausing while the screen is locked), host access to `oauth2.googleapis.com` and `gmail.googleapis.com` (sign-in and the Gmail API).
   - Remote code: no.
   - Data usage: tick **Personally identifiable information**, **Personal communications** and **Authentication information**; certify that it isn't sold, used for unrelated purposes or for creditworthiness. Privacy policy: https://aaaronme.github.io/mailbell/privacy
5. Submit for review (usually 1–3 days, longer for a first item).

The store assigns the extension ID on first upload. A self-loaded copy has a different ID, and so a different redirect URI: users register the one the popup shows.

## Built-in client

The release workflow builds the client from the repository secrets `WXT_GOOGLE_CLIENT_ID` and `WXT_GOOGLE_CLIENT_SECRET`; locally, the same names in `.env`. It is a *Web application* client in Google Cloud, published (*In production*) but unverified: sign-in shows Google's unverified-app warning, and the client is capped at 100 users in total. Past that it needs Google's verification and a yearly CASA security assessment.

Its authorized redirect URIs are the ones the popup shows in Settings: the Firefox one (fixed, from the add-on ID) and the Chrome Web Store one (`https://<store extension id>.chromiumapp.org/`). Add the redirect URI of a self-loaded copy only for testing, and remove it after.

The secret ships inside the extension, as it does for every installed app; Google doesn't treat it as confidential for them. Sign-in still needs the user's consent, PKCE and a registered redirect URI, and no one's mail is reachable without their own tokens, which never leave their browser. What a copied secret allows is someone else's app signing in as Mailbell, which spends the 100-user cap and quota. If that happens, add a new secret in Google Cloud, update the repository secret, release, then delete the old one.

## Automatic publishing

`.github/workflows/publish.yaml` runs after every successful Release, or by hand (**Actions → Publish to stores → Run workflow**, with a tag) to retry one. It uploads the release's zips with `wxt submit` and submits them for review; the stores still review each version before users get it. A store whose secrets aren't set is skipped with a warning, so it can be set up one store at a time.

Set the secrets with `gh secret set <NAME> -R aaaronme/mailbell` (it prompts for the value, which keeps it out of your shell history).

**Firefox**, after the first version is listed on AMO:

1. At [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/), generate credentials.
2. `FIREFOX_JWT_ISSUER`: the JWT issuer (`user:…`). `FIREFOX_JWT_SECRET`: the JWT secret.

**Chrome**, after the first upload has given the item its ID:

1. `CHROME_EXTENSION_ID`: the item's ID, from the developer dashboard.
2. `CHROME_PUBLISHER_ID`: from the dashboard's **Account** page.
3. In Google Cloud, enable the **Chrome Web Store API** and create a service account with a JSON key. Then, in the developer dashboard's **Account** page, add the service account's email under API access.
4. `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`: the key's `client_email`. `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`: its `private_key`, the whole `-----BEGIN PRIVATE KEY-----` block.

`pnpm wxt submit init` walks through the same values interactively, and `pnpm wxt submit --dry-run …` checks them without uploading.
