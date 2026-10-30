# Setting up a Google OAuth client

Mailbell needs a Google OAuth client before it can sign in. You need your own client in either of two cases:

- **As a user**: to avoid the "unverified app" warning and the 100-user cap of the built-in client. Enter the client in the popup under **Settings → Google OAuth client**.
- **As a publisher**: to build the client into your release. Put it in `.env` as `WXT_GOOGLE_CLIENT_ID` and `WXT_GOOGLE_CLIENT_SECRET`.

All of this is free.

## 1. Create a project and enable the Gmail API

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project, for example "Mailbell".
2. Go to **APIs & Services → Library**, search for **Gmail API** and click **Enable**.

## 2. Configure the consent screen

Go to **Google Auth Platform** (formerly *OAuth consent screen*):

1. **Branding**: set the app name, for example "Mailbell", and your email address.
2. **Audience**: choose **External**, then:
   - **Personal client** (only you will sign in): leave it in *Testing* and add your own Google account(s) under **Test users**. Testing-mode refresh tokens expire after **7 days**, which means you sign in again every week.
   - **To skip the weekly sign-in**: click **Publish app** to set it to *In production*. You don't need to submit it for verification. The app stays unverified: sign-in shows a warning screen and the client is capped at 100 users. Neither matters for a personal client.
3. **Data access**: add the scope `https://www.googleapis.com/auth/gmail.modify`.

## 3. Create the client

1. Go to **Clients → Create client**.
2. Set **Application type** to **Web application**. The *Chrome extension* type does not work with Firefox.
3. Under **Authorized redirect URIs**, add the redirect URI that Mailbell shows under **Settings → Google OAuth client**:
   - Firefox: a URI that looks like `https://<hash>.extensions.allizom.org/`
   - Chrome: `https://<extension-id>.chromiumapp.org/`

   The URI depends on the extension's ID. A self-loaded development build has a different ID from the AMO release, so register each one you use.
4. Click **Create**, then copy the **Client ID** and **Client secret**.

Google asks Web clients for the secret even though Mailbell uses PKCE. An extension can't keep a secret hidden, and Google accepts that for this kind of client. The secret identifies the client but does not grant access to anyone's mail.

## 4. Use it

- **In the extension**: open **Settings**, paste the client ID and secret, and click **Save**. Then click **Add account**. Changing the client signs out every account, because refresh tokens belong to the client that issued them.
- **In a build**: put both values in `.env`, then run `pnpm zip:firefox`.

## Publishing on AMO

- Upload `.output/mailbell-<version>-firefox.zip`. AMO also asks for the source code: upload `.output/mailbell-<version>-sources.zip` and point reviewers to this README. They can build it with `pnpm install && pnpm zip:firefox`. The `.env` is not in the sources zip, so tell reviewers that the built-in client ID comes from it.
- The manifest declares `data_collection_permissions: none`. Mail goes only to Google, never to the developer.
- With the built-in client unverified, the 100-user cap applies across all users of the release. Once you need more, request verification for the `gmail.modify` scope, which requires a CASA Tier 2 security assessment that is renewed yearly. Meanwhile, users can bring their own client.
