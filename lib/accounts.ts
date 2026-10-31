import { toast } from 'sonner'
import { bgMessager } from './messager'

// Starts Google's sign-in in the background. In the toolbar popup the call
// never resolves here: the popup closes as soon as the sign-in window opens,
// and the background finishes on its own.
export async function addAccount(loginHint?: string) {
  try {
    const email = await bgMessager.sendMessage('addAccount', loginHint)
    toast.success(`Signed in as ${email}`)
  } catch (err) {
    console.error(err)
    toast.error(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
