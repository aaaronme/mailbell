// While Mailbell is on screen, mail should show up within seconds rather than
// at the next alarm. Kept free of React: the background imports it.
export const FAST_POLL_MS = 10_000

// What a view posts on its 'popup' port when it is shown or hidden.
export interface VisibleMessage {
  type: 'visible'
  visible: boolean
}

export const isVisibleMessage = (msg: unknown): msg is VisibleMessage =>
  typeof msg === 'object' && msg !== null && (msg as VisibleMessage).type === 'visible'

// Polls while any view is visible. Each run is scheduled when the previous one
// settles, so a slow poll is never overlapped by the next.
export function createFastPoll(poll: () => Promise<void>) {
  const visible = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false

  async function run() {
    timer = undefined
    running = true
    try {
      await poll()
    } finally {
      running = false
      schedule()
    }
  }
  function schedule() {
    if (visible.size && timer === undefined && !running) timer = setTimeout(run, FAST_POLL_MS)
  }
  function setVisible(viewId: string, isVisible: boolean) {
    const before = visible.size
    if (isVisible) visible.add(viewId)
    else visible.delete(viewId)
    if (!visible.size) {
      clearTimeout(timer)
      timer = undefined
    } else if (before === 0 && !running) {
      clearTimeout(timer)
      void run()
    }
  }
  return { setVisible, drop: (viewId: string) => setVisible(viewId, false) }
}
