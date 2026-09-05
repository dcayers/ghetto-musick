import { create } from "zustand";
import {
  ACTIVE_SET,
  NODES,
  TRANSITIONS,
  TRACKS,
  activeSetTransitionIds,
  type DemoGraphNode,
  type DemoSet,
  type DemoTrack,
  type DemoTransition,
} from "../lib/demo-data.js";

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

interface WorkspaceState {
  /* Data */
  tracks: readonly DemoTrack[];
  nodes: readonly DemoGraphNode[];
  transitions: readonly DemoTransition[];
  set: DemoSet;

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
  addTrackToGraph: (trackId: string, x: number, y: number) => void;
  removeTransition: (transitionId: string) => void;
  updateTransition: (transitionId: string, patch: Partial<DemoTransition>) => void;
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

/* ------------------------------------------------------------------ store -- */

const initial = loadPersisted();

export const useWorkspace = create<WorkspaceState>((set, get) => ({
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

  moveNode: (nodeId, x, y) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, x, y } : node)),
      // "unsaved", like every other mutation. This previously set "saved",
      // which meant nudging a node silently cleared a genuinely-unsaved
      // reorder — the top bar would read Saved with two pending changes.
      saveState: "unsaved",
    })),

  reorderSet: (from, to) =>
    set((state) => {
      const ids = [...state.set.trackIds];
      if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return state;
      // Splice-move, not swap: dragging track 1 to position 4 must shift 2–4
      // left, not trade places with 4. Every track appears exactly once.
      const [moved] = ids.splice(from, 1);
      if (moved === undefined) return state;
      ids.splice(to, 0, moved);
      return { set: { ...state.set, trackIds: ids }, saveState: "unsaved" };
    }),

  addTrackToGraph: (trackId, x, y) =>
    set((state) => {
      if (state.nodes.some((node) => node.trackId === trackId)) return state;
      return {
        nodes: [...state.nodes, { id: `node-${trackId}`, trackId, x, y }],
        selectedTrackId: trackId,
        selectedTransitionId: null,
        saveState: "unsaved",
      };
    }),

  removeTransition: (transitionId) =>
    set((state) => ({
      transitions: state.transitions.filter((tx) => tx.id !== transitionId),
      selectedTransitionId: null,
      saveState: "unsaved",
    })),

  updateTransition: (transitionId, patch) =>
    set((state) => ({
      transitions: state.transitions.map((tx) =>
        tx.id === transitionId ? { ...tx, ...patch } : tx,
      ),
      saveState: "unsaved",
    })),

  announce: (status) => set((state) => ({ status, statusId: state.statusId + 1 })),
}));

/* ------------------------------------------------------------- selectors -- */

/**
 * Selectors are exported as standalone functions rather than inlined at each
 * call site so two surfaces cannot compute "is this track in the set" from
 * different rules. Each returns a stable primitive or a memo-friendly value.
 */

export function useSelectedTrackId(): string | null {
  return useWorkspace((state) => state.selectedTrackId);
}

export function useSelectedTransitionId(): string | null {
  return useWorkspace((state) => state.selectedTransitionId);
}

/** Track ids on the active set path, as a Set for O(1) membership tests. */
export function useActiveSetTrackIds(): ReadonlySet<string> {
  const trackIds = useWorkspace((state) => state.set.trackIds);
  return new Set(trackIds);
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
