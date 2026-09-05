-- CreateTable
CREATE TABLE "graphs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graphs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_nodes" (
    "id" UUID NOT NULL,
    "graphId" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transitions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "fromTrackId" UUID NOT NULL,
    "toTrackId" UUID NOT NULL,
    "technique" TEXT NOT NULL DEFAULT 'blend',
    "notes" TEXT,
    "tags" TEXT[],
    "score" DECIMAL(4,3),
    "scoreAlgorithm" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "graphs_workspaceId_createdAt_id_idx" ON "graphs"("workspaceId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "graph_nodes_trackId_idx" ON "graph_nodes"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "graph_nodes_graphId_trackId_key" ON "graph_nodes"("graphId", "trackId");

-- CreateIndex
CREATE INDEX "transitions_workspaceId_fromTrackId_idx" ON "transitions"("workspaceId", "fromTrackId");

-- CreateIndex
CREATE INDEX "transitions_workspaceId_toTrackId_idx" ON "transitions"("workspaceId", "toTrackId");

-- CreateIndex
CREATE UNIQUE INDEX "transitions_workspaceId_fromTrackId_toTrackId_technique_key" ON "transitions"("workspaceId", "fromTrackId", "toTrackId", "technique");

-- AddForeignKey
ALTER TABLE "graphs" ADD CONSTRAINT "graphs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "graphs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_fromTrackId_fkey" FOREIGN KEY ("fromTrackId") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transitions" ADD CONSTRAINT "transitions_toTrackId_fkey" FOREIGN KEY ("toTrackId") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
