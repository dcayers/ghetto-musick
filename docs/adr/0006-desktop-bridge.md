# ADR-0006: Tauri desktop bridge for Serato filesystem access

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §12, §15.2

## Context

FlowGraph's defining feature is interoperating with a DJ's real Serato library: reading crates and tracks, fingerprinting local files, analysing audio, and eventually writing approved cue points. A hosted web application cannot do any of this — the File System Access API is Chromium-only, cannot watch directories, and cannot run library-scale audio analysis.

The product also treats local files as the **source of truth** for DJ metadata (§4.3), so this is not an optional convenience path.

## Decision

Ship a **signed Tauri 2.x desktop bridge** that the user explicitly installs and authorizes. It is a *bridge*, not the application: the web app remains the UI and remains independently deployable.

### Responsibilities

Discover configured Serato roots and crates · parse library/crate metadata read-only · fingerprint local files and send normalized manifests (never audio) · run local audio analysis · stage crate/export artifacts · later, apply approved cue changes with backup and verification.

### Security model

- Enrollment via a **short-lived one-time code** issued by the authenticated web app.
- The device receives a **scoped credential** held in OS secure storage. It is not a user session (ADR-0004) and cannot reach account-management endpoints.
- Commands are **signed, short-lived, idempotent**, and restricted to registered roots with canonicalized paths.
- **Outbound TLS only.** No inbound LAN listener by default — the bridge dials the API, never the reverse.
- Every filesystem action is a previewable command with an audited result.
- Signed auto-update packages with rollback.
- Logs redact usernames, absolute paths, tokens, and track metadata unless diagnostics are explicitly exported.

### Analysis toolchain

- **FFprobe** — media properties and format validation.
- **`music-metadata`** — tag parsing, in-process. Preferred over spawning FFprobe per file: §20.2 requires sandboxing analysis subprocesses with time and resource limits, so every subprocess avoided is one less sandbox to manage across a multi-thousand-file scan.
- **Native aubio or Rust DSP crates** — waveform peaks, loudness, BPM/key, onset/beat/phrase candidates. **Not `essentia.js`**, which remains at `0.1.3` and is far too slow for library-scale batch analysis in WASM.

Analyzer name, version, parameters, confidence, source fingerprint, and timestamp are recorded with every result; results are invalidated when the file fingerprint changes.

### Write safety

Read-only first. Crate export before cue export. Cue writing is beta, opt-in, format-gated, backed up, written to a staged copy, read back, verified, and only then atomically replaced — behind device- and workspace-level flags with a kill switch (§12.3).

## Consequences

**Positive**

- The only architecture that delivers the core feature. There is no web-only path to a DJ's Serato library.
- Keeping the bridge separate from the web app means the UI stays deployable, previewable, and testable without a desktop build.
- Tauri gives signed, auto-updating, small binaries and a Rust process for audio DSP, which is where the WASM path fails.
- Native Rust analysis makes full-library batch processing tractable rather than aspirational.

**Negative / accepted costs**

- A second distribution channel: code signing, notarization, an update server, and an OS support matrix (§31 open decision 2).
- The bridge is a separate release train and may run older versions against a newer API. This is why ADR-0001 chose REST over tRPC.
- Filesystem access on a user's machine is the highest-consequence component in the system. It carries the strictest security controls and the only kill switch.
- Serato formats are proprietary and unversioned. Phase S0 is an explicit **stop gate**: if reliable backup, restore, and read-back verification cannot be demonstrated on fixtures, cue writing does not ship.

## Alternatives considered

**Browser File System Access API** — no install, but Chromium-only, cannot watch directories, cannot run native analysis, and re-prompts for permission in ways that break long scans. Viable only for one-off single-file import; not for a library. Rejected as the primary path.

**Full desktop application (Tauri as the app shell)** — no bridge protocol, no enrollment, simpler security model. Rejected because it forfeits the hosted web app: no browser access, no preview deployments, and a desktop release required for every UI change. The bridge keeps the fast-moving surface on the web and the privileged surface small.

**Electron** — more mature audio and packaging ecosystem. Rejected on binary size, memory footprint, and the absence of a native Rust process for DSP.

**Server-side analysis with audio upload** — no desktop artifact at all. Rejected for MVP: uploading a user's entire library is a rights, bandwidth, privacy, and storage problem, and it still cannot read or write Serato's local database. Retained as an opt-in cross-device option only (§15.3).
