import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import "@xyflow/react/dist/style.css";
import "./styles/theme.css";

import { listTracks, isUnauthenticated, signOut } from "./lib/api.js";
import { SignIn } from "./components/sign-in.js";
import { LibraryPanel } from "./components/library-panel.js";
import { GraphCanvas } from "./components/graph-canvas.js";
import { Inspector, type InspectorTrack } from "./components/inspector.js";
import { EmptyState, Panel } from "./components/primitives.js";
import { listGraphs, createGraph } from "./lib/graph-api.js";

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

  if (isPending) {
    return <EmptyState title="Loading…" />;
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

  return <Workspace onSignOut={() => {
    queryClient.clear();
    setSessionKey((key) => key + 1);
  }} />;
}

/**
 * Signed-in shell.
 *
 * Ensures a graph exists on first load — a canvas with no graph to render is
 * a dead end, and the user did not ask to manage graphs, they asked to plan a
 * set. Multiple named graphs come with the set/timeline work.
 */
function Workspace({ onSignOut }: { onSignOut: () => void }) {
  const [selected, setSelected] = useState<InspectorTrack | null>(null);

  const { data: graphId, isPending } = useQuery({
    queryKey: ["default-graph"],
    queryFn: async () => {
      const graphs = await listGraphs();
      return (graphs[0] ?? (await createGraph("Untitled set"))).id;
    },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="border-border bg-surface flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-ink text-sm font-semibold">FlowGraph</span>
          <span className="text-ink-subtle text-xs">Untitled set</span>
        </div>
        <Button
          onPress={async () => {
            await signOut().catch(() => undefined);
            onSignOut();
          }}
          className="text-ink-muted hover:text-ink text-xs"
        >
          Sign out
        </Button>
      </header>

      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <LibraryPanel />
        <Panel title="Graph" className="min-w-0 flex-1">
          <div className="relative min-h-0 flex-1">
            {isPending || !graphId ? (
              <EmptyState title="Preparing canvas…" />
            ) : (
              <GraphCanvas graphId={graphId} onSelect={setSelected} />
            )}
          </div>
        </Panel>
        <Inspector track={selected} />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
