# UI/UX strategy

## Design plan (per the installed `frontend-design` skill)

**Subject:** booking a mehndi artist at home in Hyderabad. **Audience:** brides and their families, women booking for
festivals and parties, mostly on phones. **Primary job:** get from “I like this design” to a paid booking with confidence.

### Colour (fixed by the brand)

| Token | Hex | Use | Share |
|---|---|---|---|
| `ivory` | `#FFFAF8` | page background | ~45% |
| `blush` | `#F8E8EC` | section bands, thumbnails, chips | ~15% |
| `plum` | `#4B1D3F` | hero stage, headings, primary buttons, footer, “Why” band | ~25% |
| `rose` | `#D484A6` | links, underlines, step numbers, eyebrow | ~10% |
| `gold` | `#D4AF7C` | arch hairline, footer column titles, notices | ~5% |

Derived tints (documented, not new colours): `plum-ink #2E1228` (body text on light backgrounds — plum alone is fine for
headings but body copy needs more contrast), `plum-deep #3D1734` (button hover), `rose-deep #A8577B` (small rose text that
passes contrast on ivory), `henna #5B1F0F` (mehndi artwork in illustrations), `line` = plum at 12% (hairlines), plus success
`#2F6B4F` and danger `#A33A3A` for states only.

### Type

- **Cormorant Garamond** 500–700 for headings and the eyebrow (italic) — echoes the logo’s high-contrast serif.
- **Manrope** for UI and body. Sentence case everywhere; no tracked all-caps labels.
- Serif body is avoided on small screens; serif headlines sit at 2.6rem (mobile) → 4.4rem (desktop).

### Layout concept

```
mobile                          desktop
┌───────────────┐               ┌─────────────────────┬──────────────────┐
│ header        │               │ hero copy           │ ╭──────────────╮ │
│ eyebrow       │               │ CTAs                │ │  3D hand      │ │
│ headline      │               │ choose a design     │ │  (sticky,     │ │
│ CTAs          │               │ [chips…]            │ │   arch frame) │ │
│╭─────────────╮│ ← sticky      │ [cards scroller]    │ │               │ │
││  3D hand     ││   while       │ selected design     │ │ palm|back ±   │ │
││ palm|back ±  ││   browsing    │ price · time · Book │ ╰──────────────╯ │
│╰─────────────╯│               └─────────────────────┴──────────────────┘
│ chips scroller│
│ card scroller │
│ details       │
│[bottom bar: name · ₹ · Book]  │
└───────────────┘
```

Left-aligned text, generous margins, 16px gutter on mobile, 1200px max width.

### Principles

1. **The hand is the one bold thing.** It sits in a jharokha-inspired arch (rounded top, gold hairline) on the plum stage —
   the only decorative frame on the site. Everything around it stays quiet.
2. **Hero and studio share one viewer.** One WebGL context, not two; the headline introduces the hand and the studio below
   changes the mehndi on it.
3. **Price honesty.** Every price label says what it covers (“one hand, as shown”). The booking flow shows a server-calculated
   itemised quote, advance vs balance, taxes (or “not applicable”), and the cancellation policy before payment.
4. **No invented trust.** No fake reviews, no fake ratings, no “verified” unless an admin verified the artist, sample content
   is badged and hidden in production.
5. **Motion only answers actions** — design crossfade, camera turns, bottom bar slide; one intro turn of the hand.

### Self-review against generic defaults (what changed)

- Rejected a centered hero with a stat row and gradient — replaced with the arch stage.
- Rejected numbered 01/02/03 markers on non-sequential content — numbers only appear in “How it works”, which is a sequence.
- Rejected identical rounded cards for “Why VAISHORA” — used a plum band with gold left rules.
- Services use a single bordered grid with hairline dividers instead of floating cards.

## Mobile-first details

- Sticky viewer during design browsing; sticky bottom booking bar while the studio is on screen (with safe-area padding).
- Booking flow: progress bar with “Step x of 5” on phones; sticky Back/Continue bar with the running total; collapsible price
  summary; 48px inputs at 16px font (no iOS zoom); `inputMode`/`autoComplete` set for phone, name, address.
- Horizontal scrollers with scroll-snap for categories, designs and dates; time slots in a 3-column grid with crossed-out
  unavailable times.
- Verified no horizontal overflow at 390px on all public pages (`tests/e2e/production_qa.py`). The studio was also fixed for
  an overflow found during testing (grid children need `minmax(0,1fr)`).

## Accessibility

- Skip link, landmarks, one `h1` per page, labelled controls, `role="radiogroup"`/`radio` for design, category, date, time and
  option pickers; `aria-live` on price/design details and slot loading; errors linked with `aria-invalid`/`aria-describedby`
  and focus moved to the first invalid field.
- Visible focus ring (plum, 2px offset), `prefers-reduced-motion` respected, canvas is `aria-hidden` with an accessible
  static illustration label and sr-only usage instructions.
- No browser `alert`/`confirm` dialogs; destructive actions use inline confirmation.

## States

Loading (skeletons, “Checking artist availability…”, “Loading 3D hand…”), empty (no designs match, no artists yet, no slots
for that date with a contact link), error (API messages surfaced in plain language), success (payment received banner,
status-specific next steps on the booking page).
