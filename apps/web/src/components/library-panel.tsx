import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Input,
  Label,
  SearchField,
  GridList,
  GridListItem,
  Select,
  SelectValue,
  Popover,
  ListBox,
  ListBoxItem,
} from "react-aria-components";
import { Search, SlidersHorizontal, Plus, Music4, ChevronDown } from "lucide-react";
import { listTracks } from "../lib/api.js";
import { Artwork, Bpm, CamelotKey, EnergyDots, EmptyState, Panel, cx } from "./primitives.js";
import { MiniWaveform, IconButton, DemoBadge } from "./ui.js";
import { energyFor } from "../lib/mock.js";

/**
 * Track library — plan §9.7.
 *
 * React Aria's `GridList` rather than a div soup: it brings keyboard
 * navigation, roving tabindex, and selection semantics for free, which §9.6
 * requires. Rows are drag sources for the canvas.
 */

const FILTERS = [
  { id: "all", label: "All Tracks" },
  { id: "crates", label: "Crates" },
  { id: "recent", label: "Recently Added" },
  { id: "unplaced", label: "Not on Canvas" },
] as const;

export function LibraryPanel({
  onAddTrack,
  placedTrackIds,
}: {
  onAddTrack?: (trackId: string) => void;
  placedTrackIds?: ReadonlySet<string>;
}) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const { data, isPending, error } = useQuery({
    queryKey: ["tracks", search],
    // 100 is the contract's ceiling (`packages/contracts/src/track.ts`);
    // asking for more is a 400, not a larger page.
    queryFn: () => listTracks({ ...(search ? { query: search } : {}), limit: 100 }),
    // The library is browsed constantly while building a set; refetching on
    // every focus change would fight the user's scroll position.
    refetchOnWindowFocus: false,
  });

  const tracks = useMemo(() => {
    const all = data?.items ?? [];
    // "Not on Canvas" is genuinely useful while building a set — it answers
    // "what haven't I considered yet". The other filters need crate data the
    // API does not expose yet and fall through to everything.
    if (filter === "unplaced" && placedTrackIds) {
      return all.filter((track) => !placedTrackIds.has(track.id));
    }
    return all;
  }, [data, filter, placedTrackIds]);

  return (
    <Panel
      className="w-[268px] shrink-0"
      title={
        <span className="flex items-center gap-2">
          Library
          <span className="text-ink-subtle text-[11px] font-normal tabular-nums">
            {tracks.length} tracks
          </span>
        </span>
      }
      actions={
        <span className="flex items-center gap-0.5">
          <IconButton
            icon={Search}
            label="Search tracks"
            isActive={searchOpen}
            onPress={() => setSearchOpen(!searchOpen)}
            size={14}
          />
          <IconButton icon={SlidersHorizontal} label="Filter tracks" size={14} />
          <IconButton icon={Plus} label="Add track" size={14} />
        </span>
      }
    >
      {searchOpen && (
        <div className="border-border shrink-0 border-b p-2">
          <SearchField
            value={search}
            onChange={setSearch}
            aria-label="Search tracks"
            className="flex flex-col gap-1"
          >
            <Label className="sr-only">Search tracks</Label>
            <Input
              placeholder="Search tracks…"
              className="border-border bg-surface-raised text-ink placeholder:text-ink-subtle focus:border-accent w-full rounded-md border px-2 py-1.5 text-sm outline-none"
            />
          </SearchField>
        </div>
      )}

      <div className="border-border shrink-0 border-b px-2 py-1.5">
        <Select selectedKey={filter} onSelectionChange={(key) => setFilter(String(key))}>
          <Label className="sr-only">Filter library</Label>
          <Button className="border-border bg-surface-raised text-ink flex w-full items-center justify-between rounded-md border px-2 py-1 text-xs">
            <SelectValue />
            <ChevronDown size={13} className="text-ink-subtle" />
          </Button>
          <Popover className="border-border bg-surface-overlay w-[var(--trigger-width)] rounded-md border p-1 shadow-xl">
            <ListBox className="outline-none">
              {FILTERS.map((option) => (
                <ListBoxItem
                  key={option.id}
                  id={option.id}
                  className="text-ink data-[focused]:bg-surface-raised cursor-pointer rounded px-2 py-1 text-xs outline-none"
                >
                  {option.label}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
      </div>

      {error ? (
        <EmptyState
          title="Could not load the library"
          hint={error instanceof Error ? error.message : undefined}
        />
      ) : isPending ? (
        <EmptyState title="Loading…" />
      ) : tracks.length === 0 ? (
        <EmptyState
          title={search ? "No matching tracks" : "No tracks yet"}
          hint={search ? undefined : "Import a Serato library or add tracks manually."}
        />
      ) : (
        <GridList
          aria-label="Tracks"
          selectionMode="multiple"
          items={tracks}
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
          onAction={(key) => onAddTrack?.(String(key))}
        >
          {(track) => {
            const placed = placedTrackIds?.has(track.id) ?? false;
            return (
              <GridListItem
                key={track.id}
                id={track.id}
                textValue={`${track.artist} — ${track.title}`}
                className={cx(
                  "group data-[selected]:border-accent data-[selected]:bg-accent-muted hover:bg-surface-raised mb-1 cursor-grab rounded-lg border border-transparent px-2 py-1.5 outline-none",
                  placed && "opacity-55",
                )}
              >
                <div
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/flowgraph-track", track.id);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className="flex items-center gap-2"
                >
                  <Artwork seed={track.id} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-xs font-medium">{track.title}</p>
                    <p className="text-ink-muted truncate text-[11px]">{track.artist}</p>
                    <MiniWaveform trackId={track.id} bars={28} className="mt-1 h-2.5" />
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      <Bpm value={track.bpm} />
                      <CamelotKey value={track.keySignature} />
                    </div>
                    <EnergyDots value={energyFor(track.id)} />
                  </div>
                </div>
              </GridListItem>
            );
          }}
        </GridList>
      )}

      <div className="border-border flex shrink-0 items-center gap-2 border-t p-2">
        <Button
          isDisabled
          className="border-border text-ink-muted flex flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs disabled:opacity-60"
        >
          <Music4 size={13} />
          Add Tracks
        </Button>
        {/* Waveform and energy are seeded demo data until the bridge lands. */}
        <DemoBadge what="Waveform and energy" />
      </div>
    </Panel>
  );
}
