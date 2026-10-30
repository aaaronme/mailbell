import { describe, expect, it } from 'vitest'
import { DESIGN_RULES, findDesignViolations } from './rules'

// Every UI source, raw. Tests run in a browser, so no fs: Vite inlines them.
const sources = import.meta.glob(['/entrypoints/**/*.tsx', '/components/**/*.tsx', '!**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('design rules', () => {
  it('sees the UI sources', () => {
    expect(Object.keys(sources)).toContain('/components/ui/button.tsx')
  })

  it('no source breaks a rule (STYLE_GUIDE.md)', () => {
    const messages = Object.fromEntries(DESIGN_RULES.map((it) => [it.id, it.message]))
    const violations = Object.entries(sources).flatMap(([file, source]) =>
      findDesignViolations(source).map((v) => `${file}:${v.line} [${v.rule}] \`${v.match}\`: ${messages[v.rule]}`),
    )
    expect(violations).toEqual([])
  })

  it.each([
    ['raw-hex', 'bg-[#0c0c0d]'],
    ['raw-color-fn', 'border-[rgba(0,0,0,.1)]'],
    ['raw-palette', 'text-gray-400'],
    ['fixed-color', 'bg-black/40'],
    ['shadcn-token', 'text-muted-foreground'],
    ['focus-ring', 'focus-visible:ring-2'],
    ['dark-color-override', 'dark:bg-foreground/30'],
    ['card-shadow', 'shadow-sm'],
    ['heavy-weight', 'font-bold'],
  ])('%s flags %s', (rule, cls) => {
    expect(findDesignViolations(`'${cls}'`).map((it) => it.rule)).toEqual([rule])
  })

  it('leaves tokens and exempt lines alone', () => {
    expect(findDesignViolations(`'bg-foreground/10 text-bell border-foreground/15 menu-surface'`)).toEqual([])
    expect(findDesignViolations(`// design-exempt: fixed art\n'bg-[#fff]'`)).toEqual([])
  })
})
