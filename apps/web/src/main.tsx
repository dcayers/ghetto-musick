import { StrictMode, useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useIsMutating,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import "@xyflow/react/dist/style.css";
import "./styles/theme.css";

import { listTracks, isUnauthenticated, signOut } from "./lib/api.js";
import { SignIn } from "./components/sign-in.js";
import { LibraryPanel } from "./components/library-panel.js";
import { GraphCanvas } from "./components/graph-canvas.js";
import { TrackInspector, type InspectorTrackSummary } from "./components/track-inspector.js";
import { TopBar, type SaveState, type ViewMode } from "./components/top-bar.js";
import { SetTimeline, type SetTimelineMetric } from "./components/set-timeline.js";
import { EmptyState, Panel } from "./components/primitives.js";
import {
  listGraphs,
  createGraph,
  createTransition,
  suggestTransitions,
} from "./lib/graph-api.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 means "sign in", not "try again" — retrying just delays the
      // sign-in form and burns requests.
      retry: (failureCount, error) => !isUnauthenticated(error) && failureCount < 2,
      staleTime: 30_000,
    },
  },
});

/**
 * Session gate.
 *
 * There is no `/v1/me` endpoint yet, so authentication is probed by making a
 * real request and treating 401 as "signed out". Crude but honest: it tests
 * the thing that actually matters, which is whether the API will serve this
 * session. Replace with a dedicated endpoint when one exists (plan §8.1).
 */
function App() {
  const [sessionKey, setSessionKey] = useState(0);

  const { error, isPending } = useQuery({
    queryKey: ["session-probe", sessionKey],
    queryFn: () => listTracks({ limit: 1 }),
    retry: false,
  });

  const resetSession = () => {
    queryClient.clear();
    setSessionKey((key) => key + 1);
  };

  if (isPending) {
    return <EmptyState title="Loading…" />;
  }

  if (isUnauthenticated(error)) {
    return <SignIn onSignedIn={resetSession} />;
  }

  return <Workspace onSignOut={resetSession} />;
}

/**
 * Signed-in shell.
 *
 * Ensures a graph exists on first load — a canvas with no graph to render is
 * a dead end, and the user did not ask to manage graphs, they asked to plan a
 * set. Multiple named graphs come with the set/timeline work.
 */
function Workspace({ onSignOut }: { onSignOut: () => void }) {
  const [selected, setSelected] = useState<InspectorTrackSummary | null>(null);
  const [placedTracks, setPlacedTracks] = useState<InspectorTrackSummary[]>([]);
  const [view, setView] = useState<ViewMode>("graph");
  const [metric, setMetric] = useState<SetTimelineMetric>("energy");
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const [favourites, setFavourites] = useState<ReadonlySet<string>>(new Set());

  const { data: graph, isPending } = useQuery({
    queryKey: ["default-graph"],
    queryFn: async () => {
      const graphs = await listGraphs();
      return graphs[0] ?? (await createGraph("Untitled set"));
    },
  });

  // Suggestions are the one live thing the inspector shows, so they are
  // fetched here rather than inside it — the inspector stays a pure view.
  const { data: suggestions = [], isPending: isLoadingSuggestions } = useQuery({
    queryKey: ["suggestions", selected?.id],
    queryFn: () => suggestTransitions(selected!.id, 5),
    enabled: selected !== null,
  });

  // Promotes a suggestion into an authored transition. Real endpoint, so it
  // invalidates the graph and the scores that produced it.
  const addTransition = useMutation({
    mutationFn: (toTrackId: string) =>
      createTransition({ fromTrackId: selected!.id, toTrackId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
      void queryClient.invalidateQueries({ queryKey: ["suggestions"] });
    },
  });

  const placedTrackIds = useMemo(
    () => new Set(placedTracks.map((track) => track.id)),
    [placedTracks],
  );

  // Stable identity: `GraphCanvas` reports through an effect, and an inline
  // lambda here would re-run it on every keystroke elsewhere in the shell.
  const handleTracksChange = useCallback((tracks: InspectorTrackSummary[]) => {
    setPlacedTracks(tracks);
  }, []);

  const selectById = useCallback(
    (trackId: string) => {
      setSelected(placedTracks.find((track) => track.id === trackId) ?? null);
    },
    [placedTracks],
  );

  /**
   * Save state is derived from React Query's mutation traffic rather than
   * tracked by hand. The canvas already writes layout and transitions through
   * mutations, so "is anything in flight" is the honest answer to "is this
   * saved", and there is no second source of truth to drift.
   */
  const saveState: SaveState = useIsMutating() > 0 ? "saving" : "saved";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        setName={graph?.name ?? "Untitled set"}
        sets={graph ? [{ id: graph.id, name: graph.name }] : []}
        currentSetId={graph?.id}
        view={view}
        onViewChange={setView}
        saveState={saveState}
        bpm={averageBpm(placedTracks)}
        keySignature={null}
        canUndo={false}
        canRedo={false}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onSettings={() => undefined}
        onExport={() => undefined}
        onPlay={() => undefined}
        isPlaying={false}
        onSignOut={async () => {
          await signOut().catch(() => undefined);
          onSignOut();
        }}
      />

      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <LibraryPanel onAddTrack={selectById} placedTrackIds={placedTrackIds} />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Panel title="Graph" className="min-h-0 flex-1">
            <div className="relative min-h-0 flex-1">
              {isPending || !graph ? (
                <EmptyState title="Preparing canvas…" />
              ) : view === "graph" ? (
                <GraphCanvas
                  graphId={graph.id}
                  onSelect={setSelected}
                  onTracksChange={handleTracksChange}
                  selectedTrackId={selected?.id ?? null}
                />
              ) : (
                <EmptyState
                  title={view === "timeline" ? "Timeline view" : "List view"}
                  hint="Not built yet — the graph is the working view."
                />
              )}
            </div>
          </Panel>

          <div className={isTimelineExpanded ? "h-[300px] shrink-0" : "h-[190px] shrink-0"}>
            <SetTimeline
              tracks={placedTracks}
              selectedTrackId={selected?.id ?? null}
              onSelect={selectById}
              metric={metric}
              onMetricChange={setMetric}
              isExpanded={isTimelineExpanded}
              onToggleExpand={() => setIsTimelineExpanded((open) => !open)}
            />
          </div>
        </div>

        <TrackInspector
          track={selected}
          suggestions={suggestions}
          isLoadingSuggestions={selected !== null && isLoadingSuggestions}
          isFavourite={selected !== null && favourites.has(selected.id)}
          onToggleFavourite={(next) => {
            if (!selected) return;
            setFavourites((current) => {
              const updated = new Set(current);
              if (next) updated.add(selected.id);
              else updated.delete(selected.id);
              return updated;
            });
          }}
          onViewAllSuggestions={() => undefined}
          onAddTransition={
            selected ? (toTrackId) => addTransition.mutate(toTrackId) : undefined
          }
        />
      </main>
    </div>
  );
}

/** The set's working tempo. Null until at least one track reports a BPM. */
function averageBpm(tracks: InspectorTrackSummary[]): number | null {
  const values = tracks
    .map((track) => track.bpm)
    .filter((bpm): bpm is number => bpm !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, bpm) => sum + bpm, 0) / values.length;
}

/**
 * The root is cached on the container.
 *
 * Vite re-executes this module on every hot update, and a bare `createRoot`
 * call would mint a second root over the same node each time — React logs an
 * error and the old tree keeps running. Reusing the existing root makes HMR
 * behave like a re-render, which is the point of it.
 */
const container = document.getElementById("root")!;
type RootContainer = HTMLElement & { __flowgraphRoot?: ReturnType<typeof createRoot> };
const host = container as RootContainer;
host.__flowgraphRoot ??= createRoot(container);

host.__flowgraphRoot.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
