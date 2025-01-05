"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Node,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  // Plus, GripVertical,
  Clock3,
  Music2,
  Piano,
} from "lucide-react";
import { useListData } from "@react-stately/data";
import {
  useDragAndDrop,
  isTextDropItem,
  GridList,
  GridListItem,
} from "react-aria-components";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  // Checkbox,
  Chip,
  // Modal,
  // ModalContent,
  // ModalHeader,
  Skeleton,
} from "@nextui-org/react";

// import { AddSongForm } from "@/components/forms/add-song-form";
// import { AddGenreForm } from "@/components/forms/add-genre-form";
// import { EditSongForm } from "@/components/forms/edit-song-form";
import { type Genre, type Song } from "@/types/music";
import { cn } from "@/lib/utils";

interface GenresViewProps {
  data: Genre[];
}

interface SongCardProps {
  song: Song;
  isSelected: boolean;
  onEdit: (song: Song) => void;
  onSelectionChange: (selected: boolean) => void;
}

function SongCard({ song, isSelected, onEdit }: SongCardProps) {
  return (
    <Card className={cn("mb-2", isSelected && "border border-primary")}>
      <CardBody className="p-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <div className="font-medium">{song.title}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                onEdit(song);
              }}
            >
              Edit
            </Button>
          </div>
          <div className="text-sm text-muted-foreground">{song.artist}</div>
          <div className="grid grid-flow-col-dense grid-cols-3  border">
            <div className="text-sm text-muted-foreground">BPM: {song.bpm}</div>
            <div className="flex gap-1 text-sm text-muted-foreground items-center">
              <Piano size={16} aria-label="key signature" /> {song.keySignature}
            </div>
            <div className="flex gap-1 text-sm text-muted-foreground items-center">
              <div className="relative">
                <Clock3 size={20} />
                <Music2
                  size={10}
                  strokeWidth={3}
                  className="absolute bottom-[1px] rounded-full -right-[2px]  bg-gradient-to-br from-transparent from-10% via-white via-30% to-white to-90%"
                />
              </div>
              {song.timeSignature}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {song.tags.map((tag) => (
              <Chip key={tag} color="secondary" size="sm">
                {tag}
              </Chip>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

const GenreNode = ({ data }: NodeProps<Node<Genre>>) => {
  // const [addSongToGenre, setAddSongToGenre] = useState<string | null>(null);
  const [
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    editingSong,
    setEditingSong,
  ] = useState<Song | null>(null);

  const list = useListData({
    initialItems: data.songs,
    getKey: (item) => item.id,
  });

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => {
      return [...keys].map((key) => {
        const item = list.getItem(key)!;

        return {
          "song-item": JSON.stringify(item),
          "text/plain": item?.title,
        };
      });
    },
    acceptedDragTypes: ["song-item"],
    getDropOperation: () => "move",
    async onInsert(e) {
      const processedItems = await Promise.all(
        e.items
          .filter(isTextDropItem)
          .map(async (item) => JSON.parse(await item.getText("song-item")))
      );
      if (e.target.dropPosition === "before") {
        list.insertBefore(e.target.key, ...processedItems);
      } else if (e.target.dropPosition === "after") {
        list.insertAfter(e.target.key, ...processedItems);
      }
    },
    async onRootDrop(e) {
      const processedItems = await Promise.all(
        e.items
          .filter(isTextDropItem)
          .map(async (item) => JSON.parse(await item.getText("song-item")))
      );
      list.append(...processedItems);
    },
    onReorder(e) {
      if (e.target.dropPosition === "before") {
        list.moveBefore(e.target.key, e.keys);
      } else if (e.target.dropPosition === "after") {
        list.moveAfter(e.target.key, e.keys);
      }
    },
    onDragEnd(e) {
      if (e.dropOperation === "move" && !e.isInternal) {
        list.remove(...e.keys);
      }
    },
    renderDragPreview: (keys) => {
      const count = keys.length;
      return (
        <div className="bg-background border rounded p-2 shadow-lg">
          <span className="font-medium">
            {count} item{count !== 1 ? "s" : ""} selected
          </span>
        </div>
      );
    },
  });

  return (
    <div className="w-80">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <h2 className="text-sm font-medium">{data.name}</h2>
        </CardHeader>
        <CardBody>
          <GridList
            aria-label={`Songs in ${data.name}`}
            selectionMode="multiple"
            selectedKeys={list.selectedKeys}
            onSelectionChange={list.setSelectedKeys}
            items={list.items}
            dragAndDropHooks={dragAndDropHooks}
            renderEmptyState={() => "Drop songs here"}
          >
            {(song) => {
              return (
                <GridListItem
                  key={song.id}
                  textValue={song.title}
                  className="nodrag nopan"
                >
                  {({ isSelected }) => (
                    <SongCard
                      song={song}
                      onEdit={setEditingSong}
                      isSelected={isSelected}
                      onSelectionChange={(selected: boolean) => {
                        if (selected) {
                          list.setSelectedKeys(
                            new Set([...list.selectedKeys, song.id])
                          );
                        } else {
                          const newKeys = new Set(list.selectedKeys);
                          newKeys.delete(song.id);
                          list.setSelectedKeys(newKeys);
                        }
                      }}
                    />
                  )}
                </GridListItem>
              );
            }}
          </GridList>
        </CardBody>
      </Card>
    </div>
  );
};

export function GenresView({ data }: GenresViewProps) {
  const [genres, setGenres] = useState<Genre[]>(data);
  // const [showAddGenre, setShowAddGenre] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [edges, , onEdgesChange] = useEdgesState([]);

  const nodeTypes = useMemo(() => ({ genreNode: GenreNode }), []);

  // Simulate loading
  useMemo(() => {
    setTimeout(() => setIsLoading(false), 1000);
  }, []);

  const handleAddSong = useCallback((genreId: string, song: Partial<Song>) => {
    setGenres((prev) =>
      prev.map((genre) => {
        if (genre.id === genreId) {
          return {
            ...genre,
            songs: [...genre.songs, song as Song],
          };
        }
        return genre;
      })
    );
  }, []);

  const handleEditSong = useCallback((updatedSong: Song) => {
    setGenres((prev) =>
      prev.map((genre) => ({
        ...genre,
        songs: genre.songs.map((song) =>
          song.id === updatedSong.id ? updatedSong : song
        ),
      }))
    );
  }, []);

  // const handleAddGenre = useCallback((genre: Genre) => {
  //   setGenres((prev) => [...prev, genre]);
  //   setShowAddGenre(false);
  // }, []);

  const nodes: Node[] = useMemo(
    () =>
      genres.map((genre, index) => ({
        id: genre.id,
        type: "genreNode",
        position: { x: index * 350, y: 0 },
        data: {
          ...genre,
          handleAddSong: (song: Partial<Song>) => handleAddSong(genre.id, song),
          handleEditSong,
        },
        draggable: true,
      })),
    [genres, handleAddSong, handleEditSong]
  );

  const [reactFlowNodes, , onNodesChange] = useNodesState(nodes);

  if (isLoading) {
    return (
      <div className="h-full w-full overflow-hidden">
        <div className="p-4">
          <div className="flex gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-80 flex-shrink-0">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <Skeleton className="h-4 w-[100px]" />
                    <Skeleton className="h-8 w-8 rounded-full" />
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-2">
                      {[1, 2, 3].map((j) => (
                        <Skeleton key={j} className="h-[100px] w-full" />
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <ReactFlow
        nodes={reactFlowNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
