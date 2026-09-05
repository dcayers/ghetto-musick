-- CreateTable
CREATE TABLE "sets" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "targetBpm" DECIMAL(6,2),
    "targetKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_items" (
    "id" UUID NOT NULL,
    "setId" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "rank" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "set_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sets_workspaceId_createdAt_id_idx" ON "sets"("workspaceId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "set_items_setId_rank_idx" ON "set_items"("setId", "rank");

-- CreateIndex
CREATE INDEX "set_items_trackId_idx" ON "set_items"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "set_items_setId_rank_key" ON "set_items"("setId", "rank");

-- AddForeignKey
ALTER TABLE "sets" ADD CONSTRAINT "sets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_items" ADD CONSTRAINT "set_items_setId_fkey" FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_items" ADD CONSTRAINT "set_items_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
