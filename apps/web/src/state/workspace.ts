import { create } from "zustand";
import {
  ACTIVE_SET,
  NODES,
  TRANSITIONS,
  TRACKS,
  activeSetTransitionIds,
  type WorkspaceGraphNode,
  type WorkspaceSet,
  type WorkspaceTrack,
  type WorkspaceTransition,
} from "../lib/workspace-data.js";
import {
  adaptGraph,
  adaptNode,
  adaptSetItem,
  mergeTracks,
  type AdaptedGraph,
  type AdaptedSet,
} from "../lib/adapt.js";
import {
  addSetItem as addSetItemRequest,
  removeSetItem as removeSetItemRequest,
  reorderSetItem as reorderSetItemRequest,
} from "../lib/set-api.js";
import {
  GraphConflictError,
  addNode as addNodeRequest,
  deleteTransition as deleteTransitionRequest,
  getGraph,
  saveLayout,
  type NodePosition,
} from "../lib/graph-api.js";

/**
 * The workspace store.
 *
 * One mutually-exclusive subject, read by four surfaces. §13 requires the library, graph,
 * inspector, and timeline to agree at all times, and the only way to
 * guarantee that is for none of them to own the answer — before this, the
 * canvas held selection and passed a copy up through props, which meant the
 * timeline and the library each had to be told separately and could drift.
 *
 * Panel geometry lives here too so it can be persisted in one write.
 */

/* ------------------------------------------------------------- selection -- */

export type PanelKey = "library" | "inspector" | "timeline";

export interface PanelState {
  readonly visible: boolean;
  /** Width for library/inspector, height for the timeline. */
  readonly size: number;
}

/** §2 — sensible minimums and maximums for the resizable boundaries. */
export const PANEL_LIMITS: Readonly<Record<PanelKey, { min: number; max: number; initial: number }>> =
  {
    library: { min: 240, max: 360, initial: 264 },
    inspector: { min: 320, max: 460, initial: 354 },
    timeline: { min: 180, max: 380, initial: 250 },
  };

export type OverlayMetric = "energy" | "bpm" | "key";
export type ViewMode = "graph" | "timeline" | "list";
export type SaveState = "saved" | "saving" | "unsaved";

export interface LibraryFilters {
  readonly query: string;
  readonly collection: string;
  readonly genre: string | null;
  readonly key: string | null;
  readonly source: string | null;
  readonly minBpm: number | null;
  readonly maxBpm: number | null;
  readonly minEnergy: number | null;
}

export const EMPTY_FILTERS: LibraryFilters = {
  query: "",
  collection: "all",
  genre: null,
  key: null,
  source: null,
  minBpm: null,
  maxBpm: null,
  minEnergy: null,
};

/**
 * Where the workspace's data came from.
 *
 * `demo` is the static snapshot: every mutation stays in memory, which is what
 * it is for. `live` is the API, and the same mutations are writes. The two are
 * never mixed — a workspace is one or the other for the life of the page.
 */
export type DataSource = "demo" | "live";

export interface LiveGraphPayload {
  readonly graph: AdaptedGraph;
  /** The library page. Merged behind the graph's own inline tracks. */
  readonly tracks: readonly WorkspaceTrack[];
  /**
   * The set being planned, or null when the workspace has none.
   *
   * Null is a real state rather than a loading one: a workspace can hold a
   * graph and no running order, and the timeline says so.
   */
  readonly set: AdaptedSet | null;
}

/**
 * The set a live workspace shows before one exists.
 *
 * Named rather than inlined because "no set" is rendered in three places and
 * they must agree that it has no id — an empty set with a plausible id would
 * accept items that then had nowhere to go.
 */
export const EMPTY_SET: WorkspaceSet = {
  id: "",
  name: "No set",
  items: [],
  targetBpm: null,
  targetKey: null,
};

interface WorkspaceState {
  /* Data */
  source: DataSource;
  /** The graph being edited, or null in demo mode. */
  graphId: string | null;
  /** Optimistic-concurrency token for layout writes — plan §10.1. */
  graphVersion: number;
  /** The set being edited, or null in demo mode and before one exists. */
  setId: string | null;
  tracks: readonly WorkspaceTrack[];
  nodes: readonly WorkspaceGraphNode[];
  transitions: readonly WorkspaceTransition[];
  set: WorkspaceSet;

  /* Selection */
  selectedTrackId: string | null;
  selectedTransitionId: string | null;
  /** Multi-select on the canvas; the primary track stays in `selectedTrackId`. */
  multiSelectedTrackIds: readonly string[];

  /* View */
  view: ViewMode;
  overlayMetric: OverlayMetric;
  saveState: SaveState;
  filters: LibraryFilters;
  panels: Readonly<Record<PanelKey, PanelState>>;
  /** Sections the inspector has open, by section id — §9 preserves this. */
  openSections: Readonly<Record<string, boolean>>;
  status: string | null;
  /**
   * Bumped on every announce, including a repeat of the same message.
   *
   * A live region only speaks when its content *changes*, so pressing the same
   * inert control twice was silent — the second `set` wrote an equal string,
   * zustand bailed on the selector, and the text node never mutated. The
   * consumer keys on this so a repeat still produces a fresh node.
   */
  statusId: number;

  /* Actions */
  /** Replaces the demo snapshot with a live graph and library page. */
  hydrateLive: (payload: LiveGraphPayload) => void;
  selectTrack: (trackId: string | null) => void;
  selectTransition: (transitionId: string | null) => void;
  setMultiSelection: (trackIds: readonly string[]) => void;
  clearSelection: () => void;
  setView: (view: ViewMode) => void;
  setOverlayMetric: (metric: OverlayMetric) => void;
  setFilters: (patch: Partial<LibraryFilters>) => void;
  resetFilters: () => void;
  togglePanel: (panel: PanelKey) => void;
  setPanelSize: (panel: PanelKey, size: number) => void;
  toggleSection: (id: string, open?: boolean) => void;
  moveNode: (nodeId: string, x: number, y: number) => void;
  reorderSet: (from: number, to: number) => void;
  addTrackToSet: (trackId: string, position?: number) => void;
  removeSetItem: (itemId: string) => void;
  addTrackToGraph: (trackId: string, x: number, y: number) => void;
  removeTransition: (transitionId: string) => void;
  updateTransition: (transitionId: string, patch: Partial<WorkspaceTransition>) => void;
  announce: (message: string | null) => void;
}

/* ------------------------------------------------------------ persistence -- */

const STORAGE_KEY = "flowgraph.workspace.v4";

interface Persisted {
  panels?: Record<string, PanelState>;
  openSections?: Record<string, boolean>;
  overlayMetric?: OverlayMetric;
}

function clampSize(panel: PanelKey, size: number): number {
  const { min, max } = PANEL_LIMITS[panel];
  return Math.max(min, Math.min(max, Math.round(size)));
}

const DEFAULT_PANELS: Record<PanelKey, PanelState> = {
  library: { visible: true, size: PANEL_LIMITS.library.initial },
  inspector: { visible: true, size: PANEL_LIMITS.inspector.initial },
  timeline: { visible: true, size: PANEL_LIMITS.timeline.initial },
};

/**
 * Reads persisted layout.
 *
 * Every field is validated rather than trusted: `localStorage` is user-writable
 * and survives across deploys, so a stale or hand-edited entry must not be able
 * to render the workspace with a 4px library or a panel key that no longer
 * exists.
 */
function loadPersisted(): {
  panels: Record<PanelKey, PanelState>;
  openSections: Record<string, boolean>;
  overlayMetric: OverlayMetric;
} {
  const fallback = {
    panels: DEFAULT_PANELS,
    openSections: {} as Record<string, boolean>,
    overlayMetric: "energy" as OverlayMetric,
  };

  if (typeof localStorage === "undefined") return fallback;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Persisted;

    const panels = { ...DEFAULT_PANELS };
    for (const key of Object.keys(DEFAULT_PANELS) as PanelKey[]) {
      const stored = parsed.panels?.[key];
      if (!stored) continue;
      panels[key] = {
        visible: typeof stored.visible === "boolean" ? stored.visible : true,
        size:
          typeof stored.size === "number" && Number.isFinite(stored.size)
            ? clampSize(key, stored.size)
            : PANEL_LIMITS[key].initial,
      };
    }

    const metric = parsed.overlayMetric;
    return {
      panels,
      openSections:
        parsed.openSections && typeof parsed.openSections === "object"
          ? parsed.openSections
          : {},
      overlayMetric:
        metric === "energy" || metric === "bpm" || metric === "key" ? metric : "energy",
    };
  } catch {
    // A corrupt entry is not worth surfacing — the defaults are correct and
    // the next write repairs it.
    return fallback;
  }
}

function persist(state: WorkspaceState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        panels: state.panels,
        openSections: state.openSections,
        overlayMetric: state.overlayMetric,
      } satisfies Persisted),
    );
  } catch {
    // Private browsing and quota exhaustion both throw here. Layout
    // preferences are not worth breaking the app over.
  }
}

/* ------------------------------------------------------- server writes -- */

/**
 * Layout persistence.
 *
 * A drag produces a position change per frame and a settling change on
 * release; the canvas already filters to the settling one, but dragging four
 * nodes in quick succession still produces four writes against a version token
 * that each write increments. Batching them into one debounced request is what
 * the bounded `positions` array in `updateLayoutSchema` is for (§6.3, §9.8).
 *
 * The queue lives at module scope rather than in the store because it is
 * transport state, not workspace state: nothing renders it, and putting it in
 * the store would make every queued position a re-render.
 */
const LAYOUT_DEBOUNCE_MS = 600;

const pendingPositions = new Map<string, NodePosition>();
let layoutTimer: ReturnType<typeof setTimeout> | null = null;
let layoutInFlight = false;

/** Optimistic ids for nodes the server has not acknowledged yet. */
const TEMP_NODE_PREFIX = "pending-";
const isTempId = (id: string) => id.startsWith(TEMP_NODE_PREFIX);

function scheduleLayoutFlush(): void {
  if (layoutTimer !== null) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    layoutTimer = null;
    void flushLayout();
  }, LAYOUT_DEBOUNCE_MS);
}

async function flushLayout(): Promise<void> {
  // Serialised deliberately. Two concurrent PATCHes would carry the same
  // `expectedVersion`, and the second would 409 against a version its own
  // sibling had just bumped — a self-inflicted conflict.
  if (layoutInFlight) {
    scheduleLayoutFlush();
    return;
  }

  const state = useWorkspace.getState();
  const graphId = state.graphId;
  if (state.source !== "live" || graphId === null || pendingPositions.size === 0) return;

  const batch = [...pendingPositions.values()];
  pendingPositions.clear();
  layoutInFlight = true;
  useWorkspace.setState({ saveState: "saving" });

  try {
    const version = await saveLayout(graphId, state.graphVersion, batch);
    useWorkspace.setState((current) => ({
      graphVersion: version,
      // Another move may have been queued while this request was open; saying
      // "saved" then would describe the request rather than the workspace.
      saveState: pendingPositions.size > 0 ? "unsaved" : current.saveState === "saving" ? "saved" : current.saveState,
    }));
  } catch (error) {
    if (error instanceof GraphConflictError) {
      // The version moved under us, so these positions were computed against a
      // graph that no longer exists. Reloading is the recovery the plan asks
      // for; replaying them would be the clobber it forbids.
      await reloadGraph(graphId, "The graph changed in another window — reloaded.");
    } else {
      // Keep the positions so the next flush retries them rather than losing
      // the drag silently.
      for (const position of batch) {
        if (!pendingPositions.has(position.id)) pendingPositions.set(position.id, position);
      }
      useWorkspace.setState({ saveState: "unsaved" });
      useWorkspace
        .getState()
        .announce(error instanceof Error ? error.message : "Could not save the layout.");
    }
  } finally {
    layoutInFlight = false;
    if (pendingPositions.size > 0) scheduleLayoutFlush();
  }
}

async function reloadGraph(graphId: string, message: string): Promise<void> {
  try {
    const detail = adaptGraph(await getGraph(graphId));
    pendingPositions.clear();
    useWorkspace.setState((current) => ({
      graphId: detail.graphId,
      graphVersion: detail.graphVersion,
      nodes: detail.nodes,
      transitions: detail.transitions,
      tracks: mergeTracks(current.tracks, detail.nodeTracks),
      saveState: "saved",
    }));
    useWorkspace.getState().announce(message);
  } catch (error) {
    useWorkspace.setState({ saveState: "unsaved" });
    useWorkspace
      .getState()
      .announce(error instanceof Error ? error.message : "Could not reload the graph.");
  }
}

/**
 * Said once per session, not once per edit.
 *
 * Transition attributes — technique, bar length, notes — have no PATCH
 * endpoint yet (§8.3 defines create and delete only), so those edits live in
 * memory. The store still applies them, because refusing the edit would be a
 * worse answer than an honest one, but the workspace has to say so rather than
 * showing an indicator that can never reach "saved".
 */
let warnedAboutTransitionEdits = false;

/* ------------------------------------------------------------------ store -- */

const initial = loadPersisted();

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  source: "demo",
  graphId: null,
  graphVersion: 0,
  setId: null,
  tracks: TRACKS,
  nodes: NODES,
  transitions: TRANSITIONS,
  set: ACTIVE_SET,

  // §4: the workspace opens on a track, never on an empty inspector.
  selectedTrackId: "trk-innerbloom",
  selectedTransitionId: null,
  multiSelectedTrackIds: [],

  view: "graph",
  overlayMetric: initial.overlayMetric,
  saveState: "saved",
  filters: EMPTY_FILTERS,
  panels: initial.panels,
  openSections: initial.openSections,
  status: null,
  statusId: 0,

  hydrateLive: ({ graph, tracks, set: liveSet }) => {
    pendingPositions.clear();
    set({
      source: "live",
      graphId: graph.graphId,
      graphVersion: graph.graphVersion,
      setId: liveSet?.set.id ?? null,
      nodes: graph.nodes,
      transitions: graph.transitions,
      // Inline tracks first: a node or item whose track is absent renders as
      // nothing, so neither surface may depend on the library page arriving.
      tracks: mergeTracks(
        mergeTracks(graph.nodeTracks, liveSet?.itemTracks ?? []),
        tracks,
      ),
      set: liveSet?.set ?? EMPTY_SET,
      selectedTrackId: graph.nodes[0]?.trackId ?? null,
      selectedTransitionId: null,
      multiSelectedTrackIds: [],
      saveState: "saved",
    });
  },

  selectTrack: (trackId) =>
    set({
      selectedTrackId: trackId,
      selectedTransitionId: null,
      multiSelectedTrackIds: [],
    }),

  selectTransition: (transitionId) =>
    set({
      selectedTrackId: null,
      selectedTransitionId: transitionId,
      multiSelectedTrackIds: [],
    }),

  setMultiSelection: (trackIds) =>
    set({
      selectedTrackId: trackIds[0] ?? null,
      selectedTransitionId: null,
      multiSelectedTrackIds: [...trackIds],
    }),

  clearSelection: () =>
    set({ selectedTrackId: null, selectedTransitionId: null, multiSelectedTrackIds: [] }),

  setView: (view) => set({ view }),

  setOverlayMetric: (overlayMetric) => {
    set({ overlayMetric });
    persist(get());
  },

  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),

  resetFilters: () => set({ filters: EMPTY_FILTERS }),

  togglePanel: (panel) => {
    set((state) => ({
      panels: {
        ...state.panels,
        [panel]: { ...state.panels[panel], visible: !state.panels[panel].visible },
      },
    }));
    persist(get());
  },

  setPanelSize: (panel, size) => {
    set((state) => ({
      panels: { ...state.panels, [panel]: { ...state.panels[panel], size: clampSize(panel, size) } },
    }));
    persist(get());
  },

  toggleSection: (id, open) => {
    set((state) => ({
      openSections: { ...state.openSections, [id]: open ?? !(state.openSections[id] ?? true) },
    }));
    persist(get());
  },

  moveNode: (nodeId, x, y) => {
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, x, y } : node)),
      // "unsaved", like every other mutation. This previously set "saved",
      // which meant nudging a node silently cleared a genuinely-unsaved
      // reorder — the top bar would read Saved with two pending changes.
      saveState: "unsaved",
    }));

    // A node the server has not acknowledged yet has no id the layout endpoint
    // would recognise; its position rides along with the POST that creates it.
    if (get().source !== "live" || isTempId(nodeId)) return;
    pendingPositions.set(nodeId, { id: nodeId, x, y });
    scheduleLayoutFlush();
  },

  reorderSet: (from, to) => {
    const before = get();
    const items = before.set.items;
    if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;

    const moved = items[from];
    if (moved === undefined) return;

    // Splice-move, not swap: dragging track 1 to position 4 must shift 2–4
    // left, not trade places with 4.
    const next = [...items];
    next.splice(from, 1);
    next.splice(to, 0, moved);

    set((state) => ({
      set: { ...state.set, items: next },
      saveState: state.source === "live" ? "saving" : "unsaved",
    }));

    const setId = before.setId;
    if (before.source !== "live" || setId === null) return;

    void (async () => {
      try {
        // One row: the server computes a rank between the item's new
        // neighbours and leaves the rest of the set alone (plan §7.4).
        await reorderSetItemRequest(setId, moved.id, to);
        set({ saveState: "saved" });
      } catch (error) {
        // Put the order back. A timeline showing an order the database does
        // not have is worse than a visible failure.
        set((state) => ({ set: { ...state.set, items }, saveState: "saved" }));
        get().announce(
          error instanceof Error ? error.message : "Could not reorder the set.",
        );
      }
    })();
  },

  addTrackToSet: (trackId, position) => {
    const before = get();
    const at = Math.max(0, Math.min(before.set.items.length, position ?? before.set.items.length));

    if (before.source !== "live") {
      set((state) => {
        const items = [...state.set.items];
        items.splice(at, 0, { id: `item-${trackId}-${state.statusId}`, trackId });
        return { set: { ...state.set, items }, saveState: "unsaved" };
      });
      return;
    }

    const setId = before.setId;
    if (setId === null) {
      get().announce("This workspace has no set yet.");
      return;
    }

    // Optimistic, under a temporary id — a drop that waits for a round trip
    // before drawing anything reads as a failed drop.
    const tempId = `${TEMP_NODE_PREFIX}item-${trackId}-${before.statusId}`;
    set((state) => {
      const items = [...state.set.items];
      items.splice(at, 0, { id: tempId, trackId });
      return { set: { ...state.set, items }, saveState: "saving" };
    });

    void (async () => {
      try {
        const created = adaptSetItem(await addSetItemRequest(setId, { trackId, position: at }));
        set((state) => ({
          set: {
            ...state.set,
            items: state.set.items.map((item) => (item.id === tempId ? created : item)),
          },
          saveState: "saved",
        }));
      } catch (error) {
        set((state) => ({
          set: {
            ...state.set,
            items: state.set.items.filter((item) => item.id !== tempId),
          },
          saveState: "saved",
        }));
        get().announce(
          error instanceof Error ? error.message : "Could not add that track to the set.",
        );
      }
    })();
  },

  removeSetItem: (itemId) => {
    const before = get();
    const index = before.set.items.findIndex((item) => item.id === itemId);
    if (index === -1) return;
    const removed = before.set.items[index];
    if (removed === undefined) return;

    set((state) => ({
      set: {
        ...state.set,
        items: state.set.items.filter((item) => item.id !== itemId),
      },
      saveState: state.source === "live" ? "saving" : "unsaved",
    }));

    const setId = before.setId;
    if (before.source !== "live" || setId === null) return;

    void (async () => {
      try {
        await removeSetItemRequest(setId, itemId);
        set({ saveState: "saved" });
      } catch (error) {
        // Put it back at the index it came from, not on the end.
        set((state) => {
          const items = [...state.set.items];
          items.splice(Math.min(index, items.length), 0, removed);
          return { set: { ...state.set, items }, saveState: "saved" };
        });
        get().announce(
          error instanceof Error ? error.message : "Could not remove that track.",
        );
      }
    })();
  },

  addTrackToGraph: (trackId, x, y) => {
    const before = get();
    if (before.nodes.some((node) => node.trackId === trackId)) return;

    if (before.source !== "live") {
      set((state) => ({
        nodes: [...state.nodes, { id: `node-${trackId}`, trackId, x, y }],
        selectedTrackId: trackId,
        selectedTransitionId: null,
        saveState: "unsaved",
      }));
      return;
    }

    const graphId = before.graphId;
    if (graphId === null) return;

    // Placed immediately under a temporary id, then reconciled. A drop that
    // waits for a round trip before drawing anything reads as a failed drop.
    const tempId = `${TEMP_NODE_PREFIX}${trackId}`;
    set((state) => ({
      nodes: [...state.nodes, { id: tempId, trackId, x, y }],
      selectedTrackId: trackId,
      selectedTransitionId: null,
      saveState: "saving",
    }));

    void (async () => {
      try {
        const created = adaptNode(await addNodeRequest(graphId, { trackId, x, y }));
        set((state) => ({
          // Swapped in place: the node may have been dragged while the request
          // was open, so the server's id is taken but the local position kept,
          // and that position is then queued under the real id.
          nodes: state.nodes.map((node) =>
            node.id === tempId ? { ...created, x: node.x, y: node.y } : node,
          ),
          saveState: "saved",
        }));

        const placed = get().nodes.find((node) => node.id === created.id);
        if (placed && (placed.x !== created.x || placed.y !== created.y)) {
          pendingPositions.set(created.id, { id: created.id, x: placed.x, y: placed.y });
          scheduleLayoutFlush();
        }
      } catch (error) {
        set((state) => ({
          nodes: state.nodes.filter((node) => node.id !== tempId),
          saveState: "saved",
        }));
        get().announce(
          error instanceof Error ? error.message : "Could not place that track.",
        );
      }
    })();
  },

  removeTransition: (transitionId) => {
    const before = get();
    const removed = before.transitions.find((tx) => tx.id === transitionId);
    if (!removed) return;

    set((state) => ({
      transitions: state.transitions.filter((tx) => tx.id !== transitionId),
      selectedTransitionId: null,
      saveState: before.source === "live" ? "saving" : "unsaved",
    }));

    if (before.source !== "live") return;

    void (async () => {
      try {
        await deleteTransitionRequest(transitionId);
        set({ saveState: "saved" });
      } catch (error) {
        // Put it back. A delete that failed on the server but succeeded on
        // screen is the one outcome worse than a visible error.
        set((state) => ({
          transitions: [...state.transitions, removed],
          saveState: "saved",
        }));
        get().announce(
          error instanceof Error ? error.message : "Could not delete that transition.",
        );
      }
    })();
  },

  updateTransition: (transitionId, patch) => {
    set((state) => ({
      transitions: state.transitions.map((tx) =>
        tx.id === transitionId ? { ...tx, ...patch } : tx,
      ),
      saveState: "unsaved",
    }));

    if (get().source !== "live" || warnedAboutTransitionEdits) return;
    warnedAboutTransitionEdits = true;
    get().announce(
      "Transition details are not saved yet — the API has no endpoint to update them.",
    );
  },

  announce: (status) => set((state) => ({ status, statusId: state.statusId + 1 })),
}));

/* ------------------------------------------------------------- selectors -- */

/**
 * Selectors are exported as standalone functions rather than inlined at each
 * call site so two surfaces cannot compute "is this track in the set" from
 * different rules. Each returns a stable primitive or a memo-friendly value.
 */

/**
 * Resolves a track id against whatever the workspace currently holds.
 *
 * This replaced a module-level `Map` over the demo constant. That lookup was
 * invisible until the store held live data, at which point every node on the
 * canvas rendered "Track unavailable" — it was resolving live ids against demo
 * tracks. A track can only be found in the one place tracks live.
 *
 * `find` returns the same object reference for an unchanged array, so the
 * selector is referentially stable and does not re-render on unrelated writes.
 */
export function useTrackById(id: string | null | undefined): WorkspaceTrack | null {
  return useWorkspace((state) =>
    id ? (state.tracks.find((track) => track.id === id) ?? null) : null,
  );
}

export function useSelectedTrackId(): string | null {
  return useWorkspace((state) => state.selectedTrackId);
}

export function useSelectedTransitionId(): string | null {
  return useWorkspace((state) => state.selectedTransitionId);
}

/** Track ids on the active set path, as a Set for O(1) membership tests. */
export function useActiveSetTrackIds(): ReadonlySet<string> {
  const items = useWorkspace((state) => state.set.items);
  return new Set(items.map((item) => item.trackId));
}

export function useActiveSetTransitionIds(): ReadonlySet<string> {
  const set = useWorkspace((state) => state.set);
  const transitions = useWorkspace((state) => state.transitions);
  return new Set(activeSetTransitionIds(set, transitions));
}

/** Track ids already placed on the canvas. */
export function usePlacedTrackIds(): ReadonlySet<string> {
  const nodes = useWorkspace((state) => state.nodes);
  return new Set(nodes.map((node) => node.trackId));
}
