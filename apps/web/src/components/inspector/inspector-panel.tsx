import { MousePointerSquareDashed, PanelRightClose } from "lucide-react";
import { Panel, EmptyState, Skeleton } from "../primitives.js";
import { IconButton } from "../ui.js";
import { TrackInspector } from "./track-inspector.js";
import { TransitionInspector } from "./transition-inspector.js";
import { useWorkspace } from "../../state/workspace.js";
import { trackById } from "../../lib/demo-data.js";

/**
 * The right column.
 *
 * Selecting an edge replaces the track details entirely rather than appending
 * a section (§10) — a transition is a different subject, not an attribute of
 * the track, and showing both at once is what makes an inspector feel like a
 * dump rather than a view of the thing you selected.
 */
export function InspectorPanel({ isLoading = false }: { isLoading?: boolean }) {
  const selection = useWorkspace((state) => state.selection);
  const transitions = useWorkspace((state) => state.transitions);
  const togglePanel = useWorkspace((state) => state.togglePanel);

  const transition =
    selection?.kind === "transition"
      ? (transitions.find((tx) => tx.id === selection.transitionId) ?? null)
      : null;
  const track = selection?.kind === "track" ? trackById(selection.trackId) : null;

  return (
    <Panel
      title="Inspector"
      className="min-h-0"
      actions={
        // The layout leaves a restore rail behind; without this the rail can
        // never be reached in the first place.
        <IconButton
          icon={PanelRightClose}
          label="Hide inspector"
          size={14}
          onPress={() => togglePanel("inspector")}
        />
      }
    >
      {isLoading ? (
        <InspectorSkeleton />
      ) : transition ? (
        <TransitionInspector transition={transition} />
      ) : track ? (
        <TrackInspector track={track} />
      ) : (
        <EmptyState
          icon={<MousePointerSquareDashed size={22} aria-hidden="true" />}
          title="Select a track or transition"
          hint="Choosing a track opens its metadata, waveform, hot cues, and stems. Choosing a transition opens its technique, cue points, and compatibility."
        />
      )}
    </Panel>
  );
}

/**
 * Matches the loaded inspector's dimensions — §11 requires skeletons that do
 * not collapse the panel or shift layout when the real content arrives.
 */
function InspectorSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-3" aria-busy="true">
      <div className="flex items-start gap-3">
        <Skeleton className="size-12 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="mt-4 h-[72px] w-full" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}
