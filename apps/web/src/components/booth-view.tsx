import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { ArrowRight, X } from "lucide-react";
import { Artwork, Bpm, CamelotKey, EnergyDots, Truncate, cx } from "./primitives.js";
import { Pill } from "./ui.js";
import { TECHNIQUE_COLOR, setTrackIds, techniqueSpec } from "../lib/workspace-data.js";
import type { WorkspaceTrack, WorkspaceTransition } from "../lib/workspace-data.js";
import { useWorkspace } from "../state/workspace.js";

/**
 * The booth.
 *
 * PRODUCT.md confirms four usage scenes, and this one is unlike the other
 * three: a dark room, arm's length or further, a mix running, and roughly
 * twenty seconds of divided attention. The DJ has exactly one question —
 * what comes next, and how do I get there — so that is the only thing on
 * screen. The library, the graph, the inspector and the filters are all gone.
 *
 * It is deliberately the *set* made large rather than a second workspace.
 * PRODUCT.md records whether the booth deserves a dedicated interface as an
 * open decision, and this must not answer it by accident: this is the running
 * order at reading distance, entered from the timeline and left with Escape.
 *
 * Position is session-local. There is no `played` column in the schema, and
 * inventing one here would put a fact in the UI that nothing can persist.
 */

export function BoothView({ onExit }: { onExit: () => void }) {
  const set = useWorkspace((state) => state.set);
  const tracks = useWorkspace((state) => state.tracks);
  const transitions = useWorkspace((state) => state.transitions);
  const announce = useWorkspace((state) => state.announce);

  const order = setTrackIds(set);
  const [index, setIndex] = useState(0);
  /**
   * The track playing when it is not the one at `index`.
   *
   * Transitions are workspace-level, so an authored route routinely points at
   * a track that is not in the running order. Taking one of those means the
   * set no longer describes what is happening, and the honest representation
   * is to name the track directly rather than keep pointing at a position
   * that has stopped being true.
   */
  const [offPlanId, setOffPlanId] = useState<string | null>(null);
  /** A route the DJ chose instead of the planned one, by transition id. */
  const [tookInstead, setTookInstead] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const advanceRef = useRef<HTMLButtonElement>(null);

  /*
   * The density mode is the whole reason the type scale became tokens.
   * Setting it on the root element re-sizes every role at once, and removing
   * it on the way out is what keeps the desk unaffected.
   */
  useEffect(() => {
    document.documentElement.setAttribute("data-density", "booth");
    return () => document.documentElement.removeAttribute("data-density");
  }, []);

  /*
   * Focus moves in, and goes back where it came from on the way out.
   *
   * This covers the whole viewport, so leaving focus on the timeline control
   * that opened it would leave a keyboard user tabbing through a surface they
   * cannot see.
   */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const currentId = offPlanId ?? order[index];
  const current = currentId ? trackById.get(currentId) : undefined;

  // Every authored route out of the track that is playing. Keyed by
  // transition id rather than by target, because two techniques into the same
  // track are two different routes — that is what the graph is for.
  const routes = currentId ? transitions.filter((tx) => tx.sourceTrackId === currentId) : [];
  const plannedId = offPlanId === null ? order[index + 1] : undefined;
  const planned = routes.find((tx) => tx.targetTrackId === plannedId) ?? null;
  const route = tookInstead === null ? planned : (routes.find((tx) => tx.id === tookInstead) ?? null);
  const target = route ? trackById.get(route.targetTrackId) : undefined;
  const alternates = routes.filter((tx) => tx.id !== route?.id);

  const advance = () => {
    // A chosen route always wins, whether or not its target sits in the set.
    // The previous version only handled the in-set case and fell through to
    // index + 1 otherwise, which advanced to the track the DJ did not play.
    if (route !== null && tookInstead !== null) {
      const taken = route.targetTrackId;
      const moved = order.indexOf(taken);
      setTookInstead(null);
      if (moved === -1) {
        setOffPlanId(taken);
      } else {
        setOffPlanId(null);
        setIndex(moved);
      }
      announce(`Now playing ${trackById.get(taken)?.title ?? "the next track"}.`);
      return;
    }

    if (offPlanId !== null) {
      // Off plan with no chosen route: there is nothing to advance to, because
      // the running order stopped describing this set two tracks ago.
      announce("Off the running order — pick a route to carry on.");
      return;
    }

    if (index + 1 >= order.length) {
      announce("That was the last track in the set.");
      return;
    }
    setIndex(index + 1);
    announce(`Now playing ${trackById.get(order[index + 1]!)?.title ?? "the next track"}.`);
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-label={`Booth view — ${set.name}`}
      className="bg-canvas fixed inset-0 z-50 flex flex-col outline-none"
    >
      <header className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-ink text-title font-semibold">{set.name}</span>
          <Pill tone={offPlanId === null ? "neutral" : "warn"}>
            {order.length === 0
              ? "Empty set"
              : offPlanId !== null
                ? "Off plan"
                : `${index + 1} of ${order.length}`}
          </Pill>
        </div>
        <Button
          onPress={onExit}
          // The visible word leads the accessible name so voice control
          // ("click Exit") still targets it — WCAG 2.5.3.
          aria-label="Exit booth view"
          className="text-ink-muted hover:bg-surface-hover hover:text-ink rounded-control flex items-center gap-1.5 px-2.5 py-1.5 text-body"
        >
          <X size={16} aria-hidden="true" />
          Exit
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 px-6 py-6">
        {current === undefined ? (
          <p className="text-ink-muted text-center text-title">
            This set has no tracks yet. Build it at the desk first.
          </p>
        ) : (
          <>
            <NowPlaying track={current} />

            {target === undefined ? (
              <p className="text-ink-muted text-center text-body">
                {routes.length === 0
                  ? "No route authored out of this track. You are on your own for this one."
                  : "Nothing queued after this. Pick a route below."}
              </p>
            ) : (
              <>
                <RouteLine route={route} />
                <UpNext track={target} isBranch={tookInstead !== null} />
              </>
            )}

            <div className="flex justify-center">
              {/* One control, sized to be hit without looking. */}
              <Button
                ref={advanceRef}
                onPress={advance}
                className="bg-accent-strong hover:bg-accent-strong/90 rounded-card flex items-center gap-2 px-6 py-3 text-title font-medium text-white transition-colors"
              >
                Played it
                <ArrowRight size={18} aria-hidden="true" />
              </Button>
            </div>

            {alternates.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <p id="booth-alternates" className="text-ink-subtle text-section font-medium uppercase">
                  Or take a different route
                </p>
                <div
                  className="flex flex-wrap justify-center gap-2"
                  role="group"
                  aria-labelledby="booth-alternates"
                >
                  {alternates.map((tx) => {
                    const to = trackById.get(tx.targetTrackId);
                    if (!to) return null;
                    const spec = techniqueSpec(tx.technique);
                    return (
                      <Button
                        key={tx.id}
                        onPress={() => {
                          setTookInstead(tx.id);
                          announce(`Next up ${to.title}, via ${spec.label}.`);
                          // This button is about to be re-rendered as the
                          // planned route and this one unmounted, so focus is
                          // handed to the action that follows rather than
                          // dropped to the body.
                          advanceRef.current?.focus();
                        }}
                        // Names the action, not just the destination: "The
                        // Less I Know, Reverb tail" tells a screen-reader user
                        // nothing about what pressing it does.
                        aria-label={`Take ${spec.label} into ${to.title} instead`}
                        className="border-border-strong hover:border-accent/60 hover:bg-surface-hover rounded-control flex items-center gap-2 border px-3 py-2 text-body transition-colors"
                      >
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: TECHNIQUE_COLOR[spec.family] }}
                        />
                        <span className="text-ink">{to.title}</span>
                        <span className="text-ink-muted">{spec.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ parts -- */

function NowPlaying({ track }: { track: WorkspaceTrack }) {
  return (
    <section className="flex items-center justify-center gap-4">
      <Artwork seed={track.id} size={56} />
      <div className="min-w-0">
        <p className="text-ink-subtle text-section font-medium uppercase">Now playing</p>
        <Truncate className="text-ink text-title font-medium">{track.title}</Truncate>
        <Truncate className="text-ink-muted text-label">{track.artist}</Truncate>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Bpm value={track.bpm} />
        <CamelotKey value={track.keySignature} />
        <EnergyDots value={track.energy} size={8} />
      </div>
    </section>
  );
}

/**
 * The transition itself, at reading size.
 *
 * This is the half the desk interface hides in an inspector — PRODUCT.md
 * Principle 2 says the transition is the unit of value, and the booth is where
 * that is literally true: the technique and the bar count are the instruction.
 */
function RouteLine({ route }: { route: WorkspaceTransition | null }) {
  if (route === null) {
    return (
      <p className="text-warn text-center text-body">
        No transition authored for this pair — you are on your own for this one.
      </p>
    );
  }
  const spec = techniqueSpec(route.technique);
  // `bars` is null on a live transition (no column yet) and NaN in the demo
  // snapshot's explicit "unset" marker, so both spell the same em dash.
  const bars = route.bars === null || Number.isNaN(route.bars) ? "— bars" : `${route.bars} bars`;
  return (
    <section className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="h-0.5 w-10 rounded-full"
          style={{ background: TECHNIQUE_COLOR[spec.family] }}
        />
        <span className="text-ink text-title font-medium">{spec.label}</span>
        <span className="text-ink-muted text-body">{bars}</span>
      </div>
      {route.warnings.length > 0 && (
        <p className="text-warn text-label">{route.warnings.join(" · ")}</p>
      )}
    </section>
  );
}

function UpNext({ track, isBranch }: { track: WorkspaceTrack; isBranch: boolean }) {
  return (
    <section
      className={cx(
        "rounded-card mx-auto flex w-full max-w-lg items-center gap-4 border px-4 py-4",
        isBranch ? "border-accent bg-surface-selected" : "border-border-strong bg-surface-card",
      )}
    >
      <Artwork seed={track.id} size={72} />
      <div className="min-w-0 flex-1">
        <p className="text-ink-subtle text-section font-medium uppercase">
          {isBranch ? "Up next — branch" : "Up next"}
        </p>
        <Truncate className="text-ink text-headline font-semibold">{track.title}</Truncate>
        <Truncate className="text-ink-muted text-body">{track.artist}</Truncate>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Bpm value={track.bpm} />
        <CamelotKey value={track.keySignature} />
        <EnergyDots value={track.energy} size={8} />
      </div>
    </section>
  );
}
