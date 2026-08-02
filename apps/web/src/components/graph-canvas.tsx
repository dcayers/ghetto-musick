import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  applyNodeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type OnMove,
} from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildTrackGraph, type ScorableTrack } from "@flowgraph/domain";
import {
  getGraph,
  addNode,
  removeNode,
  saveLayout,
  createTransition,
  deleteTransition,
  type GraphDetail,
} from "../lib/graph-api.js";
import { TrackNode, type TrackNodeData } from "./track-node.js";
import type { InspectorTrack } from "./inspector.js";
import { EmptyState } from "./primitives.js";

const nodeTypes = { track: TrackNode };

/** Below this zoom, nodes render simplified — plan §9.8. */
const SIMPLIFY_BELOW_ZOOM = 0.55;

/** Edge colour per technique. Always paired with a text label (§9.6). */
const EDGE_COLOR: Record<string, string> = {
  blend: "var(--color-edge-blend)",
  "long-blend": "var(--color-edge-blend)",
  "filter-sweep": "var(--color-edge-filter)",
  "echo-out": "var(--color-edge-echo)",
  cut: "var(--color-edge-cut)",
  "loop-build": "var(--color-edge-loop)",
};

const TECHNIQUE_LABEL: Record<string, string> = {
  blend: "Blend",
  "long-blend": "Long blend",
  cut: "Cut",
  "echo-out": "Echo out",
  "filter-sweep": "Filter sweep",
  "loop-build": "Loop build",
  "acapella-over": "Acapella over",
  "genre-flip": "Genre flip",
  custom: "Custom",
};

/**
 * Projects the server's graph into React Flow's node/edge arrays.
 *
 * graphology owns the authoritative model (ADR §9.3) — React Flow renders a
 * projection of it. That is what makes the renderer swappable if the 1k/3k
 * budget ever fails, and it is why the prototype's tag-desync bug (edge data
 * held in two hand-synced arrays) cannot recur here.
 */
function project(
  detail: GraphDetail,
  simplified: boolean,
): { nodes: Node<TrackNodeData>[]; edges: Edge[] } {
  const scorable: ScorableTrack[] = detail.nodes.map((node) => ({
    id: node.trackId,
    bpm: node.track.bpm,
    keySignature: node.track.keySignature,
    tags: [],
    energy: null,
  }));

  // Built for its invariants: directed, no self-loops, one edge per ordered
  // pair. A transition referencing a track not on this canvas is dropped
  // rather than producing a dangling edge.
  const model = buildTrackGraph(
    scorable,
    detail.transitions.map((t) => ({
      id: t.id,
      sourceTrackId: t.fromTrackId,
      targetTrackId: t.toTrackId,
      technique: t.technique,
    })),
  );

  const nodeIdByTrack = new Map(detail.nodes.map((n) => [n.trackId, n.id]));

  const nodes: Node<TrackNodeData>[] = detail.nodes.map((node) => ({
    id: node.id,
    type: "track",
    position: { x: node.x, y: node.y },
    data: {
      trackId: node.trackId,
      title: node.track.title,
      artist: node.track.artist,
      bpm: node.track.bpm,
      keySignature: node.track.keySignature,
      energy: null,
      simplified,
    },
  }));

  const edges: Edge[] = [];
  model.forEachDirectedEdge((_edge, attributes, source, target) => {
    const sourceNodeId = nodeIdByTrack.get(source);
    const targetNodeId = nodeIdByTrack.get(target);
    if (!sourceNodeId || !targetNodeId) return;

    const technique = attributes.technique ?? "blend";
    edges.push({
      id: attributes.id,
      source: sourceNodeId,
      target: targetNodeId,
      label: simplified ? undefined : (TECHNIQUE_LABEL[technique] ?? technique),
      animated: false,
      style: { stroke: EDGE_COLOR[technique] ?? "var(--color-edge-default)" },
    });
  });

  return { nodes, edges };
}

function Canvas({
  graphId,
  onSelect,
}: {
  graphId: string;
  onSelect: (track: InspectorTrack | null) => void;
}) {
  const queryClient = useQueryClient();
  const { screenToFlowPosition } = useReactFlow();
  const [zoom, setZoom] = useState(1);
  const wrapper = useRef<HTMLDivElement>(null);

  // Optimistic-concurrency token. Kept in a ref so a save in flight does not
  // trigger a re-render mid-drag.
  const versionRef = useRef(1);

  const { data, isPending, error } = useQuery({
    queryKey: ["graph", graphId],
    queryFn: async () => {
      const detail = await getGraph(graphId);
      versionRef.current = detail.graph.version;
      return detail;
    },
  });

  const simplified = zoom < SIMPLIFY_BELOW_ZOOM;
  const projected = useMemo(
    () => (data ? project(data, simplified) : { nodes: [], edges: [] }),
    [data, simplified],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(projected.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(projected.edges);

  // `useNodesState` seeds from its argument only, so a refetch must be pushed
  // in explicitly. The prototype this replaced had exactly this bug and its
  // add-track flow silently rendered nothing.
  const projectedKey = `${projected.nodes.length}:${projected.edges.length}:${simplified}`;
  const lastKey = useRef(projectedKey);
  if (lastKey.current !== projectedKey) {
    lastKey.current = projectedKey;
    setNodes(projected.nodes);
    setEdges(projected.edges);
  }

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["graph", graphId] });

  const layoutMutation = useMutation({
    mutationFn: (positions: Array<{ id: string; x: number; y: number }>) =>
      saveLayout(graphId, versionRef.current, positions),
    onSuccess: (version) => {
      versionRef.current = version;
    },
    onError: () => {
      // A 409 means another session moved things. Reload rather than retry —
      // retrying would clobber whatever they did.
      void invalidate();
    },
  });

  const addNodeMutation = useMutation({
    mutationFn: (input: { trackId: string; x: number; y: number }) =>
      addNode(graphId, input),
    onSuccess: invalidate,
  });

  const removeNodeMutation = useMutation({
    mutationFn: (nodeId: string) => removeNode(graphId, nodeId),
    onSuccess: invalidate,
  });

  const connectMutation = useMutation({
    mutationFn: (input: { fromTrackId: string; toTrackId: string }) =>
      createTransition(input),
    onSuccess: invalidate,
  });

  const deleteEdgeMutation = useMutation({
    mutationFn: (transitionId: string) => deleteTransition(transitionId),
    onSuccess: invalidate,
  });

  /**
   * Positions are written on pointer release, not per frame — plan §9.8.
   * A request per drag frame would flood the API and lose the batch semantics
   * the layout endpoint was designed around.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<TrackNodeData>>[]) => {
      onNodesChange(changes);

      const settled = changes.filter(
        (change) => change.type === "position" && change.dragging === false,
      );
      if (settled.length === 0) return;

      const next = applyNodeChanges(changes, nodes);
      const moved = settled
        .map((change) => next.find((node) => node.id === (change as { id: string }).id))
        .filter((node): node is Node<TrackNodeData> => node !== undefined)
        .map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }));

      if (moved.length > 0) layoutMutation.mutate(moved);
    },
    [nodes, onNodesChange, layoutMutation],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const from = nodes.find((node) => node.id === connection.source);
      const to = nodes.find((node) => node.id === connection.target);
      if (!from || !to || from.id === to.id) return;

      connectMutation.mutate({
        fromTrackId: from.data.trackId,
        toTrackId: to.data.trackId,
      });
    },
    [nodes, connectMutation],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const trackId = event.dataTransfer.getData("application/flowgraph-track");
      if (!trackId) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNodeMutation.mutate({ trackId, x: position.x, y: position.y });
    },
    [screenToFlowPosition, addNodeMutation],
  );

  const onMove: OnMove = useCallback((_event, viewport) => setZoom(viewport.zoom), []);

  if (error) {
    return <EmptyState title="Could not load the graph" />;
  }
  if (isPending) {
    return <EmptyState title="Loading graph…" />;
  }

  return (
    <div ref={wrapper} className="h-full w-full" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onMove={onMove}
        onNodeClick={(_event, node) => {
          const data = node.data as TrackNodeData;
          onSelect({
            id: data.trackId,
            title: data.title,
            artist: data.artist,
            bpm: data.bpm,
            keySignature: data.keySignature,
          });
        }}
        onPaneClick={() => onSelect(null)}
        onNodesDelete={(deleted) => {
          // Delete-from-graph, never delete-from-library — plan §10.1.
          for (const node of deleted) removeNodeMutation.mutate(node.id);
        }}
        onEdgesDelete={(deleted) => {
          for (const edge of deleted) deleteEdgeMutation.mutate(edge.id);
        }}
        fitView
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background gap={20} size={1} color="var(--color-border)" />
        <Controls />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(11,11,16,0.75)"
          nodeColor="var(--color-accent-muted)"
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <EmptyState
            title="Drag tracks from the library"
            hint="Then drag between the handles to author a transition."
          />
        </div>
      )}
    </div>
  );
}

export function GraphCanvas({
  graphId,
  onSelect,
}: {
  graphId: string;
  onSelect: (track: InspectorTrack | null) => void;
}) {
  return (
    <ReactFlowProvider>
      <Canvas graphId={graphId} onSelect={onSelect} />
    </ReactFlowProvider>
  );
}
