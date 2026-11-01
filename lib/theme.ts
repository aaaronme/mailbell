import { useEffect, useState, useSyncExternalStore } from 'react'

// The look: one or two colours (two make a gradient), how bright the page is,
// and light or dark. Only the surfaces take the colour; text, hairlines and
// fills stay foreground/N on top, so every theme reads like the default one.

export type ThemeMode = 'system' | 'light' | 'dark'

// A colour by hue (degrees) and how colourful it is (0 grey to 1 full).
export interface ThemeStop {
  hue: number
  chroma: number
}

export interface Theme {
  mode: ThemeMode
  stops: ThemeStop[]
  // 0 the deepest page this mode allows, 1 the lightest.
  brightness: number
}

export const MAX_STOPS = 2

export const PRESETS: { name: string; stops: ThemeStop[]; brightness: number }[] = [
  { name: 'Navy', stops: [{ hue: 235, chroma: 0.6 }], brightness: 0.2 },
  { name: 'Graphite', stops: [{ hue: 0, chroma: 0 }], brightness: 0.12 },
  { name: 'Ocean', stops: [{ hue: 220, chroma: 0.7 }], brightness: 0.45 },
  { name: 'Forest', stops: [{ hue: 155, chroma: 0.55 }], brightness: 0.3 },
  { name: 'Plum', stops: [{ hue: 320, chroma: 0.55 }], brightness: 0.3 },
  { name: 'Ember', stops: [{ hue: 35, chroma: 0.6 }], brightness: 0.3 },
  { name: 'Lagoon', stops: [{ hue: 250, chroma: 0.7 }, { hue: 185, chroma: 0.7 }], brightness: 0.35 },
  { name: 'Dusk', stops: [{ hue: 285, chroma: 0.7 }, { hue: 15, chroma: 0.6 }], brightness: 0.35 },
  { name: 'Aurora', stops: [{ hue: 165, chroma: 0.6 }, { hue: 265, chroma: 0.7 }], brightness: 0.35 },
]

export const DEFAULT_THEME: Theme = { mode: 'system', stops: PRESETS[0]!.stops, brightness: PRESETS[0]!.brightness }

// The page lightness and colourfulness each mode allows, in oklch. Dark tops
// out where white text still reads easily; light stays a tint of white.
const DARK = { lightness: [0.12, 0.36], chroma: 0.07, raise: 0.035 }
const LIGHT = { lightness: [0.93, 0.99], chroma: 0.035, raise: 0.02 }

const oklch = (l: number, c: number, h: number) => `oklch(${l.toFixed(3)} ${c.toFixed(4)} ${Math.round(h)})`

function surface(stop: ThemeStop, brightness: number, dark: boolean, raise = 0) {
  const range = dark ? DARK : LIGHT
  const [low, high] = range.lightness as [number, number]
  const l = Math.min(1, low + (high - low) * brightness + raise)
  return oklch(l, stop.chroma * range.chroma, stop.hue)
}

// A swatch's colour: the stop itself, bright enough to see.
export const swatchColor = (stop: ThemeStop) => oklch(0.7, stop.chroma * 0.16, stop.hue)

// The custom properties a theme sets on <html>; style.css only holds the
// default for the moment before they are set.
export function themeVars(theme: Theme, dark: boolean): Record<string, string> {
  const [first = DEFAULT_THEME.stops[0]!, second] = theme.stops
  const background = surface(first, theme.brightness, dark)
  const raised = surface(first, theme.brightness, dark, (dark ? DARK : LIGHT).raise)
  return {
    '--background': background,
    '--card': raised,
    '--popover': raised,
    '--page': second
      ? `linear-gradient(120deg, ${background}, ${surface(second, theme.brightness, dark)})`
      : background,
    '--foreground': dark ? '#ffffff' : '#0c0c0d',
    // Solid white would glare in dark: a translucent white fill.
    '--emphasis': dark ? 'rgb(255 255 255 / 0.2)' : 'var(--foreground)',
    '--emphasis-foreground': dark ? '#ffffff' : 'var(--background)',
    '--bell': dark ? '#7cd0e8' : '#087f8c',
  }
}

const STORAGE_KEY = 'theme'
// The applied variables, kept where the next page can read them before its
// first paint; storage.local answers only after it.
const PAINT_KEY = 'mailbell-theme-paint'

export async function getTheme(): Promise<Theme> {
  const { [STORAGE_KEY]: stored } = await browser.storage.local.get<Record<string, Partial<Theme>>>(STORAGE_KEY)
  return { ...DEFAULT_THEME, ...stored }
}

export async function saveTheme(theme: Theme) {
  await browser.storage.local.set({ [STORAGE_KEY]: theme })
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

export const isDark = (mode: ThemeMode) => (mode === 'system' ? window.matchMedia(DARK_QUERY).matches : mode === 'dark')

export function applyTheme(theme: Theme) {
  const dark = isDark(theme.mode)
  const vars = themeVars(theme, dark)
  paint(vars, dark)
  try {
    localStorage.setItem(PAINT_KEY, JSON.stringify({ vars, dark }))
  } catch {
    // Only the first paint of the next page is lost.
  }
}

function paint(vars: Record<string, string>, dark: boolean) {
  const root = document.documentElement
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.dataset.mode = dark ? 'dark' : 'light'
  notify()
}

// Before React: the last theme this browser painted, so the page doesn't
// flash the default first.
export function paintCachedTheme() {
  try {
    const cached = JSON.parse(localStorage.getItem(PAINT_KEY) ?? 'null') as {
      vars: Record<string, string>
      dark: boolean
    } | null
    if (cached) paint(cached.vars, cached.dark)
  } catch {
    // The stored theme paints a moment later instead.
  }
}

// Keeps <html> on the stored theme: on load, when another view changes it, and
// when the system switches light and dark under 'system'.
export function useThemeSync() {
  const [theme, setTheme] = useState<Theme>()
  useEffect(() => {
    let live = true
    void getTheme().then((it) => live && setTheme(it))
    const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && STORAGE_KEY in changes) void getTheme().then((it) => live && setTheme(it))
    }
    browser.storage.onChanged.addListener(onChange)
    return () => {
      live = false
      browser.storage.onChanged.removeListener(onChange)
    }
  }, [])
  useEffect(() => {
    if (!theme) return
    applyTheme(theme)
    if (theme.mode !== 'system') return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme(theme)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}

const listeners = new Set<() => void>()
function notify() {
  listeners.forEach((it) => it())
}

// Whether the page is dark right now, theme and system together: for what CSS
// variables can't reach, such as the mail's own filter.
export function useIsDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      const mq = window.matchMedia(DARK_QUERY)
      mq.addEventListener('change', onChange)
      return () => {
        listeners.delete(onChange)
        mq.removeEventListener('change', onChange)
      }
    },
    () => {
      const mode = document.documentElement.dataset.mode
      return mode ? mode === 'dark' : window.matchMedia(DARK_QUERY).matches
    },
  )
}
