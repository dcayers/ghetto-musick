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

import {
  listTracks,
  listAllTracks,
  isUnauthenticated,
  isUnreachable,
  ApiError,
} from "./lib/api.js";
import { createGraph, getGraph, listGraphs } from "./lib/graph-api.js";
import { createSet, getSet, listSets } from "./lib/set-api.js";
import { adaptGraph, adaptSet, adaptTrack } from "./lib/adapt.js";
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
  // Held here rather than only in `Workspace`, because the screen that most
  // needs it is the one shown when the API cannot be reached at all — and that
  // screen renders before `Workspace` ever mounts.
  const [useDemo, setUseDemo] = useState(false);

  const { error, isPending } = useQuery({
    queryKey: ["session-probe", sessionKey],
    queryFn: () => listTracks({ limit: 1 }),
    retry: false,
  });

  if (useDemo) return <WorkspaceShell />;

  if (isPending) {
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState title="Loading workspace…" />
      </div>
    );
  }

  const signIn = (
    <SignIn
      onSignedIn={() => {
        queryClient.clear();
        setSessionKey((key) => key + 1);
      }}
    />
  );

  if (isUnauthenticated(error)) return signIn;

  /*
   * The API is not answering.
   *
   * Without this branch the probe falls through on any non-401 and the next
   * screen blames the graphs — "Could not load your graphs" — for a server
   * that is not running. The status code was being discarded, so the one fact
   * that explains the failure never reached the person reading it.
   */
  if (isUnreachable(error)) {
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState
          title="Can't reach the FlowGraph API."
          hint={
            error instanceof ApiError
              ? `The server answered ${error.status}. Check that it is running, then try again.`
              : "No response from the server. Check that it is running, then try again."
          }
          actions={
            <>
              <button
                type="button"
                className={ACTION_CLASS}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["session-probe"] })}
              >
                Try again
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

  return (
    <Workspace
      onSessionExpired={() => {
        queryClient.clear();
        setSessionKey((key) => key + 1);
      }}
    />
  );
}

const ACTION_CLASS =
  "bg-accent-strong hover:bg-accent rounded-md px-3 py-1.5 text-body font-medium text-white disabled:opacity-60";
const QUIET_ACTION_CLASS =
  "border-border text-ink-muted hover:border-border-strong hover:text-ink rounded-md border px-3 py-1.5 text-body font-medium";

/**
 * Chooses the workspace's data source.
 *
 * A workspace with a graph opens on it, live. A brand-new one has nothing to
 * open, so it is offered the two honest starting points: create a graph, or
 * look at the demo snapshot. The snapshot is never shown as though it were the
 * user's own data — taking it is a decision made here, on a screen that says
 * what it is.
 */
function Workspace({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [useDemo, setUseDemo] = useState(false);
  const queryClient = useQueryClient();

  const graphs = useQuery({ queryKey: ["graphs"], queryFn: listGraphs });

  /**
   * Creating a workspace creates both halves of it.
   *
   * A graph with no set leaves the timeline permanently empty with no way to
   * fill it, which is the dead end this whole screen exists to avoid. The set
   * is created first so a failure leaves nothing rather than an orphan graph.
   */
  const create = useMutation({
    mutationFn: async () => {
      await createSet({ name: "Untitled set" });
      return createGraph("Untitled graph");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["graphs"] });
      await queryClient.invalidateQueries({ queryKey: ["set", "active"] });
    },
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
    /*
     * The session gate runs once, on mount. A session that expires after it
     * passed surfaces here instead, and "Try again" can never recover from it —
     * every retry is another 401. Offering the sign-in form is the only exit.
     */
    if (isUnauthenticated(graphs.error)) {
      return (
        <div className="grid h-screen place-items-center">
          <EmptyState
            title="Your session expired."
            hint="Sign in again to get back to your workspace. Nothing was lost."
            actions={
              <button type="button" className={ACTION_CLASS} onClick={onSessionExpired}>
                Sign in again
              </button>
            }
          />
        </div>
      );
    }

    const unreachable = isUnreachable(graphs.error);
    return (
      <div className="grid h-screen place-items-center">
        <EmptyState
          // Naming the server rather than the data: with the API down, "could
          // not load your graphs" sends the DJ looking for a problem with their
          // graphs, which is the one place the problem is not.
          title={unreachable ? "Can't reach the FlowGraph API." : "Could not load your graphs."}
          hint={
            unreachable
              ? graphs.error instanceof ApiError
                ? `The server answered ${graphs.error.status}. Check that it is running, then try again.`
                : "No response from the server. Check that it is running, then try again."
              : graphs.error instanceof Error
                ? graphs.error.message
                : undefined
          }
          actions={
            <>
              <button type="button" className={ACTION_CLASS} onClick={() => void graphs.refetch()}>
                Try again
              </button>
              {/* The demo needs no API, so it stays reachable exactly when
                  everything else is not. */}
              <button type="button" className={QUIET_ACTION_CLASS} onClick={() => setUseDemo(true)}>
                Open the demo
              </button>
            </>
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

  /**
   * The set, resolved in one query.
   *
   * A workspace may legitimately have no set, and that is a value rather than
   * an error — `null` flows through to an empty timeline that says so. Only
   * the first set is opened; a set switcher is a separate piece of work, and
   * the top bar already has the control for it disabled.
   */
  const setQuery = useQuery({
    queryKey: ["set", "active"],
    queryFn: async () => {
      const sets = await listSets();
      const first = sets[0];
      return first ? await getSet(first.id) : null;
    },
  });

  const graphData = graph.data;
  const trackData = tracks.data;
  const setData = setQuery.data;
  const setLoaded = setQuery.isSuccess;

  useEffect(() => {
    if (!graphData || !trackData || !setLoaded) return;
    hydrateLive({
      graph: adaptGraph(graphData),
      tracks: trackData.items.map(adaptTrack),
      set: setData ? adaptSet(setData) : null,
    });
    if (trackData.truncated) {
      announce("Showing the first 2000 tracks — the library is longer than this view loads.");
    }
  }, [graphData, trackData, setData, setLoaded, hydrateLive, announce]);

  const error = graph.error ?? tracks.error ?? setQuery.error;
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
                void setQuery.refetch();
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
