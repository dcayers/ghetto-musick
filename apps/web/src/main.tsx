import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import "@xyflow/react/dist/style.css";
import "./styles/theme.css";

import { listTracks, isUnauthenticated, signOut } from "./lib/api.js";
import { SignIn } from "./components/sign-in.js";
import { LibraryPanel } from "./components/library-panel.js";
import { EmptyState, Panel } from "./components/primitives.js";

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

  return (
    <div className="flex h-full flex-col">
      <header className="border-border bg-surface flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-ink text-sm font-semibold">FlowGraph</span>
          <span className="text-ink-subtle text-xs">Untitled set</span>
        </div>
        <Button
          onPress={async () => {
            await signOut().catch(() => undefined);
            queryClient.clear();
            setSessionKey((key) => key + 1);
          }}
          className="text-ink-muted hover:text-ink text-xs"
        >
          Sign out
        </Button>
      </header>

      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <LibraryPanel />
        <Panel title="Graph" className="flex-1">
          <EmptyState
            title="The canvas lands next"
            hint="Graph and transition endpoints are the prerequisite."
          />
        </Panel>
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
