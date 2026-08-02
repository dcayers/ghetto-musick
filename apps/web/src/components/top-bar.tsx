import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import {
  Check,
  ChevronDown,
  Clock,
  Download,
  List,
  LogOut,
  Pause,
  Play,
  Plus,
  Redo2,
  Settings,
  Share2,
  Undo2,
  Waypoints,
} from "lucide-react";
import { Bpm, CamelotKey, cx } from "./primitives.js";
import { DemoBadge, IconButton, Pill } from "./ui.js";
import { isDemo } from "../lib/mock.js";

/**
 * Application top bar — plan §9.5.
 *
 * Owns nothing. Every mutation is a callback and every readout is a prop, so
 * the bar can sit above the graph route, the timeline route, or a storybook
 * page without dragging a store along. The parent already knows which set is
 * open and whether it has saved; duplicating that here would give us two
 * answers to the same question.
 */

export type ViewMode = "graph" | "timeline" | "list";
export type SaveState = "saved" | "saving" | "unsaved";

export interface SetOption {
  id: string;
  name: string;
}

export interface TopBarProps {
  /** Name shown on the switcher. Separate from `sets` so the bar renders
      correctly before the set list has loaded. */
  setName: string;
  sets: readonly SetOption[];
  /** Which entry to tick. Falls back to matching on `setName` when the parent
      only has a name to give. */
  currentSetId?: string | undefined;
  onSelectSet?: ((setId: string) => void) | undefined;
  onNewSet?: (() => void) | undefined;

  view: ViewMode;
  onViewChange: (view: ViewMode) => void;

  saveState: SaveState;

  /** Aggregates of the open set — null until there is a set worth measuring. */
  bpm: number | null;
  keySignature: string | null;

  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  onSettings: () => void;
  onExport: () => void;
  onPlay: () => void;
  isPlaying: boolean;
  onSignOut: () => void;

  /** Defaults to the mock module's own flag so the bar marks itself while the
      endpoints behind the set list and the aggregates do not exist. The parent
      can pass `false` once they do, per feature rather than all at once. */
  isDemoData?: boolean | undefined;
}

const VIEWS: ReadonlyArray<{ id: ViewMode; label: string; icon: typeof Share2 }> = [
  { id: "graph", label: "Graph", icon: Share2 },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "list", label: "List", icon: List },
];

/**
 * Save state carries a word, not just a hue — §9.6 forbids colour-only
 * meaning, and "is that dot amber or green" is exactly the failure mode.
 */
const SAVE_STATE: Record<SaveState, { label: string; tone: "neutral" | "ok" | "warn" }> = {
  saved: { label: "Saved", tone: "ok" },
  saving: { label: "Saving…", tone: "neutral" },
  unsaved: { label: "Unsaved", tone: "warn" },
};

const NEW_SET_KEY = "__new-set__";

function isViewMode(value: string): value is ViewMode {
  return value === "graph" || value === "timeline" || value === "list";
}

export function TopBar({
  setName,
  sets,
  currentSetId,
  onSelectSet,
  onNewSet,
  view,
  onViewChange,
  saveState,
  bpm,
  keySignature,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSettings,
  onExport,
  onPlay,
  isPlaying,
  onSignOut,
  isDemoData = isDemo,
}: TopBarProps) {
  const activeSetId = currentSetId ?? sets.find((set) => set.name === setName)?.id;
  const save = SAVE_STATE[saveState];

  return (
    <header className="border-border bg-surface flex h-12 shrink-0 items-center gap-3 border-b px-3">
      {/* Left and right both take `flex-1 basis-0` so the view switcher lands
          on the true centre of the bar rather than the centre of whatever is
          left over — otherwise it drifts as the set name grows. */}
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
        <span className="text-ink flex shrink-0 items-center gap-1.5 text-sm font-semibold">
          <Waypoints size={17} className="text-accent" aria-hidden="true" />
          FlowGraph
        </span>

        <MenuTrigger>
          <Button
            className="text-ink-muted hover:bg-surface-raised hover:text-ink data-[pressed]:bg-surface-raised flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
            aria-label={`Current set: ${setName}. Switch set`}
          >
            <span className="max-w-[180px] truncate">{setName}</span>
            <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
          </Button>

          <Popover className="border-border bg-surface-overlay min-w-[220px] rounded-lg border p-1 shadow-2xl">
            {isDemoData && (
              <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-1.5">
                <span className="text-ink-subtle text-[10px] font-medium tracking-wide uppercase">
                  Sets
                </span>
                <DemoBadge what="The set list" />
              </div>
            )}

            <Menu
              aria-label="Sets"
              className="outline-none"
              onAction={(key) => {
                if (key === NEW_SET_KEY) onNewSet?.();
                else onSelectSet?.(String(key));
              }}
            >
              {sets.map((set) => (
                <MenuItem
                  key={set.id}
                  id={set.id}
                  textValue={set.name}
                  className="text-ink data-[focused]:bg-surface-raised flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-xs outline-none"
                >
                  <span className="truncate">{set.name}</span>
                  {set.id === activeSetId && (
                    <>
                      <Check size={13} className="text-accent shrink-0" aria-hidden="true" />
                      <span className="sr-only">(current set)</span>
                    </>
                  )}
                </MenuItem>
              ))}

              <Separator className="bg-border my-1 h-px" />

              <MenuItem
                id={NEW_SET_KEY}
                textValue="New set"
                className="text-ink-muted data-[focused]:bg-surface-raised data-[focused]:text-ink flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none"
              >
                <Plus size={13} aria-hidden="true" />
                New set…
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>

        {/* Announced politely: an autosave flipping to "Unsaved" is worth
            hearing, but not worth interrupting whatever is being read. */}
        <span role="status" aria-live="polite" className="shrink-0">
          <Pill tone={save.tone}>{save.label}</Pill>
        </span>
      </div>

      <ToggleButtonGroup
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[view]}
        onSelectionChange={(keys) => {
          const [next] = keys;
          // `disallowEmptySelection` guarantees one key, but the prop type is a
          // set of Key — narrow it instead of asserting.
          if (typeof next === "string" && isViewMode(next)) onViewChange(next);
        }}
        aria-label="Workspace view"
        className="border-border bg-surface-raised flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
      >
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <ToggleButton
            key={id}
            id={id}
            className={({ isSelected }) =>
              cx(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                // Every option shows its label, so the label cannot be what
                // distinguishes the active one. The ring can: it is an outline
                // that is either present or absent, which survives greyscale
                // where `bg-accent-muted` (1.27:1 on this surface) does not.
                isSelected
                  ? "bg-accent-muted text-accent ring-accent/70 font-medium ring-1"
                  : "text-ink-muted hover:text-ink",
              )
            }
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <div className="flex flex-1 basis-0 items-center justify-end gap-2">
        <dl className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-subtle text-[10px] font-medium tracking-wide uppercase">
              BPM
            </dt>
            {/* Reuses the shared primitives so a BPM reads the same here as on
                a node or a library row, em dash and all. */}
            <dd>
              <Bpm value={bpm} />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-subtle text-[10px] font-medium tracking-wide uppercase">
              Key
            </dt>
            <dd>
              <CamelotKey value={keySignature} />
            </dd>
          </div>
        </dl>

        {isDemoData && <DemoBadge what="Set BPM and key" />}

        <span className="bg-border h-5 w-px shrink-0" aria-hidden="true" />

        <div className="flex items-center gap-0.5">
          <IconButton icon={Undo2} label="Undo" onPress={onUndo} isDisabled={!canUndo} />
          <IconButton icon={Redo2} label="Redo" onPress={onRedo} isDisabled={!canRedo} />
          <IconButton icon={Settings} label="Settings" onPress={onSettings} />
          <IconButton icon={LogOut} label="Sign out" onPress={onSignOut} />
        </div>

        <Button
          onPress={onExport}
          className="border-border-strong text-ink-muted hover:border-accent/60 hover:text-ink flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors"
        >
          <Download size={14} aria-hidden="true" />
          Export
        </Button>

        <Button
          onPress={onPlay}
          // Accessible name keeps the visible word first so voice control
          // ("click Play") still targets it — WCAG 2.5.3.
          aria-label={isPlaying ? "Pause playback" : "Play set"}
          className="bg-accent hover:bg-accent-hover flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
        >
          {isPlaying ? (
            <Pause size={14} className="fill-current" aria-hidden="true" />
          ) : (
            <Play size={14} className="fill-current" aria-hidden="true" />
          )}
          {isPlaying ? "Pause" : "Play"}
        </Button>
      </div>
    </header>
  );
}
