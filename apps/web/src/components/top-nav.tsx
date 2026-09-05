import { useState } from "react";
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
import { IconButton, Pill } from "./ui.js";
import { useWorkspace, type SaveState, type ViewMode } from "../state/workspace.js";

/**
 * Application top navigation.
 *
 * Reads the store directly rather than taking props. The bar renders the set
 * name, the view mode, and the save state — all of which other surfaces also
 * mutate, so routing them through a parent would give us two copies of the
 * same answer and a bar that lags whichever one it did not receive.
 */

const VIEWS: ReadonlyArray<{ id: ViewMode; label: string; icon: typeof Share2 }> = [
  { id: "graph", label: "Graph", icon: Share2 },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "list", label: "List", icon: List },
];

/**
 * Save state carries a word, not just a hue — §17 forbids colour-only meaning,
 * and "is that dot amber or green" is exactly the failure mode.
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

export function TopNav() {
  const activeSet = useWorkspace((state) => state.set);
  const view = useWorkspace((state) => state.view);
  const setView = useWorkspace((state) => state.setView);
  const saveState = useWorkspace((state) => state.saveState);
  const announce = useWorkspace((state) => state.announce);

  // No audio engine behind this yet, so the transport flag is local. It still
  // announces, because a button that changes only its own glyph gives a
  // screen-reader user nothing to go on.
  const [isPlaying, setIsPlaying] = useState(false);

  const save = SAVE_STATE[saveState];

  return (
    <header className="border-border bg-surface flex h-14 shrink-0 items-center gap-3 border-b px-3">
      {/* Left and right both take `flex-1 basis-0` so the view switcher lands
          on the true centre of the bar rather than the centre of whatever is
          left over — otherwise it drifts as the set name grows. */}
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
        <span className="border-border text-ink mr-1 flex shrink-0 items-center gap-3 border-r pr-8 text-xl font-semibold">
          <Waypoints size={20} className="text-accent" aria-hidden="true" />
          FlowGraph
        </span>

        <MenuTrigger>
          <Button
            className="text-ink-muted hover:bg-surface-raised hover:text-ink data-[pressed]:bg-surface-raised flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
            aria-label={`Set: ${activeSet.name}. Switch set`}
          >
            <span className="max-w-[180px] truncate">{activeSet.name}</span>
            <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
          </Button>

          <Popover className="border-border bg-surface-overlay min-w-[220px] rounded-lg border p-1 shadow-2xl">
            <Menu
              aria-label="Sets"
              className="outline-none"
              onAction={(key) => {
                announce(
                  key === NEW_SET_KEY
                    ? "Creating sets is not built yet — this workspace has one set."
                    : `${activeSet.name} is already open.`,
                );
              }}
            >
              <MenuItem
                id={activeSet.id}
                textValue={activeSet.name}
                className="text-ink data-[focused]:bg-surface-raised flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-xs outline-none"
              >
                <span className="truncate">{activeSet.name}</span>
                {/* The tick is duplicated in text: a check glyph is a shape a
                    screen reader never reaches. */}
                <Check size={13} className="text-accent shrink-0" aria-hidden="true" />
                <span className="sr-only">(current set)</span>
              </MenuItem>

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
          if (typeof next === "string" && isViewMode(next)) setView(next);
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
                  ? "bg-accent-muted text-accent ring-accent/70 font-semibold ring-1"
                  : "text-ink-muted hover:text-ink font-normal",
              )
            }
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <div className="flex flex-1 basis-0 items-center justify-end gap-2">
        {/* Set aggregates and the secondary actions drop below `md`. At 375px
            the bar cannot hold them, and a readout clipped to "KEY" with no
            value reads as broken — §16 says adapt rather than squeeze. Both
            survive: the set's tempo and key are on every node and card, and
            these actions are all currently unavailable anyway. */}
        <dl className="hidden items-center gap-3 md:flex">
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-subtle text-[10px] font-medium tracking-wide uppercase">
              BPM
            </dt>
            {/* Reuses the shared primitives so a BPM reads the same here as on
                a node or a library row. One decimal: the bar is where a DJ
                checks the exact working tempo, and 124 vs 124.4 matters. */}
            <dd>
              <Bpm value={activeSet.targetBpm} decimals={1} />
            </dd>
          </div>
          {/* Omitted entirely when there is no key rather than shown as "Key —":
              an empty readout in the chrome reads as a broken field, whereas an
              absent one reads as "this set has no declared key". */}
          {activeSet.targetKey !== "" && (
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-subtle text-[10px] font-medium tracking-wide uppercase">
                Key
              </dt>
              <dd>
                <CamelotKey value={activeSet.targetKey} />
              </dd>
            </div>
          )}
        </dl>

        <span className="bg-border hidden h-5 w-px shrink-0 md:block" aria-hidden="true" />

        <div className="hidden items-center gap-0.5 md:flex">
          {/* There is no edit history in the store yet. Disabled with the reason
              in the name beats a live button that silently does nothing. */}
          <IconButton icon={Undo2} label="Undo — no edit history yet" isDisabled />
          <IconButton icon={Redo2} label="Redo — no edit history yet" isDisabled />
          <IconButton
            icon={Settings}
            label="Settings"
            onPress={() => announce("Settings are not available yet")}
          />
        </div>

        <Button
          onPress={() => announce("Export is not available yet")}
          className="border-border-strong text-ink-muted hover:border-accent/60 hover:text-ink rounded-control hidden items-center gap-1.5 border px-2.5 py-1.5 text-xs transition-colors md:flex"
        >
          <Download size={14} aria-hidden="true" />
          Export
        </Button>

        <Button
          onPress={() => {
            const next = !isPlaying;
            setIsPlaying(next);
            announce(next ? `Playing ${activeSet.name}` : "Playback paused");
          }}
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
