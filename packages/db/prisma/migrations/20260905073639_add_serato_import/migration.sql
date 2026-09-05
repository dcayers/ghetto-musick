-- CreateEnum
CREATE TYPE "import_run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "tracks" ADD COLUMN     "album" TEXT,
ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "genre" TEXT;

-- CreateTable
CREATE TABLE "local_files" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "seratoPath" TEXT NOT NULL,
    "canonicalPath" TEXT NOT NULL,
    "canonicalPathHash" TEXT NOT NULL,
    "fileType" TEXT,
    "sizeBytes" BIGINT,
    "fileModifiedAt" TIMESTAMP(3),
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'serato',
    "root" TEXT NOT NULL,
    "status" "import_run_status" NOT NULL DEFAULT 'RUNNING',
    "tracksSeen" INTEGER NOT NULL DEFAULT 0,
    "tracksCreated" INTEGER NOT NULL DEFAULT 0,
    "tracksUpdated" INTEGER NOT NULL DEFAULT 0,
    "filesMissing" INTEGER NOT NULL DEFAULT 0,
    "streamingSeen" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_files_workspaceId_missing_idx" ON "local_files"("workspaceId", "missing");

-- CreateIndex
CREATE UNIQUE INDEX "local_files_workspaceId_canonicalPathHash_key" ON "local_files"("workspaceId", "canonicalPathHash");

-- CreateIndex
CREATE UNIQUE INDEX "local_files_trackId_key" ON "local_files"("trackId");

-- CreateIndex
CREATE INDEX "import_runs_workspaceId_startedAt_idx" ON "import_runs"("workspaceId", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "local_files" ADD CONSTRAINT "local_files_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_files" ADD CONSTRAINT "local_files_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
