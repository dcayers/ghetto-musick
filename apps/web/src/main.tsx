import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import "@xyflow/react/dist/style.css";
import "./styles/theme.css";

import { listTracks, isUnauthenticated } from "./lib/api.js";
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

/**
 * The signed-in workspace.
 *
 * The graph, library, timeline, and inspector all render the demo snapshot in
 * `lib/demo-data.ts` rather than the dev database. That is deliberate: the
 * showcase state this screen has to demonstrate — Innerbloom preselected, two
 * branch points with rejoins, a six-track set with a complete energy curve —
 * is not what the dev database contains, and a workspace that opens half-empty
 * cannot show the workflow it exists to show. The snapshot uses the same
 * domain shapes the API returns, so swapping the source is a change of
 * provider, not a rewrite.
 */
function Workspace() {
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
