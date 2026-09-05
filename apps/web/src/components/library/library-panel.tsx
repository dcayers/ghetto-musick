import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Button,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  NumberField,
  Popover,
  SearchField,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  Check,
  ChevronDown,
  Music4,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Artwork,
  Bpm,
  CamelotKey,
  EmptyState,
  EnergyDots,
  Panel,
  SourceDot,
  Truncate,
  cx,
} from "../primitives.js";
import { IconButton, Waveform } from "../ui.js";
import {
  EMPTY_FILTERS,
  useActiveSetTrackIds,
  usePlacedTrackIds,
  useWorkspace,
  type LibraryFilters,
} from "../../state/workspace.js";
import type { WorkspaceGraphNode, WorkspaceTrack } from "../../lib/workspace-data.js";
import { DEMO_IMPORT_HINT, useSeratoImport } from "../../state/use-serato-import.js";

/**
 * The track library.
 *
 * Reads and writes the workspace store directly rather than taking props: §13
 * requires the library, canvas, timeline, and inspector to agree on the
 * selection at all times, and a panel that owns a copy of it is a panel that
 * can disagree.
 */

/* --------------------------------------------------------------- filters -- */

/** Sentinel for "no constraint". A `Select` key cannot be null. */
const ANY = "any";

interface Option {
  readonly id: string;
  readonly label: string;
}

const COLLECTIONS: readonly Option[] = [
  { id: "all", label: "All Tracks" },
  { id: "canvas", label: "On Canvas" },
  { id: "set", label: "In Active Set" },
  { id: "unplaced", label: "Not on Canvas" },
];

const SOURCES: readonly Option[] = [
  { id: ANY, label: "Any source" },
  { id: "local", label: "Local file" },
  { id: "streaming", label: "Streaming only" },
  { id: "missing", label: "File missing" },
];

const MIN_ENERGY: readonly Option[] = [
  { id: ANY, label: "Any energy" },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: String(index + 1),
    label: `${index + 1}+`,
  })),
];

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as Array<keyof LibraryFilters>;

function hasActiveFilters(filters: LibraryFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key] !== EMPTY_FILTERS[key]);
}

/**
 * Camelot sort order.
 *
 * "10A" sorts before "2A" lexically, which puts the wheel in an order no DJ
 * recognises — the number is the position on the wheel, so it has to be
 * compared as one.
 */
function camelotOrder(key: string): number {
  const match = /^(\d{1,2})([AB])$/.exec(key);
  const number = match?.[1];
  const mode = match?.[2];
  if (number === undefined || mode === undefined) return Number.MAX_SAFE_INTEGER;
  return Number(number) * 2 + (mode === "B" ? 1 : 0);
}

function matches(
  track: WorkspaceTrack,
  filters: LibraryFilters,
  placed: ReadonlySet<string>,
  inSet: ReadonlySet<string>,
): boolean {
  const query = filters.query.trim().toLowerCase();
  if (
    query &&
    !track.title.toLowerCase().includes(query) &&
    !track.artist.toLowerCase().includes(query)
  ) {
    return false;
  }

  if (filters.collection === "canvas" && !placed.has(track.id)) return false;
  if (filters.collection === "unplaced" && placed.has(track.id)) return false;
  if (filters.collection === "set" && !inSet.has(track.id)) return false;

  if (filters.genre !== null && track.genre !== filters.genre) return false;
  if (filters.key !== null && track.keySignature !== filters.key) return false;
  if (filters.source !== null && track.source !== filters.source) return false;
  if (
    filters.minEnergy !== null &&
    (track.energy === null || track.energy < filters.minEnergy)
  )
    return false;

  // A track with no analysed tempo cannot satisfy a tempo window; excluding it
  // is the honest answer, and the source dot already explains why.
  if (filters.minBpm !== null && (track.bpm === null || track.bpm < filters.minBpm)) return false;
  if (filters.maxBpm !== null && (track.bpm === null || track.bpm > filters.maxBpm)) return false;

  return true;
}

/* ------------------------------------------------------------ windowing -- */

const ROW_HEIGHT = 64;
/** Rows rendered beyond each edge, so a fast flick never shows a blank band. */
const OVERSCAN = 5;

/**
 * Where a double-clicked track lands on the canvas.
 *
 * To the right of everything already placed, on the cluster's centre line —
 * 320px is the column spacing the authored layout uses, so a new node reads as
 * the next step rather than as debris. The canvas re-fits, so this only has to
 * be sensible, not exact.
 */
function nextNodePosition(nodes: readonly WorkspaceGraphNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const maxX = Math.max(...nodes.map((node) => node.x));
  const meanY = Math.round(nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length);
  return { x: maxX + 320, y: meanY };
}

/* --------------------------------------------------------------- controls -- */

function FilterSelect({
  label,
  value,
  options,
  onChange,
  hideLabel = false,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (id: string) => void;
  hideLabel?: boolean;
}) {
  return (
    <Select
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key))}
      className="flex min-w-0 flex-col gap-1"
    >
      <Label
        className={
          hideLabel
            ? "sr-only"
            : "text-ink-subtle text-section font-medium uppercase"
        }
      >
        {label}
      </Label>
      <Button className="border-border bg-surface-raised text-ink hover:border-border-strong rounded-control flex w-full items-center justify-between gap-1 border px-2 py-1 text-body transition-colors">
        <SelectValue className="min-w-0 truncate" />
        <ChevronDown size={13} className="text-ink-subtle shrink-0" aria-hidden="true" />
      </Button>
      <Popover className="border-border bg-surface-overlay rounded-card z-50 w-[var(--trigger-width)] border p-1 shadow-2xl">
        <ListBox className="max-h-64 overflow-y-auto outline-none">
          {options.map((option) => (
            <ListBoxItem
              key={option.id}
              id={option.id}
              textValue={option.label}
              className="text-ink data-[focused]:bg-surface-raised flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-body outline-none"
            >
              {({ isSelected }) => (
                <>
                  <span className="min-w-0 truncate">{option.label}</span>
                  {/* A tick, not a tint: §17 forbids the current option being
                      distinguishable by hue alone. */}
                  {isSelected && (
                    <Check size={12} className="text-accent-text shrink-0" aria-hidden="true" />
                  )}
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}

function BpmField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <NumberField
      // React Stately spells "empty" as NaN; null is our store's spelling.
      value={value ?? Number.NaN}
      onChange={(next) => onChange(Number.isNaN(next) ? null : next)}
      minValue={60}
      maxValue={220}
      step={1}
      formatOptions={{ maximumFractionDigits: 0, useGrouping: false }}
      className="flex min-w-0 flex-col gap-1"
    >
      <Label className="text-ink-subtle text-section font-medium uppercase">
        {label}
      </Label>
      <Input
        placeholder="—"
        className="border-border bg-surface-raised text-ink placeholder:text-ink-subtle focus:border-accent rounded-control w-full border px-2 py-1 text-body tabular-nums outline-none"
      />
    </NumberField>
  );
}

/* ------------------------------------------------------------------ panel -- */


export function LibraryPanel() {
  const tracks = useWorkspace((state) => state.tracks);
  const nodes = useWorkspace((state) => state.nodes);
  const filters = useWorkspace((state) => state.filters);
  const selectedTrackId = useWorkspace((state) => state.selectedTrackId);
  const setFilters = useWorkspace((state) => state.setFilters);
  const resetFilters = useWorkspace((state) => state.resetFilters);
  const selectTrack = useWorkspace((state) => state.selectTrack);
  const addTrackToGraph = useWorkspace((state) => state.addTrackToGraph);
  const announce = useWorkspace((state) => state.announce);
  const togglePanel = useWorkspace((state) => state.togglePanel);
  const seratoImport = useSeratoImport();

  const placed = usePlacedTrackIds();
  const inSet = useActiveSetTrackIds();

  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const viewportObserver = useRef<ResizeObserver | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(ROW_HEIGHT * 8);
  const [activeIndex, setActiveIndex] = useState(0);
  const pendingFocus = useRef(false);

  const panelId = useId();
  const rowId = (trackId: string) => `${panelId}-${trackId}`;


  // Option lists are derived, never authored — a genre that exists only in the
  // data would otherwise be unfilterable, and one that no longer exists would
  // sit in the menu returning nothing.
  const genres = useMemo(
    () =>
      [...new Set(tracks.map((track) => track.genre))]
        .filter((genre): genre is string => genre !== null)
        .sort((a, b) => a.localeCompare(b)),
    [tracks],
  );
  const keys = useMemo(() => {
    const distinct = new Set<string>();
    for (const track of tracks) if (track.keySignature) distinct.add(track.keySignature);
    return [...distinct].sort((a, b) => camelotOrder(a) - camelotOrder(b));
  }, [tracks]);

  // Cheap enough to run per render (126 rows, a handful of predicates each) and
  // memoising it would miss anyway: the membership sets are rebuilt per render.
  const visible = tracks.filter((track) => matches(track, filters, placed, inSet));
  const total = visible.length;

  const dropSpot = nextNodePosition(nodes);
  const filtered = hasActiveFilters(filters);

  // The stored offset outlives the list it was measured against: narrowing a
  // filter shrinks the content under a viewport that is still scrolled down, and
  // an unclamped start index then runs past `last` and slices out nothing at all
  // while the header still reports matches.
  const maxScrollTop = Math.max(0, total * ROW_HEIGHT - viewportHeight);
  const windowTop = Math.min(scrollTop, maxScrollTop);

  const first = Math.max(0, Math.floor(windowTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(total, Math.ceil((windowTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const rows = visible.slice(first, last);

  /**
   * Which row holds the tab stop.
   *
   * Clamped into the *rendered* window, not just into the list. A tab stop is an
   * attribute of a mounted element, so pinning it to a row that has scrolled out
   * of the window unmounts the only tabbable thing in the list and takes the
   * whole library out of the tab order.
   */
  const tabbable =
    total === 0
      ? -1
      : Math.min(Math.max(Math.max(activeIndex, 0), first), Math.max(first, last - 1));

  /**
   * Binds the height observer to whichever scroll container is currently mounted.
   *
   * A callback ref rather than a mount effect: the container only exists while
   * something matches, so filtering to zero results and back replaces the node.
   * A `[]` effect would stay bound to the first one and leave the height frozen
   * at whatever the detaching element last reported.
   */
  const attachList = useCallback((element: HTMLDivElement | null) => {
    viewportObserver.current?.disconnect();
    viewportObserver.current = null;
    listRef.current = element;
    if (element === null) return;
    // A fresh container starts at the top; the previous one's offset would
    // translate the rows away from where the browser is actually looking.
    setScrollTop(element.scrollTop);
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0;
      // A detaching element reports 0×0. Storing that would poison the window
      // for the rest of the session.
      if (height > 0) setViewportHeight(height);
    });
    observer.observe(element);
    viewportObserver.current = observer;
  }, []);

  // Arrow keys move focus to a row that may not have been mounted when the key
  // was pressed, so the focus call has to wait for the window to re-render.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const track = visible[tabbable];
    if (track) document.getElementById(rowId(track.id))?.focus();
  });

  function focusRow(index: number) {
    const clamped = Math.max(0, Math.min(total - 1, index));
    const element = listRef.current;
    let scrolled = false;
    if (element) {
      const top = clamped * ROW_HEIGHT;
      let next = element.scrollTop;
      if (top < next) next = top;
      else if (top + ROW_HEIGHT > next + element.clientHeight) {
        next = top + ROW_HEIGHT - element.clientHeight;
      }
      if (next !== element.scrollTop) {
        // Both the DOM and the state are set here: the browser's scroll event
        // is async, and the focus effect below runs before it would land.
        element.scrollTop = next;
        setScrollTop(next);
        scrolled = true;
      }
    }
    // Only ask for focus when something will actually re-render to consume the
    // request. ArrowUp on the first row changes nothing, and the effect below
    // clears the flag only when it runs — a flag left set is picked up by the
    // next unrelated render and yanks focus back into the library from wherever
    // the user had moved it.
    if (clamped === activeIndex && !scrolled) return;
    setActiveIndex(clamped);
    pendingFocus.current = true;
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const next =
      event.key === "ArrowDown"
        ? activeIndex + 1
        : event.key === "ArrowUp"
          ? activeIndex - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? total - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    focusRow(next);
  }

  function addToCanvas(track: WorkspaceTrack) {
    if (placed.has(track.id)) {
      announce(`${track.title} is already on the canvas.`);
      return;
    }
    addTrackToGraph(track.id, dropSpot.x, dropSpot.y);
    announce(`Added ${track.title} to the canvas.`);
  }

  return (
    <Panel
      flush={false}
      className="h-full"
      title={
        <span className="flex items-baseline gap-2">
          Library
          <span className="text-ink-subtle text-label font-normal tabular-nums">
            {total} {total === 1 ? "track" : "tracks"}
          </span>
        </span>
      }
      actions={
        <>
          <IconButton
            icon={Search}
            label="Search tracks"
            isActive={searchOpen}
            size={14}
            onPress={() => {
              // Closing clears the query. A search that keeps filtering from
              // behind a hidden field is a list that lies about its contents.
              if (searchOpen && filters.query) setFilters({ query: "" });
              setSearchOpen(!searchOpen);
            }}
          />
          <IconButton
            icon={SlidersHorizontal}
            label="Filter tracks"
            isActive={drawerOpen}
            size={14}
            onPress={() => setDrawerOpen(!drawerOpen)}
          />
          <IconButton
            icon={seratoImport.isImporting ? RefreshCw : Plus}
            label={seratoImport.label}
            size={14}
            isDisabled={seratoImport.isImporting}
            onPress={seratoImport.run}
          />
          {/* The layout renders a restore rail once this is hidden; without a
              hide control here the rail is unreachable. Wide only: the compact
              and medium layouts ignore `panels.library.visible`, so on a phone
              this would do nothing visible while silently collapsing the
              desktop column for next time. `xl` is the same 80rem the shell
              switches to its column layout at. */}
          <span className="hidden xl:flex">
            <IconButton
              icon={PanelLeftClose}
              label="Hide library"
              size={14}
              onPress={() => togglePanel("library")}
            />
          </span>
        </>
      }
    >
      {searchOpen && (
        <div className="border-border shrink-0 border-b p-2">
          <SearchField
            value={filters.query}
            onChange={(query) => setFilters({ query })}
            className="relative flex flex-col"
          >
            <Label className="sr-only">Search tracks by title or artist</Label>
            <Input
              placeholder="Search title or artist…"
              className="border-border bg-surface-raised text-ink placeholder:text-ink-subtle focus:border-accent rounded-control w-full border py-1.5 pr-7 pl-2 text-body outline-none"
            />
            {filters.query && (
              <Button
                aria-label="Clear search"
                className="text-ink-subtle hover:text-ink absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded"
              >
                <X size={13} aria-hidden="true" />
              </Button>
            )}
          </SearchField>
        </div>
      )}

      <div className="border-border shrink-0 border-b px-2 py-1.5">
        <FilterSelect
          label="Collection"
          hideLabel
          value={filters.collection}
          options={COLLECTIONS}
          onChange={(collection) => setFilters({ collection })}
        />
      </div>

      {drawerOpen && (
        <div className="border-border bg-surface-raised/40 shrink-0 space-y-2 border-b p-2">
          <div className="grid grid-cols-2 gap-2">
            <FilterSelect
              label="Genre"
              value={filters.genre ?? ANY}
              options={[{ id: ANY, label: "Any genre" }, ...genres.map((g) => ({ id: g, label: g }))]}
              onChange={(genre) => setFilters({ genre: genre === ANY ? null : genre })}
            />
            <FilterSelect
              label="Key"
              value={filters.key ?? ANY}
              options={[{ id: ANY, label: "Any key" }, ...keys.map((k) => ({ id: k, label: k }))]}
              onChange={(key) => setFilters({ key: key === ANY ? null : key })}
            />
            <FilterSelect
              label="Source"
              value={filters.source ?? ANY}
              options={SOURCES}
              onChange={(source) => setFilters({ source: source === ANY ? null : source })}
            />
            <FilterSelect
              label="Min energy"
              value={filters.minEnergy === null ? ANY : String(filters.minEnergy)}
              options={MIN_ENERGY}
              onChange={(value) =>
                setFilters({ minEnergy: value === ANY ? null : Number(value) })
              }
            />
            <BpmField
              label="Min BPM"
              value={filters.minBpm}
              onChange={(minBpm) => setFilters({ minBpm })}
            />
            <BpmField
              label="Max BPM"
              value={filters.maxBpm}
              onChange={(maxBpm) => setFilters({ maxBpm })}
            />
          </div>

          <Button
            isDisabled={!filtered}
            onPress={resetFilters}
            className="border-border text-ink-muted hover:border-border-strong hover:text-ink rounded-control flex w-full items-center justify-center gap-1.5 border px-2 py-1 text-label transition-colors disabled:opacity-40"
          >
            <X size={12} aria-hidden="true" />
            Clear filters
          </Button>
        </div>
      )}

      {/* The visible count is in the header; this repeats it for screen readers,
          which otherwise get no signal that a filter changed anything. */}
      <span role="status" aria-live="polite" className="sr-only">
        {total} tracks shown
      </span>

      {total === 0 ? (
        <EmptyState
          title="No matching tracks"
          hint={
            filtered
              ? "Nothing in the library satisfies every active filter."
              : "The library is empty."
          }
          {...(filtered
            ? {
                actions: (
                  <Button
                    onPress={resetFilters}
                    className="border-border text-ink-muted hover:text-ink rounded-control border px-2 py-1 text-body"
                  >
                    Clear filters
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <div
          ref={attachList}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <div style={{ height: total * ROW_HEIGHT }}>
            <ul
              role="list"
              aria-label="Tracks"
              onKeyDown={onListKeyDown}
              style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}
            >
              {rows.map((track, offset) => {
                const index = first + offset;
                const isSelected = track.id === selectedTrackId;
                const isMissing = track.source === "missing";

                return (
                  <li
                    key={track.id}
                    style={{ height: ROW_HEIGHT }}
                    // Positioned so the add control can sit over the row's own
                    // background — a sibling in normal flow would cut the
                    // selected tint short of the right edge.
                    className="relative px-2 py-1"
                    // The window renders a slice, so position has to be stated
                    // rather than counted from the DOM.
                    aria-posinset={index + 1}
                    aria-setsize={total}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/flowgraph-track", track.id);
                      event.dataTransfer.effectAllowed = "copy";
                      // theme.css keys off this to kill text selection for the
                      // duration of the drag.
                      document.body.dataset.dragging = "true";
                      setDraggingId(track.id);
                    }}
                    onDragEnd={() => {
                      delete document.body.dataset.dragging;
                      setDraggingId(null);
                    }}
                  >
                    <Button
                      id={rowId(track.id)}
                      excludeFromTabOrder={index !== tabbable}
                      aria-current={isSelected}
                      onFocus={() => setActiveIndex(index)}
                      onPress={() => selectTrack(track.id)}
                      onDoubleClick={() => addToCanvas(track)}
                      className={cx(
                        // `pr-9` reserves the lane the add control occupies, so
                        // it never lands on top of the tempo/key readout.
                        "flex h-full w-full cursor-grab items-center gap-2 rounded-md border pr-9 pl-2 text-left transition-colors",
                        // The left bar is the non-colour half of the selected
                        // state (§17): a stripe that is present or absent
                        // survives greyscale where the violet tint does not.
                        isSelected
                          ? "border-accent bg-surface-selected"
                          : "border-border bg-surface-raised/45 hover:border-border-strong hover:bg-surface-hover",
                        isMissing && "opacity-60",
                        draggingId === track.id && "opacity-40",
                      )}
                    >
                      <Artwork seed={track.id} size={44} />

                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <Truncate className="text-ink text-body leading-4 font-medium">
                          {track.title}
                        </Truncate>
                        <Truncate className="text-ink-muted text-label leading-[13px]">
                          {track.artist}
                        </Truncate>
                        <Waveform
                          trackId={track.id}
                          bars={24}
                          energy={track.energy}
                          muted={isMissing}
                          {...(isSelected ? { color: "var(--color-waveform-active)" } : {})}
                        />
                      </span>

                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="flex items-center gap-1.5">
                          <Bpm value={track.bpm} />
                          <CamelotKey value={track.keySignature} />
                        </span>
                        <span className="flex items-center gap-1.5">
                          <EnergyDots value={track.energy} size={5} />
                          <SourceDot source={track.source} />
                        </span>
                      </span>
                    </Button>

                    {/* The keyboard equivalent of double-clicking a row. Without
                        it the app's core action is pointer-only: Enter on a row
                        selects, and every other route onto the canvas is a drag
                        or a disabled button. A sibling of the row rather than a
                        child, because a button inside a button is neither valid
                        nor operable, and it joins the same roving tab order so
                        one Tab reaches the row and the next reaches its action
                        instead of walking all fifteen rendered rows. */}
                    <Button
                      excludeFromTabOrder={index !== tabbable}
                      aria-label={`Add ${track.title} to canvas`}
                      onPress={() => addToCanvas(track)}
                      className="text-ink-subtle hover:bg-surface-hover hover:text-ink rounded-control absolute top-1/2 right-3.5 grid size-6 -translate-y-1/2 place-items-center transition-colors"
                    >
                      <Plus size={14} aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="border-border shrink-0 border-t p-2">
        {/* `title` sits on the wrapper because a disabled button emits no
            pointer events, so a React Aria tooltip on it would never open. */}
        <span
          {...(seratoImport.isAvailable ? {} : { title: DEMO_IMPORT_HINT })}
          className="block"
        >
          <Button
            isDisabled={!seratoImport.isAvailable || seratoImport.isImporting}
            aria-label={seratoImport.label}
            onPress={seratoImport.run}
            className="border-border text-ink-muted hover:border-border-strong hover:text-ink rounded-control flex w-full items-center justify-center gap-1.5 border border-dashed px-2 py-1.5 text-body transition-colors disabled:opacity-60"
          >
            <Music4 size={13} aria-hidden="true" />
            {seratoImport.isImporting ? "Reading library…" : "Import from Serato"}
          </Button>
        </span>
      </div>
    </Panel>
  );
}
