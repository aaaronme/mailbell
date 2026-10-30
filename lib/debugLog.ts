const STORAGE_KEY = 'debugLogs'
const MAX_ENTRIES = 300

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`
  }
  if (typeof arg === 'string') {
    return arg
  }
  try {
    // Errors nested in objects (allSettled results) would otherwise print as {}.
    return JSON.stringify(arg, (_, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v))
  } catch {
    return String(arg)
  }
}

function hasBrowser() {
  return 'browser' in globalThis || 'chrome' in globalThis
}

// The background's console only shows what was logged while a devtools window
// was open. Keep a rolling buffer in storage.local (shared across contexts,
// survives background restarts) so it can be read after the fact.
export async function debugLog(...args: unknown[]) {
  console.log(...args)
  if (!hasBrowser()) {
    return
  }
  const line = `[${new Date().toISOString()}] ${args.map(formatArg).join(' ')}`
  try {
    const { [STORAGE_KEY]: existing = [] } = await browser.storage.local.get<Record<string, string[]>>(STORAGE_KEY)
    await browser.storage.local.set({ [STORAGE_KEY]: [...existing, line].slice(-MAX_ENTRIES) })
  } catch (err) {
    console.error('debugLog: failed to persist log entry', err)
  }
}

export async function getDebugLogs(): Promise<string[]> {
  const { [STORAGE_KEY]: logs = [] } = await browser.storage.local.get<Record<string, string[]>>(STORAGE_KEY)
  return logs
}

export async function clearDebugLogs() {
  await browser.storage.local.remove(STORAGE_KEY)
}
