import { Button } from '@/components/ui/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, PageTitle } from '@/components/extra/PageHeader'
import { toast } from 'sonner'
import {
  clearNotificationSound,
  getNotificationSound,
  playSound,
  setNotificationSound,
} from '@/lib/sound'
import { isPopoutTab } from '../view'

const soundQueryKey = ['notificationSound']

export function SoundPage() {
  const queryClient = useQueryClient()
  const soundQuery = useQuery({ queryKey: soundQueryKey, queryFn: getNotificationSound })
  const sound = soundQuery.data ?? null

  async function pick(file: File | undefined) {
    if (!file) return
    try {
      const picked = await setNotificationSound(file)
      await queryClient.invalidateQueries({ queryKey: soundQueryKey })
      await playSound(picked)
      toast.success('Sound saved')
    } catch (err) {
      console.error(err)
      toast.error(String(err))
    }
  }

  async function turnOff() {
    await clearNotificationSound()
    await queryClient.invalidateQueries({ queryKey: soundQueryKey })
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader back title={<PageTitle>Notification sound</PageTitle>} />
      <div className="flex flex-col gap-3 p-4">
        <p>
          <span className="text-foreground/60">Current:</span> <span className="font-medium">{sound ? sound.name : 'none (system sound only)'}</span>
        </p>
        <div className="flex gap-2">
          {/* Firefox closes the toolbar popup as soon as a file dialog opens,
              so the picker only works in the standalone tab. */}
          {isPopoutTab ? (
            <Button asChild>
              <label>
                Choose sound file
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(ev) => pick(ev.target.files?.[0])}
                />
              </label>
            </Button>
          ) : (
            <Button
              onClick={() => {
                void browser.tabs.create({ url: browser.runtime.getURL('/popup.html?view=tab&page=/sound') })
                window.close()
              }}
            >
              Choose sound file
            </Button>
          )}
          {sound && (
            <>
              <Button variant="secondary" onClick={() => playSound(sound)}>
                Test
              </Button>
              <Button variant="secondary" onClick={turnOff}>
                Turn off
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-foreground/60">
          Plays when new mail arrives. To avoid two sounds, turn off "Play sound for notifications" for Firefox in
          macOS System Settings → Notifications.
        </p>
      </div>
    </div>
  )
}
