Status: done

# Brand & design system

## Name & tagline

**Content Engine** — *Fuel for your feed.*
Internal content-sourcing tool: watches my sources, filters by my taste, drafts my threads.

## Voice / tone

Clean & editorial: light-first, generous whitespace, serif headings — a magazine's back office. The content under review is the star; the chrome stays quiet. Microcopy is calm and specific ("Draft thread", "Marked as posted"), never jokey.

## Palette

Warm paper neutrals (not pure grey), one crimson accent.

| Token   | Light     | Dark      | Use |
|---------|-----------|-----------|-----|
| paper   | `#FAF8F4` | `#181511` | page background |
| surface | `#FFFFFF` | `#201C17` | cards, tables, inputs |
| ink     | `#211E1A` | `#EDE7DC` | primary text |
| muted   | `#6F6759` | `#A79E8F` | secondary text, labels |
| line    | `#E6E1D6` | `#37312A` | hairlines, borders |
| accent  | `#9E1B32` | `#E86A80` | crimson — masthead, links, primary buttons, focus, destructive/failed |
| good    | `#2E6B4A` | `#6FBF8E` | matched entries, successful runs |
| warn    | `#8F6400` | `#D9A84E` | retries, degraded sources |

**Color usage rule:** crimson does double duty as brand + failure/destructive (magazine-red convention — FT/Economist style); *matched* and *run OK* are green, so the happy moment never collides with the alarming one. Warning amber for retries.

## Typography

- **Display / headings / item titles:** system serif stack — `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif` (no webfonts; tool runs locally).
- **UI / body:** system sans — `-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
- **Data / logs / IDs:** `ui-monospace, "SF Mono", Menlo, Consolas, monospace`.

Scale (4 steps + mono): display 30/1.15 · title 21/1.25 · body 15/1.55 · small 13/1.4 · mono 12.5.

## Spacing / radius / shadow

- Base unit **8px** (4px half-step for chip padding).
- Radius: **6px** controls/inputs, **10px** cards. No pill buttons; chips are pills.
- Elevation: hairline `line` border + soft shadow `0 1px 3px rgb(0 0 0 / 0.06)` — paper on a desk, not floating glass.
- Tables: hairline row rules, `tabular-nums` for timestamps and counts.

## Blend in vs. stand out

No host environment — the dashboard is fully owned, so it carries the brand. Telegram messages are plain text + link (Telegram's chrome wins there).

## Asset checklist

- Favicon only (no store presence): crimson rounded square, white serif "C" — legible at 16px.
- Logo mark = the same monogram at masthead size.
