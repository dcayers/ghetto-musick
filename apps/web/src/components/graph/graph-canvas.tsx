import { useCallback, useMemo, useState, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeChange,
  type OnMove,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import { Button } from "react-aria-components";
import { Crosshair, Map as MapIcon, Music4, RotateCcw } from "lucide-react";
import { buildTrackGraph } from "@flowgraph/domain";

import { NODE_HEIGHT, NODE_WIDTH, TrackNode, type TrackNodeData } from "./track-node.js";
import { TransitionEdge, type TransitionEdgeData } from "./transition-edge.js";
import { CanvasToolbar, CanvasZoomControls, type CanvasTool } from "../canvas-tools.js";
import { EmptyState } from "../primitives.js";
import { IconButton } from "../ui.js";
import { setTrackIds, techniqueSpec } from "../../lib/workspace-data.js";
import type {
  WorkspaceGraphNode,
  WorkspaceSet,
  WorkspaceTrack,
  WorkspaceTransition,
} from "../../lib/workspace-data.js";
import {
  useActiveSetTransitionIds,
  useWorkspace,
} from "../../state/workspace.js";
import { useSeratoImport } from "../../state/use-serato-import.js";

/**
 * The graph canvas.
 *
 * graphology owns the model and React Flow renders a projection of it (ADR-0003).
 * That is not ceremony: the prototype this replaces held edge data in a
 * `transitions` array *and* inside `edges[].data`, hand-synced on every
 * mutation, and the two drifted. Here the only way to produce an edge is to walk
 * the built graph, so a transition pointing at a track that is not on the canvas
 * cannot render as a dangling line — `buildTrackGraph` drops it.
 *
 * Every piece of selection state lives in the store (§13). This file reads it to
 * set React Flow's `selected` flags and writes it back on click, so selecting a
 * track in the library lights it up here without either surface knowing the
 * other exists.
 */

/* --------------------------------------------------------------- constants -- */

/** Below this zoom nodes drop to their simplified form — §8. */
const SIMPLIFY_BELOW_ZOOM = 0.45;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

/**
 * Opening viewport.
 *
 * Pixel padding is stable across panel widths, and the fit is allowed to zoom
 * below the node-detail threshold so every node dimension is actually inside
 * the current canvas. A minimum fit zoom made the old "Fit" action knowingly
 * clip the leftmost node on narrower desktop workspaces.
 */
const FIT_VIEW_OPTIONS = {
  minZoom: MIN_ZOOM,
  maxZoom: 1,
  padding: { x: "56px", y: "48px" },
} as const;

/**
 * Middle and right mouse buttons.
 *
 * While the marquee owns the left button, panning still has to be reachable —
 * a box-select tool that strands you in a corner of the graph is worse than no
 * box-select tool.
 */
const PAN_BUTTONS = [1, 2];

const NODE_TYPES = { track: TrackNode };
const EDGE_TYPES = { transition: TransitionEdge };

type CanvasNode = RFNode<TrackNodeData>;
type CanvasEdge = RFEdge<TransitionEdgeData>;

/* -------------------------------------------------------------- projection -- */

interface ProjectionInput {
  readonly tracks: readonly WorkspaceTrack[];
  readonly graphNodes: readonly WorkspaceGraphNode[];
  readonly transitions: readonly WorkspaceTransition[];
  readonly activeSet: WorkspaceSet;
  readonly activeSetTransitionIds: ReadonlySet<string>;
  readonly selectedTrackId: string | null;
  readonly selectedTransitionId: string | null;
  readonly multiSelectedTrackIds: readonly string[];
  readonly simplified: boolean;
}

/**
 * Builds the authoritative graph, then projects it into React Flow's arrays.
 *
 * The direction matters. Nodes are projected from the store's placements (they
 * carry position, which the model does not), but *edges are only ever read back
 * out of the model* — that is what makes the invariants it enforces (directed,
 * no self-loops, one edge per ordered pair) hold on screen too.
 */
function project(input: ProjectionInput): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const {
    tracks,
    graphNodes,
    transitions,
    activeSet,
    activeSetTransitionIds,
    selectedTrackId,
    selectedTransitionId,
    multiSelectedTrackIds,
    simplified,
  } = input;

  const trackById = new Map(tracks.map((track) => [track.id, track]));

  const placed = graphNodes.flatMap((node) => {
    const track = trackById.get(node.trackId);
    // A placement whose track has left the library is dropped rather than
    // rendered as an untitled box.
    return track ? [{ node, track }] : [];
  });

  const model = buildTrackGraph(
    placed.map((entry) => entry.track),
    transitions,
  );

  const nodeIdByTrack = new Map(placed.map((entry) => [entry.track.id, entry.node.id]));
  const transitionById = new Map(transitions.map((tx) => [tx.id, tx]));
  const setOrder = setTrackIds(activeSet);

  // 1-based, because it is read aloud and printed on the node — a DJ counts
  // from one. `indexOf` over six ids is cheaper than the Map that replaces it.
  const setPositionOf = (trackId: string): number | null => {
    const index = setOrder.indexOf(trackId);
    return index === -1 ? null : index + 1;
  };

  // A track is "AI suggested" when something proposed *getting to* it, not when
  // it happens to sit at the tail of an authored route.
  //
  // Reachability is what decides it, not the presence of one AI edge: an AI
  // branch that rejoins the authored path points at a track the DJ already
  // placed there — Losing It closes the set *and* is the target of the peak
  // branch — and drawing that as provisional says the closer is a guess.
  const manualTargets = new Set(
    transitions.filter((tx) => tx.origin === "manual").map((tx) => tx.targetTrackId),
  );
  const aiTargets = new Set(
    transitions
      .filter(
        (tx) =>
          tx.origin === "ai" &&
          !manualTargets.has(tx.targetTrackId) &&
          !setOrder.includes(tx.targetTrackId),
      )
      .map((tx) => tx.targetTrackId),
  );

  /**
   * The selected set.
   *
   * A marquee replaces the selection rather than adding to it, so when
   * `multiSelectedTrackIds` is populated it *is* the answer. Folding the
   * primary selection in as well would make a marquee silently grow by whatever
   * was selected before it, and each round trip through the store would grow it
   * again.
   */
  const selectedTrackIds =
    multiSelectedTrackIds.length > 0
      ? new Set(multiSelectedTrackIds)
      : new Set(selectedTrackId ? [selectedTrackId] : []);

  const nodes: CanvasNode[] = placed.map(({ node, track }) => ({
    id: node.id,
    type: "track",
    position: { x: node.x, y: node.y },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    selected: selectedTrackIds.has(track.id),
    focusable: true,
    ariaRole: "button",
    ariaLabel: `${track.title} by ${track.artist}${track.bpm === null ? "" : `, ${Math.round(track.bpm)} BPM`}${track.keySignature ? `, key ${track.keySignature}` : ""}`,
    data: {
      trackId: track.id,
      simplified,
      inActiveSet: setOrder.includes(track.id),
      setPosition: setPositionOf(track.id),
      isAiSuggested: aiTargets.has(track.id),
    },
  }));

  const edges: CanvasEdge[] = [];
  model.forEachDirectedEdge((_key, attributes, source, target) => {
    const sourceNodeId = nodeIdByTrack.get(source);
    const targetNodeId = nodeIdByTrack.get(target);
    const transition = transitionById.get(attributes.id);
    if (!sourceNodeId || !targetNodeId || !transition) return;

    // React Flow names its focusable edge wrapper from the source and target
    // *node ids* unless told otherwise, so a keyboard user hears
    // "Edge from node-awake to node-afterglow". The wrapper is what receives
    // focus, so the name has to live here rather than only on the label button
    // inside it (§17).
    const sourceTrack = trackById.get(source);
    const targetTrack = trackById.get(target);
    const endpoints =
      sourceTrack && targetTrack ? ` from ${sourceTrack.title} to ${targetTrack.title}` : "";

    edges.push({
      id: transition.id,
      type: "transition",
      source: sourceNodeId,
      target: targetNodeId,
      selected: transition.id === selectedTransitionId,
      ariaLabel: `${techniqueSpec(transition.technique).label}${endpoints}, ${transition.bars} bars`,
      // Alternatives must stay clickable at their thin weight, so the hit area
      // is widened well past the stroke.
      interactionWidth: 18,
      data: {
        transitionId: transition.id,
        technique: transition.technique,
        inActiveSet: activeSetTransitionIds.has(transition.id),
        isAiSuggested: transition.origin === "ai",
        hasWarning: transition.warnings.length > 0,
      },
    });
  });

  return { nodes, edges };
}

/** The fields the projection authors. Everything else on a node is React Flow's. */
function sameProjectedShape(a: CanvasNode, b: CanvasNode): boolean {
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    (a.selected ?? false) === (b.selected ?? false) &&
    a.data.trackId === b.data.trackId &&
    a.data.simplified === b.data.simplified &&
    a.data.inActiveSet === b.data.inActiveSet &&
    a.data.setPosition === b.data.setPosition &&
    a.data.isAiSuggested === b.data.isAiSuggested
  );
}

/**
 * Merges a fresh projection into the nodes React Flow is already holding.
 *
 * Handing React Flow brand-new node objects is not free. `adoptUserNodes` reuses
 * a node's internals only when the object is the *same reference* it saw last;
 * otherwise it rebuilds them from the object alone, taking `measured` — and
 * therefore `handleBounds` — from it. A projection that mints new objects on
 * every selection change hands over nodes with no `measured`, which makes
 * `isNodeInitialized` false for all of them: every node renders
 * `visibility: hidden` and every edge unmounts until a ResizeObserver round trip
 * puts the dimensions back. So an unchanged node is passed back by reference,
 * and a changed one is rebuilt *on top of* the existing object so whatever
 * React Flow measured rides along.
 */
function adoptProjection(current: CanvasNode[], projected: CanvasNode[]): CanvasNode[] {
  const byId = new Map(current.map((node) => [node.id, node]));
  let changed = current.length !== projected.length;

  const next = projected.map((node) => {
    const existing = byId.get(node.id);
    if (!existing) {
      changed = true;
      return node;
    }
    if (sameProjectedShape(existing, node)) return existing;
    changed = true;
    // Spread the existing node first: `measured`, `width`, `height`, and the
    // drag flags are React Flow's to keep. Only the authored fields move.
    return {
      ...existing,
      position: node.position,
      selected: node.selected ?? false,
      data: node.data,
    };
  });

  // Same objects in the same order means nothing to re-render — hand back the
  // identical array so the state update bails out entirely.
  return changed ? next : current;
}

/* ------------------------------------------------------------- empty state -- */

/** Why each empty-state action is inert, shown on hover and read out. */
const UNAVAILABLE = "Not available yet";

/**
 * An empty-state action that is deliberately inert.
 *
 * React Aria's tooltip never opens for a disabled control — a `disabled` button
 * receives no pointer events — so the reason rides on a wrapper's `title`
 * instead, and is repeated in the accessible name for anyone not using a
 * pointer.
 */
function PendingAction({ label }: { label: string }) {
  return (
    <span title={`${label} — ${UNAVAILABLE.toLowerCase()}`} className="inline-flex">
      <Button
        isDisabled
        aria-label={`${label}. ${UNAVAILABLE}.`}
        className="border-border text-ink-muted rounded-control border px-2.5 py-1 text-xs disabled:opacity-50"
      >
        {label}
      </Button>
    </span>
  );
}

/* ----------------------------------------------------------------- canvas -- */

function Canvas() {
  const tracks = useWorkspace((state) => state.tracks);
  const graphNodes = useWorkspace((state) => state.nodes);
  const transitions = useWorkspace((state) => state.transitions);
  const activeSet = useWorkspace((state) => state.set);
  const selectedTrackId = useWorkspace((state) => state.selectedTrackId);
  const selectedTransitionId = useWorkspace((state) => state.selectedTransitionId);
  const multiSelectedTrackIds = useWorkspace((state) => state.multiSelectedTrackIds);

  const selectTrack = useWorkspace((state) => state.selectTrack);
  const selectTransition = useWorkspace((state) => state.selectTransition);
  const clearSelection = useWorkspace((state) => state.clearSelection);
  const setMultiSelection = useWorkspace((state) => state.setMultiSelection);
  const moveNode = useWorkspace((state) => state.moveNode);
  const addTrackToGraph = useWorkspace((state) => state.addTrackToGraph);
  const announce = useWorkspace((state) => state.announce);

  const activeSetTransitionIds = useActiveSetTransitionIds();

  const { screenToFlowPosition, zoomIn, zoomOut, zoomTo, fitView, setViewport } =
    useReactFlow<CanvasNode, CanvasEdge>();

  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const seratoImport = useSeratoImport();

  const simplified = zoom < SIMPLIFY_BELOW_ZOOM;

  // The selector mints a fresh Set every render by design, so the projection is
  // keyed on its contents. Keying on the Set itself would rebuild every node
  // and edge object each time the tool or the minimap toggled.
  const activeSetKey = [...activeSetTransitionIds].join("|");

  const projection = useMemo(
    () =>
      project({
        tracks,
        graphNodes,
        transitions,
        activeSet,
        activeSetTransitionIds,
        selectedTrackId,
        selectedTransitionId,
        multiSelectedTrackIds,
        simplified,
      }),
    [
      tracks,
      graphNodes,
      transitions,
      activeSet,
      activeSetKey,
      selectedTrackId,
      selectedTransitionId,
      multiSelectedTrackIds,
      simplified,
    ],
  );

  /**
   * Node positions are held locally for the duration of a drag.
   *
   * §18 commits on pointer release only, so between pointerdown and pointerup
   * the store still holds the old coordinates and something has to carry the
   * live ones. Re-seeding on a new projection is what lets a move made anywhere
   * else — a reset, another session — land here.
   */
  const [nodes, setNodes] = useState<CanvasNode[]>(projection.nodes);
  const [lastProjected, setLastProjected] = useState(projection.nodes);
  if (lastProjected !== projection.nodes) {
    // React's documented "adjust state during render" form. A ref would work in
    // practice but is an impure write, and StrictMode's double render exists to
    // catch exactly that.
    setLastProjected(projection.nodes);
    // Merged rather than replaced: a new projection is produced on every
    // selection change, and replacing the array wholesale strips the
    // measurements React Flow needs to consider a node initialised.
    setNodes((current) => adoptProjection(current, projection.nodes));
  }

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const next = applyNodeChanges(changes, nodes);
      setNodes(next);

      for (const change of changes) {
        if (change.type !== "position" || change.dragging !== false) continue;
        // Read the position back out of the applied result: the settling change
        // carries `dragging: false` but not always a position.
        const moved = next.find((node) => node.id === change.id);
        if (!moved) continue;
        moveNode(moved.id, Math.round(moved.position.x), Math.round(moved.position.y));
      }
    },
    [nodes, moveNode],
  );

  /**
   * Reports the marquee up to the store.
   *
   * The dependency list must stay stable. React Flow subscribes to this handler
   * in an effect keyed on its identity, and this handler writes to the store —
   * so depending on anything the store owns would make every write re-run the
   * effect that produced it.
   */
  const handleSelectionChange = useCallback<OnSelectionChangeFunc<CanvasNode, CanvasEdge>>(
    ({ nodes: selected, edges: selectedEdges }) => {
      const selectedEdge = selectedEdges[0];
      if (selectedEdge !== undefined) {
        selectTransition(selectedEdge.id);
        return;
      }

      const trackIds = selected.map((node) => node.data.trackId);
      // Two or more is what `multiSelectedTrackIds` exists for.
      if (trackIds.length > 1) {
        setMultiSelection(trackIds);
        return;
      }

      // Read imperatively rather than closing over the store, for the reason
      // above: a store-derived dependency would re-run the effect on the write
      // this handler itself makes.
      const state = useWorkspace.getState();
      const only = trackIds[0];

      if (only === undefined) {
        // Nothing boxed. Drop the group, but leave any primary selection alone
        // — it may have been made in the library or the timeline, and
        // `onPaneClick` is what owns "deselect everything".
        if (state.multiSelectedTrackIds.length > 0) setMultiSelection([]);
        return;
      }

      // Exactly one node. A marquee fires no `onNodeClick`, so discarding this
      // used to leave the boxed node the one thing on screen *not* selected
      // while the previous selection lit back up. Promote it instead.
      const isAlreadyPrimary =
        state.selectedTrackId === only;
      if (isAlreadyPrimary) {
        // Re-selecting would write the same selection back and re-enter here.
        if (state.multiSelectedTrackIds.length > 0) setMultiSelection([]);
        return;
      }
      selectTrack(only);
    },
    [setMultiSelection, selectTrack, selectTransition],
  );

  const handleToolChange = useCallback(
    (next: CanvasTool) => {
      setTool(next);
      // Connect and Link have no action behind them yet. Saying so is better
      // than a tool that silently swallows the drag you make with it.
      announce(
        next === "connect" || next === "link"
          ? "Authoring transitions on the canvas is not available yet — edit transitions in the inspector."
          : null,
      );
    },
    [announce],
  );

  const handleMove: OnMove = useCallback((_event, viewport) => {
    // Panning reports the same zoom on every frame; bailing out keeps a pan
    // from re-rendering the whole canvas sixty times a second.
    setZoom((current) => (current === viewport.zoom ? current : viewport.zoom));
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDropTarget(false);

      const trackId = event.dataTransfer.getData("application/flowgraph-track");
      if (!trackId) return;

      // `addTrackToGraph` returns the state untouched for a track that is
      // already placed, so the drop would otherwise land on silence — nothing
      // moves and nothing is said. The library's double-click path announces
      // this; the same gesture on the canvas has to reach the same words.
      if (graphNodes.some((node) => node.trackId === trackId)) {
        const title = tracks.find((track) => track.id === trackId)?.title ?? "That track";
        announce(`${title} is already on the canvas.`);
        return;
      }

      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Centre the node on the cursor. Dropping by a node's top-left corner
      // consistently lands it low and to the right of where you aimed.
      addTrackToGraph(
        trackId,
        Math.round(point.x - NODE_WIDTH / 2),
        Math.round(point.y - NODE_HEIGHT / 2),
      );
    },
    [screenToFlowPosition, addTrackToGraph, graphNodes, tracks, announce],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("application/flowgraph-track")) return;
    // Without preventDefault the browser refuses the drop entirely.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    // `dragleave` also fires crossing into a child, which would strobe the
    // highlight across every node the cursor passes over.
    if (event.currentTarget.contains(event.relatedTarget as HTMLElement | null)) return;
    setIsDropTarget(false);
  }, []);

  /* Viewport ------------------------------------------------------------- */

  const focusNodeId =
    graphNodes.find((node) => node.trackId === selectedTrackId)?.id ?? null;

  const handleFitView = useCallback(() => {
    void fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });
  }, [fitView]);

  const handleFocusSelection = useCallback(() => {
    if (!focusNodeId) return;
    // Generous padding so the neighbours a node connects to stay in frame —
    // a track alone on screen tells you nothing about its route.
    void fitView({ nodes: [{ id: focusNodeId }], padding: 1.2, maxZoom: 1.2, duration: 200 });
  }, [fitView, focusNodeId]);

  const handleResetViewport = useCallback(() => {
    void setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 });
  }, [setViewport]);

  /** Node ids on the set path, for the minimap's colouring. */
  const setNodeIds = useMemo(
    () =>
      new Set(
        graphNodes
          .filter((node) => setTrackIds(activeSet).includes(node.trackId))
          .map((node) => node.id),
      ),
    [graphNodes, activeSet],
  );

  const isEmpty = nodes.length === 0;

  return (
    <div
      className="bg-canvas relative h-full min-h-px w-full min-w-px"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={projection.edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onSelectionChange={handleSelectionChange}
        onMove={handleMove}
        onNodeClick={(event, node) => {
          // A modified click is additive, and `onSelectionChange` already
          // reports the resulting set. Setting the primary selection here would
          // clear the multi-selection the same gesture just built.
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          selectTrack(node.data.trackId);
        }}
        // Edge ids are transition ids by construction in `project`.
        onEdgeClick={(event, edge) => {
          event.stopPropagation();
          selectTransition(edge.id);
        }}
        onPaneClick={() => clearSelection()}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        proOptions={{ hideAttribution: true }}
        // There is no remove-node action in the store, and a Delete key that
        // takes edges but leaves nodes is worse than one that does nothing.
        // Removal belongs to the inspector, where it can be confirmed.
        deleteKeyCode={null}
        // Handles would be a live affordance with nothing behind them until the
        // store can create a transition.
        nodesConnectable={false}
        // The rail drives React Flow's own interaction modes rather than running
        // a parallel implementation of pan and marquee.
        panOnDrag={tool === "box-select" ? PAN_BUTTONS : true}
        selectionOnDrag={tool === "box-select"}
        nodesDraggable={tool !== "pan"}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={22}
          size={0.7}
          color="var(--color-grid)"
        />

        {showMiniMap && (
          <MiniMap<CanvasNode>
            pannable
            zoomable
            position="bottom-left"
            ariaLabel="Graph overview"
            // React Flow's 200×150 default eats a quarter of a short canvas and
            // hides the nodes it exists to summarise.
            style={{ width: 150, height: 100 }}
            maskColor="rgba(8,8,12,0.72)"
            // Three states a DJ can tell apart at 8px: what is selected, what is
            // on the set path, and what is merely on the canvas. Selection also
            // gets an outline, since a 6px block is too small to judge hue on.
            nodeColor={(node) =>
              node.selected
                ? "var(--color-accent)"
                : setNodeIds.has(node.id)
                  ? "var(--color-ok)"
                  : "var(--color-border-strong)"
            }
            nodeStrokeColor={(node) =>
              node.selected ? "var(--color-ink)" : "transparent"
            }
            nodeStrokeWidth={2}
            nodeBorderRadius={3}
          />
        )}
      </ReactFlow>

      <CanvasToolbar
        tool={tool}
        onToolChange={handleToolChange}
        className="absolute top-3 left-3 z-10"
      />

      <CanvasZoomControls
        zoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomIn={() => zoomIn({ duration: 150 })}
        onZoomOut={() => zoomOut({ duration: 150 })}
        onZoomReset={() => zoomTo(1, { duration: 150 })}
        onFitView={handleFitView}
        className="absolute top-3 right-3 z-10"
      />

      {/* Framing and chrome, kept apart from the zoom cluster: these change what
          the canvas shows rather than how far in you are. Fit lives in the zoom
          cluster above, which already owns it. */}
      <div className="border-border bg-surface absolute top-[3.75rem] right-3 z-10 flex gap-0.5 rounded-lg border p-1 shadow-lg shadow-black/30">
        <span
          className="inline-flex"
          {...(focusNodeId === null ? { title: "Select a track to focus on it" } : {})}
        >
          <IconButton
            icon={Crosshair}
            label={
              focusNodeId === null
                ? "Focus selection — select a track first"
                : "Focus selection"
            }
            isDisabled={focusNodeId === null}
            onPress={handleFocusSelection}
            size={14}
          />
        </span>
        <IconButton
          icon={RotateCcw}
          label="Reset viewport to 100%"
          onPress={handleResetViewport}
          size={14}
        />
        <IconButton
          icon={MapIcon}
          label={showMiniMap ? "Hide graph overview" : "Show graph overview"}
          isActive={showMiniMap}
          onPress={() => setShowMiniMap((visible) => !visible)}
          size={14}
        />
      </div>

      {isDropTarget && (
        <div
          aria-hidden="true"
          className="ring-accent pointer-events-none absolute inset-0 z-10 ring-2 ring-inset"
        />
      )}

      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto">
            <EmptyState
              icon={<Music4 size={22} aria-hidden="true" />}
              title="No tracks on the canvas"
              hint="Drag a track from the library onto the canvas to place it, then connect it to build a route. Existing sets open here already laid out."
              actions={
                <>
                  <Button
                    isDisabled={!seratoImport.isAvailable || seratoImport.isImporting}
                    aria-label={seratoImport.label}
                    onPress={seratoImport.run}
                    className="border-border text-ink-muted hover:border-border-strong hover:text-ink rounded-control border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
                  >
                    {seratoImport.isImporting ? "Reading library…" : "Import from Serato"}
                  </Button>
                  <PendingAction label="Generate with AI" />
                </>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * `useReactFlow` needs a provider above it, and the provider has to sit outside
 * the component that calls the hook — hence the split rather than one component.
 */
export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
