import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Input,
  Label,
  SearchField,
  GridList,
  GridListItem,
} from "react-aria-components";
import { listTracks } from "../lib/api.js";
import { Artwork, Bpm, CamelotKey, EnergyDots, EmptyState, Panel } from "./primitives.js";

/**
 * Track library — plan §9.7.
 *
 * React Aria's `GridList` rather than a div soup: it brings keyboard
 * navigation, roving tabindex, and selection semantics for free, which
 * §9.6 requires ("full keyboard creation, selection, connection, deletion,
 * and reordering flows"). Retrofitting that onto custom markup is the
 * expensive path, which is why ADR-0004's stack choice went this way.
 *
 * Rows carry a drag payload so the canvas can accept a drop. Drag-and-drop
 * itself is wired in the graph route, since the drop target lives there.
 */
export function LibraryPanel({ onAddTrack }: { onAddTrack?: (trackId: string) => void }) {
  const [search, setSearch] = useState("");

  const { data, isPending, error } = useQuery({
    queryKey: ["tracks", search],
    queryFn: () => listTracks({ ...(search ? { query: search } : {}), limit: 100 }),
    // The library is browsed constantly while building a set; refetching on
    // every focus change would fight the user's scroll position.
    refetchOnWindowFocus: false,
  });

  const tracks = useMemo(() => data?.items ?? [], [data]);

  return (
    <Panel
      title="Library"
      className="w-[260px] shrink-0"
      actions={
        <span className="text-ink-subtle text-xs tabular-nums">
          {tracks.length > 0 ? `${tracks.length} tracks` : ""}
        </span>
      }
    >
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
          // Dependency-free drag payload: the canvas reads this on drop.
          // Full React Aria DnD lands with the canvas drop target.
          onAction={(key) => onAddTrack?.(String(key))}
        >
          {(track) => (
            <GridListItem
              key={track.id}
              id={track.id}
              textValue={`${track.artist} — ${track.title}`}
              className="data-[selected]:border-accent data-[selected]:bg-accent-muted hover:bg-surface-raised group mb-1 cursor-grab rounded-lg border border-transparent px-2 py-1.5 outline-none"
            >
              <div
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/flowgraph-track", track.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="flex items-center gap-2"
              >
                <Artwork seed={track.id} />
                <div className="min-w-0 flex-1">
                  <p className="text-ink truncate text-xs font-medium">{track.title}</p>
                  <p className="text-ink-muted truncate text-[11px]">{track.artist}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <Bpm value={track.bpm} />
                    <CamelotKey value={track.keySignature} />
                  </div>
                  <EnergyDots value={null} />
                </div>
              </div>
            </GridListItem>
          )}
        </GridList>
      )}

      <div className="border-border shrink-0 border-t p-2">
        <Button
          onPress={() => undefined}
          isDisabled
          className="border-border text-ink-muted w-full rounded-md border border-dashed px-2 py-1.5 text-xs disabled:opacity-60"
        >
          Add tracks — Serato import lands in Phase 4
        </Button>
      </div>
    </Panel>
  );
}
