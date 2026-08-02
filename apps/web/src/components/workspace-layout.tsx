import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { Library, ListOrdered, Share2, SlidersHorizontal } from "lucide-react";
import { cx } from "./primitives.js";
import { IconButton } from "./ui.js";
import {
  PANEL_LIMITS,
  useWorkspace,
  type PanelKey,
  type PanelState,
} from "../state/workspace.js";

/**
 * The workspace shell.
 *
 * Takes the five surfaces as slots and imports none of them: the shell decides
 * where things sit and how big they are, the panels decide what is in them.
 * That separation is what lets the same library render as a column, a drawer,
 * and a tab without knowing which it is.
 *
 * Sizes live in the store rather than here so a resize survives a remount and
 * so the layout is one persisted write instead of three.
 */

export interface WorkspaceLayoutProps {
  nav: ReactNode;
  library: ReactNode;
  graph: ReactNode;
  timeline: ReactNode;
  inspector: ReactNode;
}

type Surfaces = Omit<WorkspaceLayoutProps, "nav">;

/**
 * Grid, not flex, for a slot's wrapper: a lone grid item stretches to its cell,
 * so an opaque `ReactNode` fills the space without the shell reaching inside it
 * to add `flex-1`. The explicit `minmax(0, 1fr)` tracks stop a wide table or a
 * long title from forcing the cell past its share.
 */
const SLOT = "grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]";

const PANEL_META: Readonly<
  Record<PanelKey, { label: string; noun: string; icon: typeof Library }>
> = {
  library: { label: "Library", noun: "library", icon: Library },
  inspector: { label: "Inspector", noun: "inspector", icon: SlidersHorizontal },
  timeline: { label: "Set timeline", noun: "set timeline", icon: ListOrdered },
};

export function WorkspaceLayout({
  nav,
  library,
  graph,
  timeline,
  inspector,
}: WorkspaceLayoutProps): JSX.Element {
  const mode = useLayoutMode();
  const surfaces = { library, graph, timeline, inspector };

  return (
    // §2: the shell is the viewport. Nothing outside a panel ever scrolls.
    <div className="bg-canvas flex h-screen flex-col overflow-hidden">
      <div className="shrink-0">{nav}</div>

      {mode === "compact" ? (
        <CompactLayout {...surfaces} />
      ) : mode === "medium" ? (
        <MediumLayout {...surfaces} />
      ) : (
        <WideLayout {...surfaces} />
      )}

      <StatusRegion />
    </div>
  );
}

/* ------------------------------------------------------------ breakpoints -- */

/**
 * Tailwind's own `md` and `xl`, read through `matchMedia`.
 *
 * The three regimes differ in *behaviour*, not just in styling — tabs, then a
 * rail plus a scrimmed drawer, then columns with draggable separators — and
 * each slot has to mount exactly once (three mounted graph canvases is three
 * React Flow instances). CSS alone would either duplicate the slots or leave
 * controls wired to the wrong regime, so the breakpoint is read here and one
 * arrangement is rendered. `matchMedia` evaluates the same query the stylesheet
 * does, so the two can never disagree; no element is ever measured.
 */
function useLayoutMode(): "compact" | "medium" | "wide" {
  const isMedium = useMediaQuery("(min-width: 48rem)");
  const isWide = useMediaQuery("(min-width: 80rem)");
  return isWide ? "wide" : isMedium ? "medium" : "compact";
}

function useMediaQuery(query: string): boolean {
  const list = useMemo(() => window.matchMedia(query), [query]);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      list.addEventListener("change", onStoreChange);
      return () => list.removeEventListener("change", onStoreChange);
    },
    [list],
  );
  return useSyncExternalStore(subscribe, () => list.matches);
}

/* -------------------------------------------------------------- wide (xl) -- */

/**
 * A hidden panel's track.
 *
 * `auto` rather than `0` because §2 also asks for a restore rail where the
 * panel was, and a rail in a zero-width column is a rail nobody can press. The
 * panel's *size* contributes nothing; the column shrinks to the rail.
 */
function track(panel: PanelState): string {
  return panel.visible ? `${panel.size}px` : "auto";
}

function WideLayout({ library, graph, timeline, inspector }: Surfaces) {
  const panels = useWorkspace((state) => state.panels);

  return (
    <div
      className="grid min-h-0 flex-1 gap-2 p-2"
      style={{
        gridTemplateColumns: `${track(panels.library)} minmax(0, 1fr) ${track(panels.inspector)}`,
        gridTemplateRows: `minmax(0, 1fr) ${track(panels.timeline)}`,
      }}
    >
      <div className={cx(SLOT, "relative col-start-1 row-start-1 row-span-2")}>
        {panels.library.visible ? (
          <>
            {library}
            <Resizer
              panel="library"
              axis="x"
              className="absolute top-0 -right-[7px] h-full w-1.5"
            />
          </>
        ) : (
          <Rail panel="library" />
        )}
      </div>

      <div className={cx(SLOT, "col-start-2 row-start-1")}>{graph}</div>

      <div className={cx(SLOT, "relative col-start-2 row-start-2")}>
        {panels.timeline.visible ? (
          <>
            {timeline}
            <Resizer
              panel="timeline"
              axis="y"
              invert
              className="absolute -top-[7px] left-0 h-1.5 w-full"
            />
          </>
        ) : (
          <Rail panel="timeline" />
        )}
      </div>

      <div className={cx(SLOT, "relative col-start-3 row-start-1 row-span-2")}>
        {panels.inspector.visible ? (
          <>
            {inspector}
            <Resizer
              panel="inspector"
              axis="x"
              invert
              className="absolute top-0 -left-[7px] h-full w-1.5"
            />
          </>
        ) : (
          <Rail panel="inspector" />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- medium (md–xl) -- */

/**
 * Tablet width: rails either side, graph dominant, inspector on top.
 *
 * Drawer state is local rather than `panels[key].visible` on purpose. `visible`
 * is a persisted preference for the three-column desktop, and reusing it here
 * would open the inspector over the graph on first load — the opposite of what
 * §16 asks for — and would silently rewrite the desktop layout every time
 * someone peeked at a panel on a tablet.
 */
function MediumLayout({ library, graph, timeline, inspector }: Surfaces) {
  const panels = useWorkspace((state) => state.panels);
  const [drawer, setDrawer] = useState<"library" | "inspector" | null>(null);

  return (
    <div
      className="relative grid min-h-0 flex-1 gap-2 p-2"
      style={{
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gridTemplateRows: `minmax(0, 1fr) ${track(panels.timeline)}`,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drawer !== null) {
          event.stopPropagation();
          setDrawer(null);
        }
      }}
    >
      <div className="col-start-1 row-start-1 row-span-2 grid">
        <DrawerRail panel="library" onPress={() => setDrawer("library")} />
      </div>

      <div className={cx(SLOT, "col-start-2 row-start-1")}>{graph}</div>

      <div className={cx(SLOT, "relative col-start-2 row-start-2")}>
        {panels.timeline.visible ? (
          <>
            {timeline}
            <Resizer
              panel="timeline"
              axis="y"
              invert
              className="absolute -top-[7px] left-0 h-1.5 w-full"
            />
          </>
        ) : (
          <Rail panel="timeline" />
        )}
      </div>

      <div className="col-start-3 row-start-1 row-span-2 grid">
        <DrawerRail panel="inspector" onPress={() => setDrawer("inspector")} />
      </div>

      {drawer !== null && (
        <>
          {/* A real button, not a div with a click handler: dismissing the
              drawer has to be reachable without a pointer, and the scrim is
              the only thing between the drawer and the graph. */}
          <Button
            onPress={() => setDrawer(null)}
            aria-label={`Close ${PANEL_META[drawer].noun}`}
            className="bg-canvas/70 absolute inset-0 z-20 cursor-default backdrop-blur-[1px]"
          />
          <aside
            className={cx(
              SLOT,
              "absolute inset-y-2 z-30 max-w-[85vw]",
              drawer === "library" ? "left-2" : "right-2",
            )}
            style={{ width: panels[drawer].size }}
          >
            {drawer === "library" ? library : inspector}
          </aside>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------- compact (< md) -- */

type SurfaceTab = "library" | "graph" | "inspector" | "set";

const SURFACES: ReadonlyArray<{ id: SurfaceTab; label: string; icon: typeof Library }> = [
  { id: "library", label: "Library", icon: Library },
  { id: "graph", label: "Graph", icon: Share2 },
  { id: "inspector", label: "Inspector", icon: SlidersHorizontal },
  { id: "set", label: "Set", icon: ListOrdered },
];

function isSurfaceTab(value: string): value is SurfaceTab {
  return SURFACES.some((surface) => surface.id === value);
}

/**
 * Phone width: one surface at a time.
 *
 * Every panel stays mounted (`shouldForceMount`) and is hidden rather than
 * unmounted, so switching tabs does not throw away the graph viewport or a
 * scrolled library. React Aria marks the inactive ones `inert`, which keeps
 * them out of the tab order while they are off screen.
 *
 * `panels[key].visible` is ignored here — it describes the desktop column
 * layout, and a collapsed desktop inspector is no reason to remove the only
 * way to reach the inspector on a phone.
 */
function CompactLayout({ library, graph, timeline, inspector }: Surfaces) {
  const [tab, setTab] = useState<SurfaceTab>("graph");
  const content: Record<SurfaceTab, ReactNode> = {
    library,
    graph,
    inspector,
    set: timeline,
  };

  return (
    <Tabs
      selectedKey={tab}
      onSelectionChange={(key) => {
        const next = String(key);
        if (isSurfaceTab(next)) setTab(next);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="relative min-h-0 flex-1">
        {SURFACES.map(({ id }) => (
          <TabPanel
            key={id}
            id={id}
            shouldForceMount
            // Visibility is decided from our own state rather than from a
            // `data-inert:hidden` variant, so it never depends on which of
            // `grid` and `hidden` Tailwind happens to emit last.
            className={cx(
              "absolute inset-2 min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]",
              tab === id ? "grid" : "hidden",
            )}
          >
            {content[id]}
          </TabPanel>
        ))}
      </div>

      <TabList
        aria-label="Workspace surface"
        className="border-border bg-surface flex shrink-0 items-stretch border-t"
        // Home indicators and rounded corners eat the bottom row of a
        // full-bleed bar. Padding, not a fixed offset, so it costs nothing on
        // hardware without an inset.
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        {SURFACES.map(({ id, label, icon: Icon }) => (
          <Tab
            key={id}
            id={id}
            className={({ isSelected }) =>
              cx(
                "flex flex-1 cursor-pointer flex-col items-center gap-1 pt-1.5 pb-2 text-[11px] transition-colors",
                isSelected ? "text-accent" : "text-ink-muted",
              )
            }
          >
            {({ isSelected }) => (
              <>
                {/* The bar is the state cue; the colour only reinforces it.
                    §17 forbids hue as the sole difference between tabs. */}
                <span
                  aria-hidden="true"
                  className={cx(
                    "h-0.5 w-6 rounded-full",
                    isSelected ? "bg-accent" : "bg-transparent",
                  )}
                />
                <Icon size={17} aria-hidden="true" />
                {label}
              </>
            )}
          </Tab>
        ))}
      </TabList>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ rails -- */

/** Restores a collapsed panel to its column. */
function Rail({ panel }: { panel: PanelKey }) {
  const togglePanel = useWorkspace((state) => state.togglePanel);
  const announce = useWorkspace((state) => state.announce);
  const meta = PANEL_META[panel];

  return (
    <RailShell horizontal={panel === "timeline"}>
      <IconButton
        icon={meta.icon}
        label={`Show ${meta.noun}`}
        onPress={() => {
          togglePanel(panel);
          announce(`${meta.label} shown`);
        }}
      />
    </RailShell>
  );
}

/** The md–xl variant: opens the panel over the graph instead of beside it. */
function DrawerRail({ panel, onPress }: { panel: "library" | "inspector"; onPress: () => void }) {
  const meta = PANEL_META[panel];
  return (
    <RailShell horizontal={false}>
      <IconButton icon={meta.icon} label={`Open ${meta.noun}`} onPress={onPress} />
    </RailShell>
  );
}

function RailShell({ horizontal, children }: { horizontal: boolean; children: ReactNode }) {
  return (
    <div
      className={cx(
        // Same chrome as `Panel`, so a collapsed panel still reads as part of
        // the workspace rather than as a gap with a button in it.
        "border-border bg-surface rounded-panel flex items-center justify-center border",
        horizontal ? "h-10 w-full" : "h-full w-10",
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- resizers -- */

const NUDGE = 16;

interface ResizerProps {
  panel: PanelKey;
  /** Which pointer axis the drag reads. */
  axis: "x" | "y";
  /** Set when moving along the axis should *shrink* the panel — true for the
      panels that sit to the right of and below their separator. */
  invert?: boolean | undefined;
  className: string;
}

/**
 * A window splitter.
 *
 * `role="separator"` with a value and a tab stop, not a `Button`: this is the
 * ARIA window-splitter pattern, and a button would announce an action it does
 * not have. Keyboard operation is not a nicety — a separator that only responds
 * to a drag is unusable without a pointer (§17).
 *
 * The gesture never reads layout. The pointer origin and the panel's size are
 * captured on pointerdown and every subsequent position is resolved against
 * those, which also means the panel cannot drift when the clamp in the store
 * bites at a limit and then the pointer comes back.
 */
function Resizer({ panel, axis, invert = false, className }: ResizerProps) {
  const size = useWorkspace((state) => state.panels[panel].size);
  const setPanelSize = useWorkspace((state) => state.setPanelSize);
  const [isDragging, setIsDragging] = useState(false);
  const origin = useRef<{ at: number; size: number } | null>(null);
  const limits = PANEL_LIMITS[panel];
  const meta = PANEL_META[panel];

  const position = (event: ReactPointerEvent<HTMLDivElement>) =>
    axis === "x" ? event.clientX : event.clientY;

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (origin.current === null) return;
    origin.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        next = size + (invert ? NUDGE : -NUDGE);
        break;
      case "ArrowRight":
      case "ArrowDown":
        next = size + (invert ? -NUDGE : NUDGE);
        break;
      case "Home":
        next = limits.min;
        break;
      case "End":
        next = limits.max;
        break;
      default:
        return;
    }
    event.preventDefault();
    setPanelSize(panel, next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${meta.noun}`}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={size}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      // A bare number is read as "280" with no unit; the text says what it is.
      aria-valuetext={`${size} pixels`}
      data-dragging={isDragging || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Otherwise the drag paints a selection across both panels.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { at: position(event), size };
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        const start = origin.current;
        if (start === null) return;
        const delta = position(event) - start.at;
        setPanelSize(panel, start.size + (invert ? -delta : delta));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      // Double-click restores the default width, which is the only cheap way
      // back from a drag that went somewhere silly.
      onDoubleClick={() => setPanelSize(panel, limits.initial)}
      className={cx(
        "group z-10 flex touch-none items-center justify-center",
        axis === "x" ? "cursor-col-resize" : "cursor-row-resize",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          // Invisible until pointed at, so three permanent lines do not divide
          // the workspace into boxes — but discoverable the moment you go near.
          "group-hover:bg-accent/60 group-data-[dragging]:bg-accent rounded-full bg-transparent transition-colors",
          axis === "x" ? "h-full w-0.5" : "h-0.5 w-full",
        )}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- status -- */

/**
 * The single live region.
 *
 * One per document, mounted for the life of the app: a region added at the same
 * time as its text is not announced, so every `announce()` has to land in a node
 * that was already there (§17).
 */
function StatusRegion() {
  const status = useWorkspace((state) => state.status);
  const statusId = useWorkspace((state) => state.statusId);
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {/* Keyed on the announce counter, not the message. A live region only
          speaks when its content changes, so pressing the same inert control
          twice used to be silent — the second announce wrote an equal string
          and the text node never mutated. Re-keying mounts a fresh node. */}
      <span key={statusId}>{status}</span>
    </div>
  );
}
