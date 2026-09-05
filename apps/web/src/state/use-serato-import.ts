import { useCallback, useState } from "react";

import { listAllTracks } from "../lib/api.js";
import { adaptTrack } from "../lib/adapt.js";
import { describeRun, importSerato } from "../lib/import-api.js";
import { useWorkspace } from "./workspace.js";

/**
 * Why the import controls are inert, when they are.
 *
 * The demo snapshot has nowhere to import *into* — it is a fixed dataset, not
 * a workspace — so saying that is better than a button that appears to work.
 */
export const DEMO_IMPORT_HINT =
  "The demo workspace is a fixed snapshot — sign in to a workspace of your own to import from Serato.";

export interface SeratoImport {
  readonly run: () => void;
  readonly isImporting: boolean;
  /** False in the demo workspace, where there is nothing to import into. */
  readonly isAvailable: boolean;
  /** Ready-made accessible name for whichever state the control is in. */
  readonly label: string;
}

/**
 * The Serato import, as one action two surfaces can offer.
 *
 * Both the library panel and the canvas empty state invite an import, and they
 * must agree on what it does, when it is unavailable, and what it announces.
 * Duplicating that produced two slightly different answers the first time.
 */
export function useSeratoImport(): SeratoImport {
  const source = useWorkspace((state) => state.source);
  const replaceTracks = useWorkspace((state) => state.replaceTracks);
  const announce = useWorkspace((state) => state.announce);

  const [isImporting, setIsImporting] = useState(false);
  const isAvailable = source === "live";

  const run = useCallback(() => {
    if (!isAvailable) {
      announce(DEMO_IMPORT_HINT);
      return;
    }
    if (isImporting) return;

    setIsImporting(true);
    announce("Reading your Serato library…");

    void (async () => {
      try {
        const result = await importSerato();
        // Re-read rather than trusting the summary: it counts rows, and the
        // library needs the rows. The import is idempotent, so a second press
        // is safe by design.
        const page = await listAllTracks();
        replaceTracks(page.items.map(adaptTrack));
        announce(describeRun(result));
      } catch (error) {
        announce(
          error instanceof Error ? error.message : "Could not read your Serato library.",
        );
      } finally {
        setIsImporting(false);
      }
    })();
  }, [isAvailable, isImporting, announce, replaceTracks]);

  const label = !isAvailable
    ? `Import from Serato. ${DEMO_IMPORT_HINT}`
    : isImporting
      ? "Reading your Serato library…"
      : "Import from Serato";

  return { run, isImporting, isAvailable, label };
}
