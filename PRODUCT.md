# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — the author, a working DJ.** Expert in the domain: reads Camelot keys,
BPM, and energy at a glance, and needs no explanation of what a transition or a
crate is. Builds and performs real sets. Knows the tool because he built it.

**Deferred, not designed away — other DJs.** Plan §3.2 names open-format DJs
needing crowd-response branches, house/techno DJs planning harmonic and energy
arcs, wedding/event DJs needing dependable fallback paths, and producer/DJs
planning stem overlays and mashups. Design decisions must stay learnable for
these users: real terminology, honest empty states, and no affordance that only
works because the author has the model in his head. Onboarding, tutorials, and
self-explanatory scaffolding are **out of scope for now** and revisited when a
second user arrives (matching decision 13, which defers Windows on the same
test).

## Product Purpose

FlowGraph plans DJ sets as a graph instead of a list. Tracks are nodes,
transitions are directed edges carrying the knowledge of how the mix is done,
and a set is a versioned path through that graph.

It exists because a playlist forces one sequence and throws away every other
valid next track. Planning collapses to a line before the DJ reaches the booth,
and the reasoning behind each mix — the cue, the bar count, the technique, why
it works — lives nowhere but memory.

Success means non-linear planning is faster than working with playlists alone,
multiple valid next-track choices survive to performance, and transition
knowledge becomes reusable rather than re-derived. The output is practical: a
Serato crate and a performance cue sheet the DJ can actually use at a gig.

## Positioning

Competitors organize *tracks*. FlowGraph organizes *transitions* — the edge is a
first-class object with a technique, a recipe, cue and marker bindings, and a
deterministic score. A playlist tool cannot truthfully copy this without
adopting the graph model, because the claim is structural, not a feature.

The second structural claim: **Serato and the local files are the source of
truth, and FlowGraph earns write access rather than assuming it.** Import is
read-only and idempotent; the Serato package cannot write (enforced by a test
asserting no filesystem write import exists). Crate export precedes cue export;
cue writing is deferred indefinitely (ADR-0010). Every destructive operation is
two-phase — preview and diff, then explicit approval, then backup, write,
read-back verification, and audit. Tools that write to a DJ's library without
this ceremony are a different, riskier product.

## Operating Context

FlowGraph is used across four distinct scenes, all confirmed. They pull in
different directions, and that tension is a real design constraint rather than
a contradiction to resolve away:

1. **Planning, at a desk.** Hours before the gig. Full attention, mouse and
   keyboard, one large display. Density and depth win. This is where the graph
   is built.
2. **In the booth, while playing.** Glanced at between mixes, in the dark,
   beside Serato. Legibility at distance, large targets, and zero-ambiguity
   state are hard requirements here — not preferences.
3. **Prep on the move.** Laptop on a couch or a plane, building the library and
   tagging transitions. Comfortable but unfocused; interactions must be
   forgiving and recoverable.
4. **Review after the gig.** Marking what worked, adjusting scores. Reading and
   annotation rather than construction.

**Undecided:** whether the booth scene is served by the same interface as the
planning scene or by a dedicated mode/view. Recorded as an open product
decision — future work must not assume either answer.

Surrounding tools and materials: Serato DJ (the performance application and
metadata source of truth), the local `_Serato_` database V2, crates, and GEOB
tags on MP3/AIFF files; Spotify as discovery/bootstrap catalog metadata only;
macOS; local audio files; exported crates and printable cue sheets.

## Capabilities and Constraints

**In scope for MVP.** Single-user workspaces with authenticated sessions ·
Spotify connection, playlist browsing, metadata import · Serato bridge proof of
concept (library/crate scan, local-file matching) · track library with filters ·
infinite graph canvas with persisted node positions · directed transition edges
with typed recipes · linear sets built from graph paths, versioned as snapshots ·
internal cues and markers · deterministic transition scoring and set validation ·
AI-generated set preview requiring explicit confirmation before persistence · job
status, retry, and audit trail.

**Explicitly out of scope for MVP.** Audio playback or download of Spotify
content · live deck control or replacing Serato during performance · automatic
writing to original audio files · stems generation at scale · collaborative
editing, public sharing, marketplace, billing, mobile-native apps · other DJ
applications.

**Durable product rules** (plan §4 — these constrain interface decisions
directly):

- The graph is the planning model; a set references graph tracks and
  transitions rather than duplicating canonical metadata.
- Sets are versioned snapshots. A later track edit must never silently alter
  the historical plan used at a gig.
- Serato and local files win for DJ metadata unless the user overrides them.
- Spotify is external catalog identity only — permitted metadata and links,
  never downloadable audio, stems, or writable cues.
- User edits beat automation. Every derived field records provenance and
  confidence; manual values are never overwritten without confirmation.
- AI proposes; deterministic code validates. The model never writes files or
  directly commits a generated set.
- Destructive operations are two-phase: preview/diff → explicit approval →
  backup, write, read-back verification, audit.
- Offline degradation is deliberate. The graph and saved sets stay usable when
  Spotify, AI, or the desktop bridge is unavailable.

**Field precedence** — every resolved field surfaces its winning value plus
source, source timestamp, confidence, and optional original value:

`manual override > verified Serato/local analysis > imported Serato metadata >
local analysis suggestion > Spotify catalog metadata > AI suggestion`

**Terminology** (use these words; do not invent synonyms): track, node,
transition, edge, recipe, technique, set, path, branch, crate, hot cue, marker,
beatgrid, Camelot key, BPM, energy, workspace, graph, snapshot, bridge.

**Technical and delivery constraints.** macOS only; Windows deferred until a
second user needs it (decision 13) · local development deployment only for now;
Vercel intended for the web app later (decision 18) · desktop bridge (Tauri)
required for Serato filesystem access in any hosted deployment; not yet built,
so the API currently reads the library directly as the user who started it ·
Serato format scope is read database V2, crates, and GEOB tags on MP3/AIFF;
write new `.crate` files only; cue writing deferred indefinitely; Ogg Vorbis
excluded (ADR-0010) · duplicate graph nodes are not allowed in v1 · AI provider
is a configurable port defaulting to `claude-opus-5` (ADR-0009) · solo build
(decision 11), which sets the realistic ceiling on scope per release · MIT
licensed; personal use, with analyzer licensing (GPL/AGPL) recorded as a
constraint against any future distribution (decision 15).

**Explicitly undecided.** Production build and deploy spike for Rikta · track
fingerprint algorithm · whether the booth scene gets a dedicated mode.

## Brand Commitments

**Name: FlowGraph.** Binding. It appears in the README, the plan, the app title,
the package namespace (`@flowgraph/*`), and every design reference. The
repository directory is named `ghetto-musick` — that is the superseded prototype
(plan header: "to be rebuilt from scratch"), not a product name, and it must not
surface in the interface.

No logo, wordmark, typeface, or icon asset is committed to the repository. The
mark appearing in `docs/design/references/` is direction material, not an
approved asset.

Voice and personality are not established. Interface copy in the current build
is plain and functional; nothing about it has been confirmed as a commitment.

## Evidence on Hand

**Real material that exists:**

- `docs/design/references/` — four interface direction references, described by
  their own README as source material that is **not shipped as runtime
  application assets**: `graph-workspace.png`, `set-timeline.png`,
  `serato-sync-center.png`, `ai-set-builder.png`. They depict capability beyond
  what is built; treat them as intent, not as screenshots of the product.
- `docs/IMPLEMENTATION_PLAN.md` — 1,291-line product and architecture baseline
  with a closed decision log.
- `docs/adr/` — ten accepted architecture decision records.
- `openapi.json` — the API contract of record, generated from controllers and
  verified by CI.
- A shipped web application at `apps/web` covering sign-in, library, graph
  canvas, set timeline, inspector, and Serato import.
- Findings from a real Serato library scan, recorded in ADR-0010.

**Absences future work must not fabricate:** no users other than the author, no
testimonials, no case studies, no press, no pricing, no benchmarks, no
partnership or integration endorsement from Serato or Spotify, no logo file, no
licensed typeface, no production deployment.

## Product Principles

1. **Preserve optionality until the moment of choice.** The product's reason to
   exist is that a plan holds several valid next tracks. Any decision that
   collapses the graph back into a line — in the model, the interface, or the
   export — attacks the premise.
2. **The transition is the unit of value.** Track metadata is table stakes and
   Serato already has it. What FlowGraph uniquely holds is *how the mix is
   done*, so edges deserve the depth, the affordance, and the screen space that
   list-based tools give to tracks.
3. **Earn every write to the user's library.** Read-only until proven, two-phase
   with backup and verification when writing, and reversible after. A DJ's
   library is irreplaceable working material; a corrupted crate before a gig is
   an unrecoverable failure, not a bug report.
4. **Provenance is visible, not buried.** Every value carries where it came from
   and how confident it is. The DJ must be able to tell an analyzed BPM from a
   Serato-verified one from a guess at a glance, because the field precedence
   only helps if it is legible.
5. **Degrade deliberately.** Spotify, the AI provider, and the desktop bridge
   are all optional dependencies. The graph and saved sets remain usable without
   them, and the interface states plainly what is unavailable rather than
   failing silently or hiding the feature.

## Accessibility & Inclusion

Plan §9.9 sets these as product requirements, not aspirations:

- Full keyboard workflows for creation, selection, connection, deletion, and
  reordering — the graph and set timeline are drag-heavy, so keyboard parity is
  a build constraint, not a retrofit. (React Aria Components was chosen
  specifically because its drag-and-drop ships keyboard and screen-reader
  affordances.)
- **Never encode transition type or energy by color alone.** Every edge also
  carries a technique label and a dash pattern.
- Screen-reader descriptions for selected nodes, selected edges, and set
  ordering.
- Respect reduced motion; expose zoom controls rather than relying on gesture.
- Minimum target sizes and clear focus states.
- Undo/redo for graph and set edits; destructive actions confirm when the target
  is referenced elsewhere.

**Environmental requirement from the booth scene:** the interface is read in a
dark room, at arm's length or further, under divided attention, with a mix
running. Contrast, target size, and state unambiguity in that setting are
accessibility requirements here — not only a preference for legibility.
