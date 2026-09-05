# ADR-0010: Serato format scope — read everything, write crates only

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §12.3, §31 open decision 3
- **Supersedes:** the "which Serato formats can be safely read, and which if any written" open question

## Context

ADR-0006 established the Tauri bridge as the only path to a DJ's Serato library, and plan §12.3 made Phase S0 an explicit **stop gate**: cue export does not ship unless reliable backup, restore, and read-back verification can be demonstrated on fixtures.

This ADR answers the prior question — *which formats are safe to touch at all* — from format research rather than from a fixture spike. It scopes what S0 needs to prove and rules out the parts not worth proving.

Serato publishes no format specification. Everything below comes from community reverse-engineering, principally the Mixxx project's format documentation and Holzhaus's `serato-tags` work.

## What the formats actually are

Serato splits its data across **two entirely different locations**, and the distinction drives the whole decision:

### 1. Library and crates — sidecar files, `_Serato_/`

| File | Contents |
|---|---|
| `_Serato_/database V2` | The track library |
| `_Serato_/Subcrates/<name>.crate` | One file per crate |

Both use the same simple TLV envelope, repeated:

```
[4-byte ASCII tag][4-byte big-endian length][payload]
```

Type is encoded in the tag's first character:

| Prefix | Payload |
|---|---|
| `o*` | Nested records (e.g. `otrk` wraps one track entry) |
| `p*` | UTF-16BE text, a filesystem path relative to the drive root (e.g. `ptrk`) |
| `t*` | UTF-16BE text |
| `u*` | Unsigned 32-bit big-endian |
| `s*` | Signed 32-bit big-endian |
| `b*` | Single byte |
| `vrsn` | Format version, UTF-16BE |

Note that **a crate's name lives only in its filename**, not inside the file.

This is a trivial parser — a few dozen lines — and these are *sidecar* files: they describe the library but are not the user's music.

### 2. Cues, beatgrids, and analysis — inside the audio files

Cue points are **not** in the database. They live in the audio files themselves, as ID3v2 GEOB frames on MP3 and AIFF (and as MP4 atoms / VorbisComment in other containers):

| GEOB tag | Contents | Status |
|---|---|---|
| `Serato Markers2` | Cues, loops, colors (base64 inside the frame) | Documented; **some fields still unmapped** |
| `Serato Markers_` | Older cue/marker format | Documented |
| `Serato BeatGrid` | Beat grid | Documented |
| `Serato Autotags` | BPM, gain | Documented |
| `Serato Overview` | Waveform data | Documented |
| `Serato Analysis` | Analysis version | Documented |
| `Serato Offsets_` | Timing offsets (**MP3 only**) | Documented |

**Ogg Vorbis is the outlier.** The reference documentation notes its data format "seems to differ significantly" from other containers and is incompletely mapped.

### Library landscape

| Library | Language | Version | Last update | Verdict |
|---|---|---|---|---|
| `triseratops` | Rust | **0.0.3** | **2023-11-30** | Best Rust reference; ~3 years stale. Read it, don't depend on it |
| `serato-tools` | Python | active | — | Read *and* write; useful for building fixtures |
| `serato-connect` | Node | 1.4.0 | — | Read-only |
| `Holzhaus/serato-tags` | docs | — | — | The canonical format write-up |

The bridge is Rust (Tauri), and the only Rust option is effectively abandoned at `0.0.3`.

## Decision

Scope by **blast radius**, not by difficulty. The two locations above have completely different failure modes, and that is the line to draw.

### Read (Phase S1) — in scope

Parse `database V2`, `Subcrates/*.crate`, and the GEOB tags on **MP3 and AIFF**. Read-only, byte-for-byte non-mutating, verified on fixtures.

**Write our own TLV parser in Rust** rather than depending on `triseratops`. The envelope is simple enough that a hand-written parser is less risk than a 3-year-stale dependency, and vendoring keeps the bridge's supply chain small (§20.2). Use `triseratops` and the Holzhaus docs as reference implementations.

### Write crates (Phase S2) — in scope, constrained

Export a published set as a **new `.crate` file**. Never overwrite an existing crate.

This is safe in a way cue writing is not: a `.crate` file is a sidecar Serato regenerates its view from, it contains no user audio, and the worst outcome is a bad crate the user deletes. Nothing irreplaceable is at risk.

### Write cues (Phase S3) — **deferred, not scheduled**

Cue export mutates the user's **actual music files**. Four facts together make it a bad trade right now:

1. Failure destroys irreplaceable data — a DJ's library is often not re-downloadable, and the cue points represent hours of manual work.
2. Some `Serato Markers2` fields remain unmapped, so a round-trip can silently drop data we never learned to parse.
3. The best Rust reference is at `0.0.3` and three years stale.
4. There is no official write API, so Serato can change the format in any update with no notice.

The plan already gates this behind backup, staged write, read-back verification, and a kill switch (§12.3 S3). Those controls are correct — but they are risk *mitigation*, and the risk is only worth taking once the rest of the product is delivering value. Revisit after Phase 6, and only if the S0 fixture matrix demonstrably round-trips.

Until then, **FlowGraph never writes to an audio file.** That is a hard invariant, not a default, and §21.3's property test ("export can always restore the exact original fixture") should be complemented by a simpler one: no code path opens an audio file for writing.

### Container scope for MVP

| Container | Read | Write cues |
|---|---|---|
| MP3 | ✅ | deferred |
| AIFF | ✅ | deferred |
| FLAC | later | no |
| MP4 / M4A | later | no |
| **Ogg Vorbis** | **excluded** | **no** |

Ogg Vorbis is excluded explicitly, not merely unimplemented — its divergent, incompletely-mapped layout is exactly the profile that produces silent corruption.

### What S0 must now prove

The stop gate narrows to: parse the fixture corpus read-only, verify byte-for-byte that nothing changed, and confirm re-import is idempotent. Cue *write* verification moves out of S0 entirely, since we are not shipping it.

---

## S0 results (2026-08-02) — gate passed

Run against a real Serato DJ Pro library (`~/Music/_Serato_`), not synthetic fixtures. Reproduce with `pnpm --filter @flowgraph/serato run scan`.

**The gate:**

| Criterion | Result |
|---|---|
| Byte-for-byte non-mutation | **PASS** — 45 files checksummed before and after; content, size, and mtime all identical. Independently re-verified against a SHA-256 baseline taken before any code touched the directory |
| Re-import idempotent | **PASS** — parsing twice yields deep-equal results |
| Format parses completely | **PASS** — 0 trailing bytes across the whole `database V2` |

**Format confirmed exactly as documented.** The TLV envelope, the type-by-tag-prefix scheme, and the `vrsn`/`otrk`/`pfil`/`ttyp` tags all matched the Mixxx and Holzhaus write-ups on first read. No surprises, which is itself the useful result — the community documentation is trustworthy.

### Finding that affects product direction: the library was mostly streaming

**Five of six entries had `ttyp: "streaming"`, not a local file type.** Only one was an `mp3`.

A streaming entry has **no local file**. That has consequences well beyond parsing:

- **No audio to analyse.** The Rust DSP path (ADR-0006) has nothing to run against for those tracks.
- **No GEOB tags to read.** Cue points and beatgrids live *inside* audio files; a streaming track has none.
- **The MP3/AIFF container scope covers one track in six here.**

Serato does still store `tbpm` and `tkey` for streaming entries, so the database remains a useful metadata source either way. But plan §4.3's precedence rule — "Serato/local files win for DJ metadata" — quietly assumes local files exist. On a streaming-heavy library there is nothing beneath the top of that hierarchy.

This is one library and should not be over-generalised. It does mean the import path must treat `filePath` as genuinely optional rather than incidentally nullable, and that a "streaming track" is a first-class state, not a degenerate one.

### Correction (2026-09-05): a streaming entry *does* have a `pfil`

The S0 write-up above originally stated that a streaming entry has no `pfil`
record at all. Re-reading the same library while building the S1 import showed
that is wrong. Every entry had one; for a streaming entry it holds a **provider
identity rather than a path**:

```
ttyp: "streaming"   pfil: "56GaYWGPrKJt6e6SGKKiUD.spotify"
```

The consequence is not academic. The first import treated the path as the
evidence of a local file — reasonable given the original finding — resolved
`56GaYWGPrKJt6e6SGKKiUD.spotify` against the filesystem, found nothing, and
reported **five of six tracks as missing files**. A red warning on most of a
library, from one wrong sentence in an ADR.

**`ttyp` is the signal**, with the `pfil` extension as corroboration. The rule
now: an entry has no local audio if Serato typed it `streaming`, *or* its path
slot holds a `<id>.<provider>` reference, *or* there is no path slot at all —
the last being what this ADR originally described, which remains possible and
is still handled.

The identity is worth keeping rather than discarding. A Spotify id is exact,
so re-importing a streaming library matches on it instead of on title and
artist — which would merge a radio edit and an extended mix of one song. It is
stored on `Track` as `sourceProvider` / `sourceExternalId`, the two columns
plan §7.4's `TrackSource` uniqueness constraint actually needs; the full
`TrackSource` model arrives with Spotify (§13), which needs raw metadata and
sync state these columns cannot hold.

`tlen` also moved from the unmapped list into a field. It is the running time,
which the set timeline sums and the inspector shows.

**Method note.** This was found by running the import against a real library
and disbelieving the resulting numbers, not by reading the parser. Synthetic
fixtures agreed with the wrong model perfectly, because they had been written
from it.

### Coverage gaps, stated plainly

- **No crates were present** (`Subcrates/` empty), so crate parsing is exercised only by synthetic fixtures. Phase S2's crate export cannot be considered validated until it has run against a real crate.
- **No GEOB / cue parsing was attempted.** Out of S1 scope, and there was only one local file to try it on.
- **One library, one Serato version, macOS only.** The supported-version matrix (§12.3 S0) remains unbuilt.
- Synthetic fixtures cannot validate format understanding against Serato itself — only real files can. The `scan` script is the validation, and it is run manually.

### Implementation notes

- Parser is **TypeScript**, not the Rust this ADR specifies. S0 is a feasibility spike, and the format knowledge, test corpus, and property tests all port unchanged. The production bridge parser stays Rust per the decision above; nothing here forecloses that.
- **26 tags were seen but not mapped to fields** (`tlen`, `tbit`, `tsiz`, `tadd`, `ulbl`, and a family of `b*` booleans). All are preserved on the entry rather than dropped — the format is undocumented, and discarding a tag we have not learned to read yet would lose user data silently.
- The read-only invariant is enforced **structurally, not behaviourally**: the parser modules import no filesystem API at all, and a test asserts that no module imports any mutating `fs` call. Verified by adding a `writeFileSync` import and confirming the suite fails.

## Consequences

**Positive**

- Removes the highest-consequence failure mode in the product for the entire MVP. No code path can damage a music library.
- Read + crate export delivers most of the user value: the library imports, sets export to Serato, and the DJ's actual workflow closes.
- Hand-written parsers keep the bridge free of an abandoned dependency (§20.2).
- Narrowing S0 to read-only verification makes the stop gate achievable in days rather than weeks.

**Negative / accepted costs**

- Cue export was a differentiating feature and is now indefinitely deferred. Users transfer cues manually.
- We own the parsers, including keeping up with any Serato format change.
- Excluding Ogg Vorbis means a small share of libraries import incompletely. Surface that clearly in the import report rather than failing silently.
- All read parsing remains vulnerable to Serato changing formats — mitigated by treating every parse as fallible and reporting unreadable entries rather than aborting the scan.

## Alternatives considered

**Ship cue export in the MVP with full safety controls** — the plan's original S3 shape, with backup, staged write, read-back, and kill switch. Rejected on the four facts above. The controls are well designed, but they mitigate a risk we do not need to take yet to have a useful product.

**Depend on `triseratops`** — real parsing work already done, in the right language. Rejected: `0.0.3`, unmaintained since 2023, and taking it as a runtime dependency in a filesystem-privileged signed binary is a supply-chain choice we would have to defend. Reference implementation, not dependency.

**Node or Python sidecar for the better-maintained libraries** — `serato-tools` covers more, including writes. Rejected for the runtime bridge: shipping a second language runtime inside a signed desktop binary widens the attack surface and the packaging matrix for a parser we can write ourselves. Useful on the *development* side for generating fixtures.

**Support every container up front** — broader library compatibility. Rejected: MP3 and AIFF cover the overwhelming majority of DJ libraries, and Ogg Vorbis specifically is where the documentation is weakest.
