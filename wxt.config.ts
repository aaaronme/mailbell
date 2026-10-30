import { defineConfig, type UserManifest } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()] as any,
    build: {
      minify: false,
      sourcemap: true,
    },
  }),
  manifestVersion: 3,
  zip: {
    name: 'mailbell',
  },
  manifest: (env) => {
    const manifest: UserManifest = {
      name: 'Mailbell for Gmail',
      description:
        'Get notified of new Gmail mail and read, archive or delete it right from the toolbar. Uses the official Gmail API.',
      permissions: ['storage', 'alarms', 'contextMenus', 'notifications', 'idle', 'identity'],
      // Google's token endpoint and the Gmail API, nothing else: mail is
      // read with an OAuth token, never with the browser's Gmail cookies.
      host_permissions: ['https://oauth2.googleapis.com/*', 'https://gmail.googleapis.com/*'],
      action: {
        default_icon: {
          '16': 'icon/16.png',
          '32': 'icon/32.png',
          '48': 'icon/48.png',
          '96': 'icon/96.png',
          '128': 'icon/128.png',
        },
      },
      homepage_url: 'https://github.com/aaaronme/mailbell',
    }
    if (env.browser === 'firefox') {
      manifest.browser_specific_settings = {
        gecko: {
          id: 'mailbell@aaaronme.github.io',
          // data_collection_permissions needs 140.
          strict_min_version: '140.0',
          data_collection_permissions: {
            // Mail goes only between the browser and Google; nothing is sent
            // to the developer or any other party.
            required: ['none'],
          },
        },
      }
    }
    return manifest
  },
  webExt: {
    disabled: true,
  },
})
