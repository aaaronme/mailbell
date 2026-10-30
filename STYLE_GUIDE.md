# Mailbell style guide

The popup is a small, dense, reading-first surface. The design follows from that: it is quiet, flat and monochrome, with one accent, and it works in light and dark from the same classes.

## Principles

- **Monochrome and foreground-relative.** Almost every color is the foreground at some opacity: `text-foreground/60`, `border-foreground/10`, `bg-foreground/5`. Because the foreground flips with the theme, the same class works in both, and nothing needs a `dark:` variant.
- **One accent.** `bell` (teal) marks the one thing worth spotting at a glance: a one-time code. It is not used for links, buttons or decoration.
- **Flat.** No shadows on cards and no boxes inside boxes. Sections are separated by a `border-foreground/10` hairline, and rows run edge to edge. The only floating surface is a menu or toast (`menu-surface`).
- **Square.** Rows, fields, avatars and chips have square corners. Only buttons are rounded: `rounded-md`, or `rounded-full` for ghost icon buttons. The `Button` primitive owns that radius, so don't pass one.
- **Quiet type.** Hierarchy comes from weight and opacity, not size.

## Tokens

The tokens are defined in `entrypoints/popup/style.css`. Light is the default, and dark comes from `prefers-color-scheme`.

| Token | Use |
| --- | --- |
| `background` | The page. |
| `foreground` | Text, and with `/N` every neutral: borders, fills, hovers, secondary text. |
| `card`, `popover` | The fill of a menu or toast. |
| `emphasis`, `emphasis-foreground` | The primary button and selected state: solid ink in light, translucent white in dark. |
| `destructive`, `destructive-foreground` | Errors and destructive actions. |
| `bell` | The accent, for one-time codes only. |

Common opacities:

| Opacity | Use |
| --- | --- |
| `/5` | Hover and focus fill. |
| `/10` | Hairline borders and dividers, the menu highlight, the secondary button fill. |
| `/15` | Field border at rest. |
| `/30` | Field border on hover. |
| `/40` | Tertiary text: email addresses, timestamps, counts. |
| `/60` | Secondary text: labels, section headings, hints. |
| `/80` | Body text that should sit back slightly, such as subjects. |

Never use raw hex or `rgba()`, Tailwind palette colors (`gray-500`, `blue-600`), `black`/`white`, or the old shadcn names (`muted-foreground`, `bg-primary`, `bg-accent`, `border-border`). Each of these is wrong in one of the two themes or renders nothing. The one exception is HTML email inside the shadow root, which keeps its own colors.

## Type

- **Geist** (`font-sans`) for everything. Body text is 14px (`text-sm`, set on `body`) and dense text is 12px (`text-xs`).
- **Source Serif 4** (`font-display`) for titles only: the page title in the header and the empty state.
- Weights are 400 and 500 (`font-medium`). `font-semibold` is for the one-time code only. Nothing heavier.
- No negative letter-spacing. Use `tabular-nums` for times and counts.

## Primitives

| Component | What it is |
| --- | --- |
| `PageHeader` | The sticky 48px top bar. `back` adds the back button, `title` sits on the left and `children` are right-aligned actions. Every page uses it. |
| `PageTitle` | The `font-display` heading inside it. |
| `Button` | Three variants: `default` (emphasis fill, for the one main action), `secondary` (a `/10` fill) and `ghost` (no fill, `/70` text). Three sizes: `default`, `sm` and `icon`. |
| `Input` | A square field with a hairline border that darkens on hover and focus. |
| `DropdownMenu` | `menu-surface` with flush `px-3 py-2` rows and a `/10` highlight. |
| `Avatar` | A square `/10` tile with the sender's initial. |

## Behavior

- **Hover:** `hover:bg-foreground/5` on rows, and a stronger border on fields.
- **Keyboard focus:** a single global indicator, a 1px `foreground/60` outline drawn inside the element's own edge (`style.css`). Don't add `focus:ring-*` or `focus-visible:outline-*` to a component. When the whole row is the target, mark the row `focus-row` and its control `focus-row-target`.
- **Selected or primary:** `bg-emphasis text-emphasis-foreground`.
- **Motion:** color transitions only (`transition-colors`). The spin animations are for the refresh icon.

## Do and don't

| Do | Don't |
| --- | --- |
| `text-foreground/60` | `text-muted-foreground`, `text-gray-500` |
| `border-b border-foreground/10` between sections | A card with `rounded shadow-sm` |
| `hover:bg-foreground/5` | `hover:bg-accent` |
| `<Button variant="ghost" size="icon">` | `<Button className="h-8 w-8 rounded-full">` |
| One `default` button per view | A row of filled buttons |
| `text-bell` on a one-time code | Teal links, icons or badges |

## Adding UI

1. Start from `PageHeader` and the primitives in `components/ui`.
2. Separate sections with hairlines, and keep rows flush.
3. Pick colors from the opacity table above.
4. Check the result in both light and dark.
5. Run `pnpm test`. The design test fails on any rule below.

## Enforcement

`lib/design/rules.ts` defines the rules, and `lib/design/design.test.ts` runs them over every `.tsx` file under `entrypoints/` and `components/`. The test expects zero violations.

| Rule | Flags |
| --- | --- |
| `raw-hex` | `bg-[#…]` |
| `raw-color-fn` | `-[rgba(…)]`, `-[hsl(…)]`, `-[oklch(…)]` |
| `raw-palette` | `text-gray-400`, `bg-blue-500` |
| `fixed-color` | `bg-black`, `text-white` |
| `shadcn-token` | `text-muted-foreground`, `bg-primary`, `border-border` |
| `focus-ring` | `focus-visible:ring-2` |
| `dark-color-override` | `dark:bg-…` |
| `card-shadow` | `shadow-sm` and larger |
| `heavy-weight` | `font-bold` and heavier |

If something genuinely needs to break a rule, put `// design-exempt: <why>` on the line, or on the line before it.
