import { useEffect, useRef } from "react";
import { Button, Toolbar } from "react-aria-components";
import {
  Hand,
  Link2,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Spline,
  SquareDashed,
} from "lucide-react";
import { cx } from "./primitives.js";
import { IconButton } from "./ui.js";

/**
 * Canvas chrome — the tool rail and the zoom cluster that float over the graph.
 *
 * Neither reads from `lib/mock.ts`: the active tool and the zoom level are real
 * client state owned by the canvas, so there is no `DemoBadge` here. What the
 * tools *do* once selected is the parent's problem, which is why every action
 * is a callback rather than something this file performs.
 *
 * Positioning is deliberately absent. The canvas owns its own stacking and
 * insets (React Flow's `Panel`, an absolutely positioned wrapper, whatever it
 * ends up being), so both components take a `className` and merge it.
 */

export type CanvasTool = "select" | "pan" | "box-select" | "connect" | "link";

/** One surface treatment for both floating clusters, rather than two copies. */
const FLOATING_CHROME =
  "border-border bg-surface flex gap-0.5 rounded-lg border p-1 shadow-lg shadow-black/30";

interface ToolSpec {
  id: CanvasTool;
  icon: typeof MousePointer2;
  label: string;
  /** Single-letter accelerator, matching the convention in Figma/Illustrator. */
  shortcut: string;
}

const TOOLS: readonly ToolSpec[] = [
  { id: "select", icon: MousePointer2, label: "Select", shortcut: "V" },
  { id: "pan", icon: Hand, label: "Pan canvas", shortcut: "H" },
  { id: "box-select", icon: SquareDashed, label: "Box select", shortcut: "M" },
  { id: "connect", icon: Spline, label: "Connect tracks", shortcut: "C" },
  { id: "link", icon: Link2, label: "Link nodes", shortcut: "L" },
];

const SHORTCUT_TO_TOOL: Record<string, CanvasTool> = Object.fromEntries(
  TOOLS.map((tool) => [tool.shortcut.toLowerCase(), tool.id]),
);

/**
 * Surfaces that consume bare letter keys themselves.
 *
 * Text inputs are the obvious case, but the expensive miss is React Aria's
 * collection typeahead: a focused `GridList` row or `ListBox` option is a
 * `div`, not an `input`, and typing "Lo" to jump to a track would otherwise
 * also flip the canvas to the Link tool. Anything inside a dialog or popover
 * is excluded for the same reason — the canvas is not the active surface while
 * one is open.
 */
const TYPING_SURFACES = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="grid"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="textbox"]',
  '[role="combobox"]',
].join(",");

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(TYPING_SURFACES) !== null;
}

/* --------------------------------------------------------------- Tool rail -- */

export interface CanvasToolbarProps {
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  className?: string | undefined;
  /**
   * Binds the V/H/M/C/L accelerators. Exactly one mounted rail may own them —
   * two would dispatch twice for a single keypress — so a second instance must
   * pass `false`.
   */
  enableShortcuts?: boolean | undefined;
}

/**
 * Vertical tool rail, controlled by the parent.
 *
 * React Aria's `Toolbar` rather than a bare `div`: it emits `role="toolbar"`
 * and gives arrow-key roving focus across the buttons, so the rail is one tab
 * stop instead of five — §9.6 requires the whole canvas to be keyboard-driveable
 * and five tab stops of chrome in front of the graph is a real cost.
 *
 * The buttons carry `aria-pressed` (via `IconButton`'s `isActive`) rather than
 * radio semantics because that is what assistive tech users expect from a
 * drawing-tool palette, and it keeps the shared `IconButton` in play.
 */
export function CanvasToolbar({
  tool,
  onToolChange,
  className,
  enableShortcuts = true,
}: CanvasToolbarProps) {
  // Parents almost always pass an inline lambda here. Holding it in a ref keeps
  // the window listener bound once instead of re-registering every render.
  // Written in an effect, not during render: a render can be discarded, and a
  // ref left holding a closure that never committed would fire on the next
  // keypress.
  const onToolChangeRef = useRef(onToolChange);
  useEffect(() => {
    onToolChangeRef.current = onToolChange;
  }, [onToolChange]);

  useEffect(() => {
    if (!enableShortcuts) return;

    function handleKeyDown(event: KeyboardEvent) {
      // Cmd/Ctrl+V is paste and Alt+letter opens browser menus — only a bare
      // letter unambiguously means "pick a tool". Shift is excluded too so the
      // shifted variants stay free for future canvas shortcuts.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // The focused element, not the event target: a keypress with nothing
      // focused targets `body`, but a focused ListBox option is what actually
      // decides whether the canvas should be listening.
      if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;

      const next = SHORTCUT_TO_TOOL[event.key.toLowerCase()];
      if (!next) return;

      event.preventDefault();
      onToolChangeRef.current(next);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enableShortcuts]);

  return (
    <Toolbar
      aria-label="Canvas tools"
      orientation="vertical"
      className={cx(FLOATING_CHROME, "flex-col", className)}
    >
      {TOOLS.map((spec) => (
        <IconButton
          key={spec.id}
          icon={spec.icon}
          // The shortcut rides in the accessible name because there is no
          // tooltip layer on the canvas yet; a keyboard user otherwise has no
          // way to discover that V exists.
          label={`${spec.label} (${spec.shortcut})`}
          isActive={tool === spec.id}
          onPress={() => onToolChange(spec.id)}
        />
      ))}
    </Toolbar>
  );
}

/* ----------------------------------------------------------------- Zoom -- */

export interface CanvasZoomControlsProps {
  /** Viewport scale, where 1 = 100%. */
  zoom: number;
  /** Viewport limits, so the buttons can disable at the end of their travel. */
  minZoom?: number | undefined;
  maxZoom?: number | undefined;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitView: () => void;
  className?: string | undefined;
}

/**
 * Formats the viewport scale for display.
 *
 * Only non-finite values are rejected. An earlier version floored the result at
 * 1%, which reported "1%" for a fit-view over a large graph that was actually
 * at 0.4% — a readout that lies about the viewport is worse than a small one.
 * Sub-1% scales get a decimal so they stay distinguishable from each other.
 */
function formatZoom(zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return "—";
  const percent = zoom * 100;
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

/**
 * Floating zoom cluster: out, current level (click to reset), in, fit.
 *
 * The percentage is a button rather than a label because "click the number to
 * get back to 1:1" is the cheapest reset affordance available and costs no
 * extra chrome.
 */
export function CanvasZoomControls({
  zoom,
  minZoom,
  maxZoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitView,
  className,
}: CanvasZoomControlsProps) {
  const label = formatZoom(zoom);
  // A hair of tolerance: React Flow's zoom settles on floats, so an exact
  // equality check would leave the button enabled at the limit.
  const atMax = maxZoom !== undefined && zoom >= maxZoom - 1e-6;
  const atMin = minZoom !== undefined && zoom <= minZoom + 1e-6;

  return (
    <Toolbar
      aria-label="Canvas zoom"
      orientation="horizontal"
      className={cx(FLOATING_CHROME, "items-center", className)}
    >
      <IconButton
        icon={Minus}
        label="Zoom out"
        onPress={onZoomOut}
        isDisabled={atMin}
        size={14}
      />

      <Button
        onPress={onZoomReset}
        // WCAG 2.5.3: the visible text is part of the accessible name, so a
        // voice-control user can say "one hundred percent" and hit this.
        aria-label={`Zoom ${label}, reset to 100%`}
        className="text-ink-muted hover:bg-surface-raised hover:text-ink min-w-[3.25rem] rounded-md px-1 py-1 text-center font-mono text-label tabular-nums transition-colors"
      >
        {label}
      </Button>

      <IconButton
        icon={Plus}
        label="Zoom in"
        onPress={onZoomIn}
        isDisabled={atMax}
        size={14}
      />

      <span aria-hidden="true" className="bg-border mx-0.5 h-4 w-px shrink-0" />

      <IconButton icon={Maximize2} label="Fit graph to view" onPress={onFitView} size={14} />
    </Toolbar>
  );
}

/*
 * There is deliberately no `CanvasTools` composite wrapping these two. The rail
 * and the zoom cluster sit at opposite corners of the canvas and are positioned
 * by the parent; a wrapper would only forward two className props and hide the
 * fact that exactly one rail may own the keyboard shortcuts.
 */
