---
name: FlowGraph
description: A night-chart interface for planning DJ sets as a graph — dark, dense, and legible under booth conditions.
colors:
  canvas: "#08080c"
  surface: "#0e0e14"
  surface-raised: "#14141c"
  surface-card: "#191922"
  surface-hover: "#20202b"
  surface-overlay: "#1c1c27"
  surface-selected: "#1e1830"
  border: "#21212c"
  border-strong: "#2e2e3c"
  grid: "#17171f"
  ink: "#f2f2f7"
  ink-muted: "#9d9dae"
  ink-subtle: "#8a8a9c"
  accent: "#7c5cff"
  accent-hover: "#8f73ff"
  accent-muted: "#2a2145"
  accent-soft: "#16122a"
  accent-text: "#9b86ff"
  accent-strong: "#6a49f2"
  bpm: "#6ea8fe"
  key: "#f472b6"
  energy-1: "#22b8f0"
  energy-2: "#4ade80"
  energy-3: "#a3e635"
  energy-4: "#f5a524"
  energy-5: "#fb7185"
  energy: "#a78bfa"
  waveform: "#8b72e8"
  waveform-active: "#b7a7ff"
  waveform-muted: "#57506f"
  tx-blend: "#22d3ee"
  tx-effect: "#c084fc"
  tx-filter: "#9ae86b"
  tx-energy: "#fb923c"
  tx-cut: "#e879f9"
  tx-default: "#94a3b8"
  ok: "#34d399"
  warn: "#fbbf24"
  danger: "#f87171"
  info: "#38bdf8"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.4"
    letterSpacing: "normal"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: "1.25"
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1.4"
    letterSpacing: "normal"
  num:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1.2"
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "1.3"
    letterSpacing: "normal"
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 400
    lineHeight: "1.3"
    letterSpacing: "normal"
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: "1.2"
    letterSpacing: "0.025em"
rounded:
  control: "6px"
  card: "8px"
  panel: "10px"
  full: "9999px"
spacing:
  hair: "1px"
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
  button-outline:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    size: "28px"
  icon-button-active:
    backgroundColor: "{colors.accent-muted}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.control}"
    size: "28px"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  pill:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.section}"
    rounded: "{rounded.full}"
    padding: "1px 6px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  track-node:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "8px 10px"
    width: "240px"
    height: "104px"
  track-node-selected:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    width: "240px"
    height: "104px"
---

# Design System: FlowGraph

## Overview

**Creative North Star: "The Night Chart"**

FlowGraph is a navigational chart read in low light. The graph is terrain, transitions are routes, and a set is the course plotted through them. Charts do not decorate — they encode. Every hue in this system is a legend entry with exactly one meaning, and every mark that carries information carries it at least twice, so that meaning survives a dark room, a greyscale print, and a glance stolen mid-mix.

This is an instrument, not an app. The chrome recedes and the data dominates. Nothing animates for its own sake, nothing eases in on load, and no surface asks for attention it has not earned. The interface builds trust by being predictable rather than charming: the same track reads identically in the library, on the canvas, in the timeline, and in the inspector, because a DJ recognises material by its shape and must never have to re-learn it per panel.

Density is the point, not a compromise. Body text runs at 12px, labels at 11px, section headers at 10px uppercase, and numerics are monospaced and tab-aligned because they are read down a column and compared. What holds this together is strict rhythm — a three-step radius scale, a five-step tonal surface ramp, hairline borders — rather than generous whitespace. The system earns its density by never letting two things mean the same thing in two different ways.

**Key Characteristics:**

- Five stepped near-black surfaces carry all depth; shadow appears only when something physically lifts off the plane.
- Violet is selection and nothing else. It never signals importance, quality, or category.
- Functional hues form a legend: BPM, key, energy, and each transition family own one hue apiece.
- Every meaning is double-encoded — count, shape, dash pattern, or label alongside the hue.
- Outlined over filled: a 1px border on near-black is the default surface treatment.
- Controls are quiet at rest and firm up on hover; the interface is calm until reached for.

## Colors

A near-black ground with one violet voice and a functional legend of signal hues borrowed from the data itself.

### Primary

- **Signal Violet** (`#7c5cff`): Selection, and only selection. It marks the node you picked, the path you committed to, the set a track belongs to, and the brand mark — nothing else. Its scarcity is what makes a selected node findable across a thousand-node canvas.
- **Violet Lift** (`#8f73ff`): A lighter violet retained for accent washes. **Not** a button hover: white on it is 3.46:1, so a filled button hovering here got *less* legible.
- **Violet Text** (`#9b86ff`): The accent as text. `#7c5cff` is 3.45:1 on `accent-muted` and under 4.5 on every panel surface.
- **Violet Fill** (`#6a49f2`): The accent under white text, which `#7c5cff` cannot carry at 4.35:1.
- **Violet Shadow** (`#2a2145`): A near-black violet used as the *fill* behind an active icon button or view toggle. At roughly 1.3:1 against the panel it is deliberately too weak to carry state alone, which is why it always ships with a `ring-accent/70` outline.
- **Violet Ash** (`#16122a`): The quietest violet tint, for the faintest accent washes.

### Secondary

The metadata legend. These are not accents — they are the colors of specific data fields, and using them for anything else breaks the legend.

- **Beacon Blue** (`#6ea8fe`): BPM, everywhere it appears. Monospaced and tab-aligned.
- **Key Rose** (`#f472b6`): Camelot key, everywhere it appears.
- **Energy Ramp** (`#22b8f0` → `#4ade80` → `#a3e635` → `#f5a524` → `#fb7185`): Energy 1–5, cool at the bottom and hot at the top. A scale, never a single hue — rendering every waveform one color throws away the signal a DJ actually scans for.
- **Waveform Violet** (`#8b72e8`), **Waveform Lit** (`#b7a7ff`), **Waveform Dim** (`#57506f`): The three waveform states — at rest, on a selected track, and where no local file exists so the peaks would be invented.

### Tertiary

The transition legend. Five families, five hues, each paired with a dash pattern and a written label.

- **Blend Cyan** (`#22d3ee`): Long blends and blends. Solid stroke.
- **Effect Orchid** (`#c084fc`): Echo out, reverb tail, acapella over. Dash `2 4`.
- **Filter Green** (`#9ae86b`): Filter sweeps. Dash `6 3`. Moved off `#a3e635`, which was also energy-3.
- **Energy Orange** (`#fb923c`): Loop builds and genre flips. Dash `10 4`. Moved off `#fbbf24`, which was also energy-4 *and* warn.
- **Cut Fuchsia** (`#e879f9`): Backspins and cuts. Dash `1 5`. Moved off `#fb7185`, which was also energy-5.
- **Unmapped Slate** (`#94a3b8`): The fallback for a technique with no spec. Lifted from `#64748b` (4.20:1), because this is the colour an unlabelled technique renders in and the label must stay readable.

### Neutral

- **Chart Black** (`#08080c`): The canvas. The deepest ground, and the reason the interface can sit beside a mixer without blinding anyone.
- **Panel Black** (`#0e0e14`): Panel bodies and the top bar.
- **Raised Black** (`#14141c`): Inputs, control groups, and the waveform bed.
- **Card Black** (`#191922`): Track nodes and cards at rest.
- **Hover Black** (`#20202b`): The lift on hover.
- **Overlay Black** (`#1c1c27`): Popovers, menus, and tooltips.
- **Selected Violet-Black** (`#1e1830`): A selected row or node. A violet *tint* on the surface, never a saturated fill — a selected row must still read as a row.
- **Hairline** (`#21212c`) and **Hairline Strong** (`#2e2e3c`): The 1px borders that do most of the structural work, and their hover/emphasis step.
- **Grid** (`#17171f`): The canvas dot grid.
- **Ink** (`#f2f2f7`), **Ink Muted** (`#9d9dae`), **Ink Subtle** (`#8a8a9c`): Primary text, secondary text, and labels or disabled values. Ink Subtle was `#6e6e80` and measured 3.23:1 on `surface-hover` — below AA at every size it is used.

### Status

- **Ok** (`#34d399`), **Warn** (`#fbbf24`), **Danger** (`#f87171`), **Info** (`#38bdf8`): Save state, validation, missing files, and AI provenance. Always paired with a word or a glyph.

### Named Rules

**The One Voice Rule.** Violet means selection. It does not mean important, primary, recommended, new, or on-brand. If a surface needs emphasis and is not selected, it gets a border weight or an ink step — not the accent.

**The Legend Rule.** Every functional hue is an entry in a legend with exactly one referent. BPM is blue; key is rose; energy is the five-step ramp; each transition family owns its hue. Reusing a legend hue for decoration corrupts the legend for every screen at once.

No two legend entries share a value. Four once did — `#fbbf24` meant energy-4, tx-energy *and* warn — so a node showing four amber energy dots beside an amber dashed edge had one colour standing for two things at once. Hue *windows* still overlap between legends, and that is not a defect: an energy ramp running cool to hot must cross every categorical hue there is. What holds the legends apart is that they never share a rendering role — energy is dots and a waveform tint, technique is a stroke with a dash and a word, status is a pill carrying a word.

**The Text-Fill Rule.** `accent` is a fill, a border and a ring; `accent-text` is the accent as *text*; `accent-strong` is the accent under *white* text. Three tokens because one hex cannot clear 4.5:1 in all three jobs — the brand violet is 3.45:1 as a label on its own muted fill, and white on it is 4.35:1. Same voice, three legible forms.

**The Ring-Over-Fill Rule.** `accent-muted` is ~1.3:1 against the panel — too weak to carry state. Any active or selected control that fills with it must also carry a `ring-accent/70` outline, because an outline is either present or absent and survives greyscale where the fill does not.

## Typography

**Display Font:** none — this system has no display type.
**Body Font:** the platform UI stack, declared (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`). On the macOS target this is SF Pro Text.
**Numeric Font:** the platform monospace stack, declared (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`) — SF Mono on macOS.

> **Decided, not defaulted.** Both stacks are declared in `theme.css`'s `@theme` block. They previously were not, which meant Tailwind's preflight owned the product's typeface — a devDependency holding a design decision, and one whose value changed between v3 and v4. No webfont is loaded and none should be: SF is optically sized, ships real tabular figures, and gets the system's small-size tracking applied automatically, and a webfont would trade that for FOUT and bytes in a tool whose Principle 5 is "degrade deliberately."

**Character:** Neutral on purpose. The personality comes from scale, weight, and alignment rather than from letterforms: everything is small, deliberately leaded, and set at 400–600 weight, and every number is monospaced and tab-aligned so columns compare cleanly. `font-synthesis-weight: none` prevents faux-bold. `-webkit-font-smoothing: antialiased` was deliberately **removed** — greyscale antialiasing thins apparent stem weight, which is mild on light grounds and pronounced for light-on-dark, and this product is 10–13px light-on-dark read across a dark room.

### Hierarchy

Every role is a token (`--text-*`), not a literal. That is what makes the density mode possible and what keeps a role identical across the four surfaces that must agree on it.

- **Headline** (600, 20px/1.4): The FlowGraph wordmark, the sign-in heading, and the up-next track in booth view. The only type above 13px.
- **Title** (500, 13px/1.25): Panel headers, track titles, the booth's route label. The largest type inside a working surface.
- **Body** (400, 12px/1.4): Controls, menu items, library rows, form inputs. The default.
- **Numeric** (400, 12px mono, `tabular-nums`): BPM, key, durations, positions, counts. Always monospaced, always tab-aligned — including the em dash that stands in for an unknown value, because a proportional dash breaks the column it sits in.
- **Label** (400, 11px/1.3): Artist names, metadata fields, inspector values, secondary rows.
- **Section** (500, 10px, `0.025em`, uppercase): Collapsible headers and field labels. The only uppercase in the system.
- **Meta** (400, 10px/1.3): Units, durations, footnotes, counter badges.
- **Node Title / Node Label** (13px / 11px): The canvas's own two roles, held separate because node geometry is fixed at 240×104 and the drop-under-cursor arithmetic depends on it. **These never scale with density.**

### Named Rules

**The Tabular Rule.** Any number a user compares against another number is monospaced and `tabular-nums`. BPM, key, duration, and set position are all read down a column; proportional digits make that column lie.

**The Ceiling Rule.** No working surface uses type above 13px. The 18–20px headline exists only for the wordmark, the sign-in screen, and booth view — the places that are not the desk instrument.

**The Token Rule.** No literal font size. Every size is a `--text-*` role. A literal is invisible to the density mode and drifts from the role it was meant to match, which is how one track title came to render seven different ways.

### Density

The type scale has two settings, selected by `data-density` on the root element.

- **Default** — the desk. The scale above.
- **`booth`** — one step up the same scale (13→15, 12→14, 11→13, 10→11/12) with the ink ramp opened up (`ink-muted` → `#b6b6c6`, `ink-subtle` → `#9096a3`). No new roles and no new ratios: contrast is the other half of distance legibility, so size alone would not carry.

Booth density is a switch on one interface, not a second interface. PRODUCT.md records whether the booth deserves a dedicated view as an open decision, and this must not pre-empt it. `--text-node-*` and `--text-headline` are deliberately excluded.

## Layout

The shell **is** the viewport. `body` sets `overflow: hidden` and `overscroll-behavior: none`; the document never scrolls, and every panel owns its own overflow. Nothing outside a panel ever moves.

Three layout regimes, selected by `matchMedia` rather than CSS alone, because they differ in *behavior* and each slot must mount exactly once (three mounted graph canvases would be three React Flow instances):

- **Wide (≥ 80rem / 1280px):** Three columns plus a timeline row — library, graph, inspector — laid out on a CSS grid with `gap-px`, so the hairline gaps *are* the dividers. Each side panel has a draggable resizer and collapses to a restore rail rather than to zero width, because a rail in a zero-width column is a rail nobody can press.
- **Medium (48–80rem / 768–1280px):** Graph dominant, with rails on both sides. Library and inspector open as scrimmed overlay drawers, dismissable by Escape or by the scrim (a real `Button`, so it is reachable without a pointer). Drawer state is deliberately local, not the persisted `panels[key].visible` — peeking at a panel on a tablet must not rewrite the desktop layout.
- **Compact (< 48rem / 768px):** One surface at a time, as tabs: Library, Graph, Inspector, Set. All panels stay force-mounted and are hidden rather than unmounted, so switching tabs never discards the graph viewport or a scrolled library.

**Spacing rhythm.** Tight and consistent: 1px hairlines, 2px micro-gaps, 4px and 6px control gaps, 8px panel padding, 12px for panel headers and roomier blocks. Panel headers are a fixed 40px; the top bar is 56px. Track nodes are fixed at 240×104px so the canvas can place a dropped track under the cursor and reason about overlap without measuring.

### Named Rules

**The Viewport Rule.** The document never scrolls. If content overflows, the owning panel scrolls — never the page, never the body.

**The Fixed-Node Rule.** Graph nodes have fixed dimensions. A node whose height depends on how many badges it happens to carry makes edge anchors drift as data changes.

## Elevation & Depth

**Shadow is physics, not decoration.** Depth comes from the five-step tonal ramp — Chart Black → Panel Black → Raised Black → Card Black → Hover Black — and a shadow appears only as evidence that an element is genuinely being held above the plane right now. If nothing is lifting it, it casts nothing. Panels, cards, inputs, pills, and the React Flow controls and minimap all sit flat at rest with `box-shadow: none`.

### Shadow Vocabulary

- **Dragging** (`shadow-2xl shadow-black/60`, with `opacity-90`): A node under the cursor. The strongest lift in the system, because it is the only moment an element is literally in the air.
- **Simplified dragging** (`shadow-lg shadow-black/60`): The same event at low zoom, where the chip is smaller.
- **Selected node** (`shadow-lg shadow-black/40`): A selected node sits slightly proud of its neighbours.
- **Multi-selected node** (`shadow-md shadow-black/30`): A group member — lifted, but less than the primary.
- **Popover / menu** (`shadow-2xl`): Menus and select popovers, which float over everything.
- **Tooltip** (`shadow-lg`): The lightest floating surface.

### Named Rules

**The Grounded Rule.** Anything at rest casts nothing. A shadow on a static panel is a claim that it is floating, and it isn't.

## Shapes

A tight three-step radius scale and hairline borders. Corners are gently rounded, never soft: 6px on controls (`--radius-control`), 8px on cards and track nodes (`--radius-card`), 10px on panels (`--radius-panel`). The only fully round shapes are semantic — energy dots, source dots, slider thumbs, and pills, where the pill silhouette itself says "this is a small labelled status."

Borders do the structural work. Almost every element is a 1px `Hairline` over a near-black fill rather than a filled block, so the canvas stays dark and the ink stays legible. Border *weight* and *color* carry state where other systems would change fill: `Hairline` at rest, `Hairline Strong` on hover, `Signal Violet` on selection.

Dashed borders mean provisional. An AI-suggested node is `border-dashed border-accent/50` — dashed reads as unconfirmed at any zoom and in any palette, and the Sparkles pill is its second cue.

Scrollbars are chrome, not content: 10px, thumb in `Hairline Strong` with a 3px transparent inset, brightening to `Ink Subtle` on hover.

### Named Rules

**The Ten-Pixel Ceiling.** Nothing rounds past 10px. Oversized panel rounding is what makes an instrument look like a consumer app.

## Components

### Buttons

- **Shape:** 6px radius (`--radius-control`). Icon buttons are a 28px square grid cell.
- **Primary:** Signal Violet fill with white text, 6px radius, 12px × 8px padding, 12px medium. Hovers to Violet Lift. Rare by design — it is the only filled accent surface in the product, so it should mark a single committed action per screen.

  > **Recorded drift.** Three button sites currently use it: the sign-in submit (`sign-in.tsx:101`), the empty-state actions "Create a graph" / "Try again" (`main.tsx:78`), and the top-bar **Play** control (`top-nav.tsx:241`). The first two are defensible — each is the one committed action on an otherwise empty screen. Play is not: it is the loudest element in the workspace, it is not a selection, and it violates The One Voice Rule. Treat the first two as the pattern and Play as a fault to correct, not as precedent.

  Non-button accent fills are a separate, legitimate case: the slider's filled track, a selected mini-toggle, and the resizer's active state (`ui.tsx:276`, `ui.tsx:314`, `set-timeline.tsx:612`, `workspace-layout.tsx:550`). These are all selection or direct manipulation, so they are consistent with The One Voice Rule.
- **Outline (default):** Raised Black fill, 1px Hairline border, Ink text, 8px × 4px padding, 12px. Hovers to Hairline Strong. This is the workhorse.
- **Icon button:** 28px square, transparent at rest with Ink Muted glyph. Hover fills Hover Black and lifts the glyph to Ink. **Active** fills Violet Shadow with an Accent glyph *and* a `ring-accent/70` outline — the fill alone is too weak to survive greyscale.
- **Danger:** hover only — `bg-danger/15` with Danger text. Never a resting state.
- **Disabled:** `opacity-40`, never a color change.
- **Focus:** a 2px Signal Violet outline at 2px offset, driven by React Aria's `data-focus-visible` so it is keyboard-only. Pointer users get no ring; keyboard users always do.

### Chips / Pills

- **Style:** Fully round, 1px border, **transparent fill**, 6px × 1px padding, 10px medium. Tone sets border and text color together at 40–50% alpha: neutral, ok, warn, danger, accent, info.
- **State:** Pills are read-only status marks, not controls. The `#N` set-position pill and the AI pill are the two that carry meaning rather than status.

### Cards / Containers

- **Panel:** Panel Black fill, 1px Hairline border, 10px radius, with a fixed 40px header (13px medium title, bottom hairline). A `flush` variant drops both border and radius for surfaces that butt directly against the grid.
- **Track node:** Card Black, 1px Hairline, 8px radius, fixed 240×104px, 10px × 8px padding. Hover raises to Hover Black with a Hairline Strong border. Selection is a *triple* signal — Accent border, Selected Violet-Black fill, and a `ring-accent/60` — because set membership already paints a violet bar, and the two states must not be confusable.
- **Shadow strategy:** flat at rest; see Elevation & Depth.

### Inputs / Fields

- **Style:** Raised Black fill, 1px Hairline border, 6px radius, 8px × 4px padding, 12px. Placeholder in Ink Subtle.
- **Focus:** the border shifts to Signal Violet with `outline: none` on the element itself — the border *is* the focus indicator here, replacing the global ring.
- **Numeric fields:** `tabular-nums`, with an em dash placeholder rather than `0`, because absence must not read as a value.

### Navigation

- **Top bar:** 56px, Panel Black, bottom hairline. The wordmark sits left at 20px semibold with a violet `Waypoints` glyph and a right border separator. Left and right regions both take `flex-1 basis-0` so the centre view switcher lands on the true centre of the bar rather than drifting as the set name grows.
- **View switcher:** a segmented `ToggleButtonGroup` in a Raised Black well with a 1px border and 2px inset. Every option shows its label, so the label cannot be what distinguishes the active one — the active option gets Violet Shadow fill, Accent text, semibold, *and* a ring.
- **Save state:** a Pill carrying a **word** — "Saved", "Saving…", "Unsaved" — inside a `role="status" aria-live="polite"` region. Never a bare colored dot.

### Transition Edge (signature component)

The system's most distinctive object, and the clearest expression of the North Star. A bezier stroke drawn at one of three weights:

- **Selected** (4px, opacity 1, 11px arrowhead) with a halo rather than a color change — the technique hue must stay readable while selected.
- **In the active set** (3px, opacity 1, 10px arrowhead).
- **Alternative** (1.5px, opacity 0.45, 8px arrowhead). Thinned and quietened but **never hidden**: the alternatives are the point of the graph, and a route you cannot see is a route you cannot take.

Technique is triple-encoded — hue names the family, the dash pattern separates families that sit near each other on the color wheel, and the label spells it out. Any one alone is a guess. The accessible name carries the same information plus endpoints, bar count, AI provenance, and — critically — the words "alternative route", because the quieter stroke is otherwise the only thing on screen that says so.

### Booth View (signature component)

The set at reading distance. Entered from the timeline's header, left with `Escape` — deliberately not a fourth item in the planning view switcher, so it cannot be reached by accident mid-planning.

- **One card, one question.** Now playing, the transition into the next track, and the next track. The library, graph, inspector and filters are all gone.
- **The transition is the centrepiece**, not a detail behind a click: technique and bar count at title size, warnings in `warn` beneath. This is the one surface where Principle 2 — the transition is the unit of value — is literally true, because the technique *is* the instruction.
- **Sets `data-density="booth"`** on the root for its lifetime and removes it on exit, so the desk is never affected.
- **Two actions.** "Played it" advances. Alternates appear only when the current track has more than one authored route out, and taking one re-labels the card "Up next — branch" with the violet selection treatment — because a branch *is* a chosen path, which is exactly what violet means.
- **Position is session-local.** There is no `played` column in the schema, and the view does not pretend otherwise.

### Status Toast

The one visible channel for things that happened. Bottom-right of the shell, over the canvas so it is readable from any panel without moving layout.

- **Style:** Overlay Black, 1px hairline, 8px radius, `shadow-lg` — it genuinely floats, so it genuinely casts.
- **Severity carries a word.** A failure is prefixed with a literal "Failed" in Danger and takes a `border-danger/50`; the hue only reinforces the word, never replaces it.
- **Dismissal encodes intent.** An informational message clears itself after 6s. A failure never does — a failure that fades is one the DJ can miss. Neither does a message offering an undo, because an offer needs time to be taken.
- **It never speaks twice.** The visible node is `aria-hidden`; the always-mounted `sr-only` live region beside it is what announces. Two nodes carrying the same sentence would say it twice.

### Track Metadata Primitives (signature component)

Artwork, BPM, key, energy, waveform, and source are defined once and reused in the library, on nodes, in the timeline, and in the inspector. That single definition is what keeps a track recognisable as the same track wherever it appears.

- **EnergyDots:** the dot *count* is the signal, the hue reinforces it. Announced as "Energy 3 of 5".
- **SourceDot:** shape carries meaning — a filled disc is local, a ring is streaming, a slashed ring is missing. A null source renders **no mark**, because "no file record" is not one of the three states and the honest mark for it is nothing.
- **Waveform:** SVG bars, muted where no local file exists so the peaks are visibly not real.
- **Artwork:** five deterministic geometric treatments keyed off the track id, so a track's tile is stable across every surface and reload.

## Do's and Don'ts

### Do:

- **Do** reserve Signal Violet (`#7c5cff`) for selection and set membership. Everything else earns emphasis through border weight or an ink step.
- **Do** pair every functional hue with a second cue — a count, a shape, a dash pattern, or a written label.
- **Do** add a `ring-accent/70` outline whenever `accent-muted` fills an active control. The fill is ~1.3:1 and cannot carry state alone.
- **Do** keep radii on the three-step scale: 6px controls, 8px cards, 10px panels.
- **Do** monospace and `tabular-nums` every number a user compares against another number.
- **Do** render absence honestly — an em dash, an unfilled control, or no mark at all. Never a zero standing in for unknown.
- **Do** let panels own their overflow. The document never scrolls.
- **Do** keep alternative routes visible at reduced weight rather than hiding them.

### Don't:

- **Don't** nest shells. A panel inside a panel inside a rounded rectangle is what made the previous build read as boxed; use the `flush` variant where surfaces meet the grid.
- **Don't** round past 10px. No 16px cards, no pill-shaped containers.
- **Don't** encode any meaning by color alone — not transition type, not energy, not save state, not file availability.
- **Don't** add decorative motion. Transitions are ~120ms and touch color, opacity, and transform only. Nothing eases in on load, and nothing animates to attract attention.
- **Don't** put a shadow on anything at rest. Shadow is reserved for elements genuinely lifted off the plane.
- **Don't** introduce type above 13px inside a working surface.
- **Don't** reuse a legend hue (BPM blue, key rose, an energy step, a technique family) for decoration — it corrupts the legend everywhere at once.
- **Don't** invent a saturated fill for a selected row. Selection is a violet *tint*; a selected row must still read as a row.
