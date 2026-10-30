// Design-system rules (STYLE_GUIDE.md -> Enforcement). Each flags a class-string
// pattern that breaks one of the two themes or the flat, foreground-relative
// look. design.test.ts runs them over every source file and expects zero.

export interface DesignRule {
  id: string
  pattern: RegExp
  message: string
}

const COLOR_UTILITY = '(?:bg|text|border|fill|stroke|ring|outline|decoration|divide|placeholder|caret|shadow|from|via|to)'

export const DESIGN_RULES: DesignRule[] = [
  {
    id: 'raw-hex',
    pattern: new RegExp(`\\b${COLOR_UTILITY}(?:-[trblxyse])?-\\[#[0-9a-fA-F]{3,8}\\]`, 'g'),
    message: 'Raw hex is wrong in one of the two themes. Use foreground/N, background or a semantic token.',
  },
  {
    id: 'raw-color-fn',
    pattern: /-\[(?:rgba?|hsla?|oklch|color-mix)\(/g,
    message: 'Raw rgba()/hsl() is wrong in one of the two themes. Use a token with an opacity modifier (bg-foreground/10).',
  },
  {
    id: 'raw-palette',
    pattern: new RegExp(
      `\\b${COLOR_UTILITY}(?:-[trblxyse])?-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\\d{2,3}\\b`,
      'g',
    ),
    message: 'Raw Tailwind palette color. Use foreground/N (neutral), destructive (errors) or bell (the one accent).',
  },
  {
    id: 'fixed-color',
    pattern: new RegExp(`\\b${COLOR_UTILITY}-(?:black|white)\\b`, 'g'),
    message: 'black/white stay the same in both themes. Use foreground/N or background.',
  },
  {
    id: 'shadcn-token',
    pattern: new RegExp(
      `\\b${COLOR_UTILITY}-(?:primary|secondary|muted|accent|input|ring|border|card-foreground|popover-foreground)(?:-foreground)?\\b`,
      'g',
    ),
    message: 'Not a token here (shadcn leftover, renders nothing). Use foreground/N, background or emphasis.',
  },
  {
    id: 'focus-ring',
    pattern: /(?<![^\s'"`])(?:[^\s'"`:]+:)*(?:focus|focus-visible|focus-within):(?:ring|outline)(?:-[\w/.[\]]+)?/g,
    message: 'Keyboard focus is one global outline (style.css). A per-component ring doubles it. Drop it.',
  },
  {
    id: 'dark-color-override',
    pattern: /\bdark:(?:[\w-]+(?:-\[[^\]]+\])?:)*(?:bg|text|border|placeholder|fill|stroke|ring|outline|from|via|to)-/g,
    message: 'Colors are theme-relative, so a dark: override means the base class is wrong. Fix the base class.',
  },
  {
    id: 'card-shadow',
    pattern: /(?<![\w-])shadow-(?:xs|sm|md|lg|xl|2xl)\b/g,
    message: 'Flat: no shadows. Only menu-surface (style.css) casts one.',
  },
  {
    id: 'heavy-weight',
    pattern: /\bfont-(?:bold|extrabold|black)\b/g,
    message: 'Nothing heavier than font-semibold (600).',
  },
]

// A line with this comment, or the line after it, is exempt. Say why.
const EXEMPT = 'design-exempt'

// String and template literals in a source file. Crude but deterministic.
const STRING_LITERAL = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g

export function findDesignViolations(source: string): { rule: string; match: string; line: number }[] {
  const lines = source.split('\n')
  const found = []
  for (const literal of source.matchAll(STRING_LITERAL)) {
    const line = source.slice(0, literal.index).split('\n').length - 1
    if (lines[line]!.includes(EXEMPT) || lines[line - 1]?.includes(EXEMPT)) continue
    for (const rule of DESIGN_RULES) {
      for (const m of literal[0].matchAll(rule.pattern)) found.push({ rule: rule.id, match: m[0], line: line + 1 })
    }
  }
  return found
}
