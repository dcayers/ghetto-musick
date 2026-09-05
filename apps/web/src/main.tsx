import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import "@xyflow/react/dist/style.css";
import "./styles/theme.css";

import { listTracks, listAllTracks, isUnauthenticated } from "./lib/api.js";
import { createGraph, getGraph, listGraphs } from "./lib/graph-api.js";
import { adaptGraph, adaptTrack } from "./lib/adapt.js";
import { SignIn } from "./components/sign-in.js";
import { WorkspaceLayout } from "./components/workspace-layout.js";
import { TopNav } from "./components/top-nav.js";
import { LibraryPanel } from "./components/library/library-panel.js";
import { GraphCanvas } from "./components/graph/graph-canvas.js";
import { SetTimeline } from "./components/set-timeline.js";
import { InspectorPanel } from "./components/inspector/inspector-panel.js";
import { EmptyState, Panel } from "./components/primitives.js";
import { useWorkspace } from "./state/workspace.js";

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
 * session.
 */
function App() {
  const [sessionKey, setSessionKey] = useState(0);

  const { error, isPending } = useQuery({
    queryKey: ["session-probe", sessionKey],
    queryFn: () => listTracks({ limit: 1 }),
    retry: false,
  });

  if (isPending) {
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState title="Loading workspace…" />
      </div>
    );
  }

  if (isUnauthenticated(error)) {
    return (
      <SignIn
        onSignedIn={() => {
          queryClient.clear();
          setSessionKey((key) => key + 1);
        }}
      />
    );
  }

  return <Workspace />;
}

const ACTION_CLASS =
  "bg-accent hover:bg-accent-hover rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60";
const QUIET_ACTION_CLASS =
  "border-border text-ink-muted hover:border-border-strong hover:text-ink rounded-md border px-3 py-1.5 text-xs font-medium";

/**
 * Chooses the workspace's data source.
 *
 * A workspace with a graph opens on it, live. A brand-new one has nothing to
 * open, so it is offered the two honest starting points: create a graph, or
 * look at the demo snapshot. The snapshot is never shown as though it were the
 * user's own data — taking it is a decision made here, on a screen that says
 * what it is.
 */
function Workspace() {
  const [useDemo, setUseDemo] = useState(false);
  const queryClient = useQueryClient();

  const graphs = useQuery({ queryKey: ["graphs"], queryFn: listGraphs });

  const create = useMutation({
    mutationFn: () => createGraph("Untitled graph"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["graphs"] }),
  });

  if (useDemo) return <WorkspaceShell />;

  if (graphs.isPending) {
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState title="Loading workspace…" />
      </div>
    );
  }

  if (graphs.isError) {
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState
          title="Could not load your graphs."
          hint={graphs.error instanceof Error ? graphs.error.message : undefined}
          actions={
            <button type="button" className={ACTION_CLASS} onClick={() => void graphs.refetch()}>
              Try again
            </button>
          }
        />
      </div>
    );
  }

  const first = graphs.data[0];
  if (first === undefined) {
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState
          title="This workspace has no graphs yet."
          hint="Create one to start planning, or open the demo to see a populated workspace. The demo is a fixed snapshot — nothing in it is saved."
          actions={
            <>
              <button
                type="button"
                className={ACTION_CLASS}
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Creating…" : "Create a graph"}
              </button>
              <button
                type="button"
                className={QUIET_ACTION_CLASS}
                onClick={() => setUseDemo(true)}
              >
                Open the demo
              </button>
            </>
          }
        />
      </div>
    );
  }

  return <LiveWorkspace graphId={first.id} />;
}

/**
 * Loads one graph and the track library, then hands both to the store.
 *
 * The shell is not rendered until the store actually holds live data. It would
 * otherwise mount against the demo snapshot for a frame and then swap, which
 * reads as the user's workspace briefly containing someone else's tracks.
 */
function LiveWorkspace({ graphId }: { graphId: string }) {
  const hydrateLive = useWorkspace((state) => state.hydrateLive);
  const source = useWorkspace((state) => state.source);
  const announce = useWorkspace((state) => state.announce);

  const graph = useQuery({ queryKey: ["graph", graphId], queryFn: () => getGraph(graphId) });
  const tracks = useQuery({ queryKey: ["tracks", "all"], queryFn: listAllTracks });

  const graphData = graph.data;
  const trackData = tracks.data;

  useEffect(() => {
    if (!graphData || !trackData) return;
    hydrateLive({
      graph: adaptGraph(graphData),
      tracks: trackData.items.map(adaptTrack),
    });
    if (trackData.truncated) {
      announce("Showing the first 2000 tracks — the library is longer than this view loads.");
    }
  }, [graphData, trackData, hydrateLive, announce]);

  const error = graph.error ?? tracks.error;
  if (error) {
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState
          title="Could not load the graph."
          hint={error instanceof Error ? error.message : undefined}
          actions={
            <button
              type="button"
              className={ACTION_CLASS}
              onClick={() => {
                void graph.refetch();
                void tracks.refetch();
              }}
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  if (source !== "live") {
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState title="Loading workspace…" />
      </div>
    );
  }

  return <WorkspaceShell />;
}

/** The four surfaces, over whichever source the store currently holds. */
function WorkspaceShell() {
  const view = useWorkspace((state) => state.view);

  return (
    <WorkspaceLayout
      nav={<TopNav />}
      library={<LibraryPanel />}
      graph={
        view === "graph" ? (
          <GraphCanvas />
        ) : (
          <Panel className="min-h-0" flush>
            <EmptyState
              title={view === "timeline" ? "Timeline view" : "List view"}
              hint="Not built yet — the graph is the working view. Switch back with the control in the top bar."
            />
          </Panel>
        )
      }
      timeline={<SetTimeline />}
      inspector={<InspectorPanel />}
    />
  );
}

/**
 * The root is cached on its container.
 *
 * Vite re-executes this module on every hot update, and a bare `createRoot`
 * would mint a second root over the same node each time — React logs an error
 * and the old tree keeps running. Reusing the root makes HMR behave like a
 * re-render, which is the point of it.
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
