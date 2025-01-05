"use client";

import { useState, useCallback, useMemo, useEffect, memo } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeProps,
  // useReactFlow,
  Panel,
  getBezierPath,
  EdgeProps,
  Handle,
  Position,
  MiniMap,
  BaseEdge,
  EdgeLabelRenderer,
  useOnViewportChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Chip,
  Button,
  Card,
  CardBody,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  Tooltip,
  // useDisclosure,
} from "@nextui-org/react";
import { Tags } from "lucide-react";
import type {
  Connection as MusicConnection,
  Genre,
  Song,
  EdgeConnection,
} from "@/types/music";

const SongNode = memo(({ data, isConnectable }: NodeProps<Node<Song>>) => {
  const { title, artist, genre, tags, bpm, keySignature, timeSignature } = data;

  return (
    <>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
      />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
      />
      <Card className="p-2 w-64">
        <CardBody>
          <h3 className="text-lg font-bold">{title}</h3>
          <p className="text-sm font-light">{artist}</p>

          <div className="flex gap-2 mt-2">
            <Chip color="secondary">{bpm} BPM</Chip>
            <Chip color="secondary">{keySignature}</Chip>
            <Chip color="secondary">{timeSignature}</Chip>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap max-w-full items-center ">
            <Chip color="success">{genre}</Chip>
            {tags.map((tag) => (
              <Chip key={tag} size="sm">
                {tag}
              </Chip>
            ))}
          </div>
        </CardBody>
      </Card>
    </>
  );
});

SongNode.displayName = "SongNode";

const CustomEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    data,
  }: EdgeProps<Edge<EdgeConnection>>) => {
    if (!data) return null;

    const { connection, handleEditConnection } = data;
    const [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    return (
      <>
        <BaseEdge id={id} path={edgePath} style={style} />
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <Tooltip
              content={
                <div className="flex flex-wrap gap-1">
                  {connection.tags.map((tag) => (
                    <Chip key={tag} color="secondary" className="text-xs">
                      {tag}
                    </Chip>
                  ))}
                </div>
              }
            >
              <Button
                variant="ghost"
                className="h-6 w-6 rounded-full bg-background/80 backdrop-blur-sm"
                onPress={() => handleEditConnection(connection)}
                isIconOnly
                aria-label="Edit connection tags"
              >
                <Tags className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        </EdgeLabelRenderer>
      </>
    );
  }
);

CustomEdge.displayName = "ConnectionEdge";

const nodeTypes = {
  songNode: SongNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

const ITEMS_PER_PAGE = 1000;

interface ConnectionsViewProps {
  data: Genre[];
  connections: MusicConnection[];
}

export function ConnectionsView({
  data,
  connections,
}: Readonly<ConnectionsViewProps>) {
  const [musicConnections, setMusicConnections] =
    useState<MusicConnection[]>(connections);
  const [filter, setFilter] = useState("");
  const [editingConnection, setEditingConnection] =
    useState<MusicConnection | null>(null);
  const [newTag, setNewTag] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  const handleEditConnection = useCallback((connection: MusicConnection) => {
    setEditingConnection(connection);
  }, []);

  const initialNodes = useMemo(
    () =>
      data.flatMap((genre, genreIndex) =>
        genre.songs.map((song, songIndex) => ({
          id: song.id,
          type: "songNode",
          position: { x: genreIndex * 300, y: songIndex * 250 },
          data: song,
        }))
      ),
    [data]
  );

  const initialEdges = useMemo(
    () =>
      musicConnections.slice(0, page * ITEMS_PER_PAGE).map((conn) => ({
        id: conn.id,
        source: conn.sourceSongId,
        target: conn.targetSongId,
        type: "custom",
        data: { connection: conn, handleEditConnection },
      })),
    [musicConnections, page, handleEditConnection]
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used in the ReactFlow component
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Edge | Connection) => {
      const newConnection: MusicConnection = {
        id: `${params.source}-${params.target}-${Date.now()}`,
        sourceSongId: params.source,
        targetSongId: params.target,
        tags: [],
      };
      setMusicConnections((prev) => [...prev, newConnection]);
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            id: newConnection.id,
            type: "custom",
            data: { connection: newConnection, handleEditConnection },
          },
          eds
        )
      );
      setEditingConnection(newConnection);
    },
    [setEdges, setMusicConnections, handleEditConnection]
  );

  const filteredEdges = useMemo(
    () =>
      edges.filter((edge) => {
        const connection = edge.data?.connection;
        return connection?.tags.some((tag) =>
          tag.toLowerCase().includes(filter.toLowerCase())
        );
      }),
    [edges, filter]
  );

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    filteredEdges.forEach((edge) => {
      ids.add(edge.source);
      ids.add(edge.target);
    });
    return ids;
  }, [filteredEdges]);

  const filteredNodes = useMemo(
    () =>
      nodes.filter((node) => {
        const song = node.data;
        const nodeMatches =
          song.title.toLowerCase().includes(filter.toLowerCase()) ||
          song.artist.toLowerCase().includes(filter.toLowerCase()) ||
          song.tags.some((tag) =>
            tag.toLowerCase().includes(filter.toLowerCase())
          );

        return nodeMatches || connectedNodeIds.has(node.id);
      }),
    [nodes, filter, connectedNodeIds]
  );

  const visibleNodeIds = useMemo(
    () => new Set(filteredNodes.map((node) => node.id)),
    [filteredNodes]
  );

  const finalFilteredEdges = useMemo(
    () =>
      filteredEdges.filter(
        (edge) =>
          visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
      ),
    [filteredEdges, visibleNodeIds]
  );

  const handleFilter = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
  }, []);

  const handleAddTagToConnection = useCallback(
    (connectionId: string, tag: string) => {
      setMusicConnections((connections) =>
        connections.map((connection) =>
          connection.id === connectionId
            ? { ...connection, tags: [...connection.tags, tag] }
            : connection
        )
      );
      setEdges((edges) =>
        edges.map((edge) =>
          edge.id === connectionId
            ? {
                ...edge,
                data: {
                  ...edge.data,
                  connection: {
                    ...edge.data.connection,
                    tags: [...edge.data.connection.tags, tag],
                  },
                },
              }
            : edge
        )
      );
      setNewTag("");
    },
    []
  );

  const handleRemoveTagFromConnection = useCallback(
    (connectionId: string, tagToRemove: string) => {
      setMusicConnections((connections) =>
        connections.map((connection) =>
          connection.id === connectionId
            ? {
                ...connection,
                tags: connection.tags.filter((tag) => tag !== tagToRemove),
              }
            : connection
        )
      );
      setEdges((edges) =>
        edges.map((edge) =>
          edge.id === connectionId
            ? {
                ...edge,
                data: {
                  ...edge.data,
                  connection: {
                    ...edge.data.connection,
                    tags: edge.data.connection.tags.filter(
                      (tag) => tag !== tagToRemove
                    ),
                  },
                },
              }
            : edge
        )
      );
    },
    []
  );

  useEffect(() => {
    const loadMoreEdges = async () => {
      setIsLoading(true);
      // Simulating an API call to load more edges
      await new Promise((resolve) => setTimeout(resolve, 500));
      const newEdges = musicConnections
        .slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
        .map((conn) => ({
          id: conn.id,
          source: conn.sourceSongId,
          target: conn.targetSongId,
          type: "custom",
          data: { connection: conn, handleEditConnection },
        }));
      setEdges((prev) => [...prev, ...newEdges]);
      setIsLoading(false);
    };

    if (
      page * ITEMS_PER_PAGE > edges.length &&
      edges.length < musicConnections.length
    ) {
      loadMoreEdges();
    }
  }, [page, musicConnections, edges, handleEditConnection]);

  useOnViewportChange({
    onEnd: (viewport) => {
      if (
        viewport.zoom < 0.5 &&
        !isLoading &&
        edges.length < musicConnections.length
      ) {
        setPage((prev) => prev + 1);
      }
    },
  });

  return (
    <div className="h-full w-full overflow-hidden relative">
      <div style={{ width: "100%", height: "100%" }}>
        <ReactFlow
          nodes={filteredNodes}
          edges={finalFilteredEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
        >
          <Background />
          <MiniMap pannable zoomable />
          <Controls />
          <Panel position="top-right">
            <Input
              type="text"
              placeholder="Filter songs or connections..."
              value={filter}
              onChange={handleFilter}
            />
          </Panel>
        </ReactFlow>
      </div>
      <Modal
        isOpen={!!editingConnection}
        onOpenChange={(open) => !open && setEditingConnection(null)}
      >
        <ModalContent>
          <ModalHeader>Edit Connection</ModalHeader>
          <ModalBody>
            {editingConnection && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium">Connection Tags</h3>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {editingConnection.tags.map((tag) => (
                      <Chip
                        key={tag}
                        color="secondary"
                        onClose={() =>
                          handleRemoveTagFromConnection(
                            editingConnection.id,
                            tag
                          )
                        }
                      >
                        {tag}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Add new tag"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                  />
                  <Button
                    onPress={() =>
                      handleAddTagToConnection(editingConnection.id, newTag)
                    }
                    disabled={!newTag.trim()}
                  >
                    Add Tag
                  </Button>
                </div>
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
