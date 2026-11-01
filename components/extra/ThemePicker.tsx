import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { applyTheme, getTheme, MAX_STOPS, PRESETS, saveTheme, swatchColor, type Theme, type ThemeStop } from '@/lib/theme'

// The stored theme, applied the moment it changes and saved once the change
// settles, so a drag repaints the page live without a write per pixel.
export function useEditableTheme() {
  const [theme, setTheme] = useState<Theme>()
  const save = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    void getTheme().then(setTheme)
    return () => clearTimeout(save.current)
  }, [])
  function update(patch: Partial<Theme>) {
    if (!theme) return
    const next = { ...theme, ...patch }
    setTheme(next)
    applyTheme(next)
    clearTimeout(save.current)
    save.current = setTimeout(() => void saveTheme(next), 250)
  }
  return { theme, update }
}

const fill = (stops: ThemeStop[]) =>
  stops.length > 1 ? `linear-gradient(120deg, ${stops.map(swatchColor).join(', ')})` : swatchColor(stops[0]!)

const sameStops = (a: ThemeStop[], b: ThemeStop[]) =>
  a.length === b.length && a.every((it, i) => it.hue === b[i]!.hue && it.chroma === b[i]!.chroma)

// Presets, then a field to drag each colour across (hue left to right,
// colourful at the top, grey at the bottom), then how bright the page is.
export function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (patch: Partial<Theme>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            title={preset.name}
            aria-label={preset.name}
            aria-pressed={sameStops(preset.stops, theme.stops)}
            onClick={() => onChange({ stops: preset.stops, brightness: preset.brightness })}
            className={cn(
              'size-7 cursor-pointer rounded-full border-2',
              sameStops(preset.stops, theme.stops) ? 'border-foreground' : 'border-foreground/10',
            )}
            style={{ background: fill(preset.stops) }}
          />
        ))}
      </div>
      <ColorField stops={theme.stops} onChange={(stops) => onChange({ stops })} />
      <div className="flex items-center gap-2">
        {theme.stops.length < MAX_STOPS ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const [first] = theme.stops
              onChange({ stops: [first!, { hue: (first!.hue + 60) % 360, chroma: Math.max(first!.chroma, 0.5) }] })
            }}
          >
            Add a second colour
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onChange({ stops: theme.stops.slice(0, 1) })}>
            Use one colour
          </Button>
        )}
      </div>
      <label className="flex items-center gap-3">
        <span className="text-foreground/60">Brightness</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={theme.brightness}
          onChange={(e) => onChange({ brightness: Number(e.target.value) })}
          className="flex-1 accent-foreground"
        />
      </label>
    </div>
  )
}

// Every hue across, faded to grey downwards: where a handle sits is its colour.
const FIELD_BACKGROUND = [
  'linear-gradient(to bottom, transparent, oklch(0.7 0 0))',
  `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => `oklch(0.7 0.16 ${i * 30})`).join(', ')})`,
].join(', ')

function ColorField({ stops, onChange }: { stops: ThemeStop[]; onChange: (stops: ThemeStop[]) => void }) {
  const field = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)

  function stopAt(e: React.PointerEvent): ThemeStop {
    const rect = field.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    return { hue: Math.round(x * 360) % 360, chroma: Math.round((1 - y) * 100) / 100 }
  }
  function move(index: number, e: React.PointerEvent) {
    onChange(stops.map((it, i) => (i === index ? stopAt(e) : it)))
  }

  return (
    <div
      ref={field}
      className="relative h-28 touch-none rounded-lg border border-foreground/10"
      style={{ background: FIELD_BACKGROUND }}
      onPointerDown={(e) => {
        // A press on the field itself moves the nearest handle there.
        const target = stopAt(e)
        const nearest = stops.reduce(
          (best, it, i) =>
            Math.abs(it.hue - target.hue) + Math.abs(it.chroma - target.chroma) * 360 <
            Math.abs(stops[best]!.hue - target.hue) + Math.abs(stops[best]!.chroma - target.chroma) * 360
              ? i
              : best,
          0,
        )
        dragging.current = nearest
        e.currentTarget.setPointerCapture(e.pointerId)
        move(nearest, e)
      }}
      onPointerMove={(e) => dragging.current !== null && move(dragging.current, e)}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    >
      {stops.map((stop, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground shadow"
          style={{
            left: `${(stop.hue / 360) * 100}%`,
            top: `${(1 - stop.chroma) * 100}%`,
            background: swatchColor(stop),
          }}
        />
      ))}
    </div>
  )
}
