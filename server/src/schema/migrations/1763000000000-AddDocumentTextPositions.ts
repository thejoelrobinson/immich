import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Create the document_text_positions table
  await sql`
    CREATE TABLE "document_text_positions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "assetId" uuid NOT NULL,
      "pageNumber" integer NOT NULL,
      "text" text NOT NULL,
      "textItems" jsonb
    );
  `.execute(db);

  // Add foreign key constraint
  await sql`
    ALTER TABLE "document_text_positions"
    ADD CONSTRAINT "document_text_positions_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "asset" ("id")
    ON UPDATE CASCADE ON DELETE CASCADE;
  `.execute(db);

  // Add composite index for efficient lookup by asset + page
  await sql`
    CREATE INDEX "idx_document_text_positions_asset_page"
    ON "document_text_positions" ("assetId", "pageNumber");
  `.execute(db);

  // Add GIN trigram index for text search
  await sql`
    CREATE INDEX "idx_document_text_positions_text"
    ON "document_text_positions"
    USING gin (f_unaccent("text") gin_trgm_ops);
  `.execute(db);

  // Add migration override for the GIN index
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES (
      'index_idx_document_text_positions_text',
      '{"type":"index","name":"idx_document_text_positions_text","sql":"CREATE INDEX \\"idx_document_text_positions_text\\" ON \\"document_text_positions\\" USING gin (f_unaccent(\\"text\\") gin_trgm_ops);"}'::jsonb
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "document_text_positions";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_document_text_positions_text';`.execute(db);
}
