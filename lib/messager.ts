import { defineExtensionMessaging } from '@webext-core/messaging'
import type { UnsubscribePlan } from './unsubscribe'
import type { OAuthClient } from './auth/oauth'
import type { Recipients } from './reply'

export const bgMessager = defineExtensionMessaging<{
  // popup to background: the refresh button - re-reads every thread
  refreshThreads(): void
  // popup to background: the popup opened - an ordinary poll
  poll(): void
  // popup to background
  gmailAction(data: GmailAction): void
  // popup to background: thread url -> how it was done, null if no option
  unsubscribe(url: string): UnsubscribePlan['kind'] | null
  // popup to background: interactive Google sign-in, optionally for a known
  // address (reconnect) -> the signed-in address
  addAccount(loginHint?: string): string
  // popup to background
  removeAccount(email: string): void
  // popup to background: null goes back to the built-in client
  setOAuthClient(client: OAuthClient | null): void
  // popup to background: a plain-text reply into the thread at url
  sendReply(data: { url: string; recipients: Recipients; text: string }): void
}>()

export type GmailAction =
  | {
      cmd: 'archive' | 'markAsRead' | 'markAsUnread' | 'markAsSpam' | 'deleteMail' | 'viewed'
      url: string
    }
  | {
      cmd: 'markAllAsRead' | 'archiveAll' | 'deleteAll'
      urls: string[]
    }

export const popupMessager = defineExtensionMessaging<{
  refreshPopup(): void
}>()
