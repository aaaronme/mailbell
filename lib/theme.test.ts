import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { applyTheme, DEFAULT_THEME, getTheme, paintCachedTheme, PRESETS, saveTheme, themeVars, type Theme } from './theme'

vi.stubGlobal('browser', fakeBrowser)

const lightness = (color: string) => Number(/oklch\(([\d.]+)/.exec(color)![1])

describe('themeVars', () => {
  it('keeps dark pages dark enough for white text and light ones near white', () => {
    for (const preset of PRESETS) {
      for (const brightness of [0, 1]) {
        const theme: Theme = { mode: 'system', stops: preset.stops, brightness }
        expect(lightness(themeVars(theme, true)['--background']!)).toBeLessThanOrEqual(0.36)
        expect(lightness(themeVars(theme, false)['--background']!)).toBeGreaterThanOrEqual(0.93)
      }
    }
  })

  it('raises cards above the page and brightens with brightness', () => {
    const vars = (brightness: number) => themeVars({ ...DEFAULT_THEME, brightness }, true)
    expect(lightness(vars(0.5)['--card']!)).toBeGreaterThan(lightness(vars(0.5)['--background']!))
    expect(lightness(vars(1)['--background']!)).toBeGreaterThan(lightness(vars(0)['--background']!))
  })

  it('makes the page a gradient only with a second colour', () => {
    const one = themeVars({ ...DEFAULT_THEME, stops: [{ hue: 200, chroma: 0.5 }] }, true)
    expect(one['--page']).toBe(one['--background'])
    const two = themeVars({ ...DEFAULT_THEME, stops: [{ hue: 200, chroma: 0.5 }, { hue: 20, chroma: 0.5 }] }, true)
    expect(two['--page']).toMatch(/^linear-gradient\(120deg, oklch\(.* 200\), oklch\(.* 20\)\)$/)
  })

  it('greys out a colour with no chroma', () => {
    expect(themeVars({ ...DEFAULT_THEME, stops: [{ hue: 90, chroma: 0 }] }, false)['--background']).toMatch(
      / 0\.0000 /,
    )
  })
})

describe('applying', () => {
  beforeEach(() => fakeBrowser.reset())
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.mode
    localStorage.clear()
  })

  it('reads the default until a theme is saved', async () => {
    expect(await getTheme()).toEqual(DEFAULT_THEME)
    await saveTheme({ ...DEFAULT_THEME, mode: 'light' })
    expect((await getTheme()).mode).toBe('light')
  })

  it('overrides the system mode, and paints the same before the next load', () => {
    applyTheme({ ...DEFAULT_THEME, mode: 'light' })
    const root = document.documentElement
    expect(root.dataset.mode).toBe('light')
    expect(root.style.colorScheme).toBe('light')
    const background = root.style.getPropertyValue('--background')
    expect(lightness(background)).toBeGreaterThan(0.9)

    root.removeAttribute('style')
    delete root.dataset.mode
    paintCachedTheme()
    expect(root.style.getPropertyValue('--background')).toBe(background)
    expect(root.dataset.mode).toBe('light')
  })
})
