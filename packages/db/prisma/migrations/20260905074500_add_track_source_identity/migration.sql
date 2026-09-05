-- Provider identity for a track with no local audio (plan §7.1, §7.4).
-- Serato stores it in the `pfil` slot as `<id>.spotify`, and it is the only
-- exact key a streaming entry has.
ALTER TABLE "tracks" ADD COLUMN "sourceProvider" TEXT;
ALTER TABLE "tracks" ADD COLUMN "sourceExternalId" TEXT;

-- Unique per workspace where the external id is non-null. Postgres treats
-- nulls as distinct, so the rows without one do not collide.
CREATE UNIQUE INDEX "tracks_workspaceId_sourceProvider_sourceExternalId_key"
  ON "tracks"("workspaceId", "sourceProvider", "sourceExternalId");
