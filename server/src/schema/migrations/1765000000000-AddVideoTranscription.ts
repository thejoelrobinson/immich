import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Create the transcription_segments table
  await sql`
    CREATE TABLE IF NOT EXISTS "transcription_segments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "assetId" uuid NOT NULL,
      "speaker" character varying,
      "startTime" real NOT NULL,
      "endTime" real NOT NULL,
      "text" text NOT NULL,
      "words" jsonb
    );
  `.execute(db);

  // Add foreign key constraint (use DO block to check if exists)
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'transcription_segments_assetId_fkey'
      ) THEN
        ALTER TABLE "transcription_segments"
        ADD CONSTRAINT "transcription_segments_assetId_fkey"
        FOREIGN KEY ("assetId") REFERENCES "asset" ("id")
        ON UPDATE CASCADE ON DELETE CASCADE;
      END IF;
    END $$;
  `.execute(db);

  // Add composite index for efficient lookup by asset + time
  await sql`
    CREATE INDEX IF NOT EXISTS "idx_transcription_segments_asset_time"
    ON "transcription_segments" ("assetId", "startTime");
  `.execute(db);

  // Add GIN trigram index for text search
  await sql`
    CREATE INDEX IF NOT EXISTS "idx_transcription_segments_text"
    ON "transcription_segments"
    USING gin (f_unaccent("text") gin_trgm_ops);
  `.execute(db);

  // Add migration override for the GIN index
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES (
      'index_idx_transcription_segments_text',
      '{"type":"index","name":"idx_transcription_segments_text","sql":"CREATE INDEX \\"idx_transcription_segments_text\\" ON \\"transcription_segments\\" USING gin (f_unaccent(\\"text\\") gin_trgm_ops);"}'::jsonb
    )
    ON CONFLICT ("name") DO NOTHING;
  `.execute(db);

  // Add transcriptionExtractedAt column to asset_job_status
  await sql`
    ALTER TABLE "asset_job_status"
    ADD COLUMN IF NOT EXISTS "transcriptionExtractedAt" timestamp with time zone;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN IF EXISTS "transcriptionExtractedAt";`.execute(db);
  await sql`DROP TABLE IF EXISTS "transcription_segments";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_transcription_segments_text';`.execute(db);
}
