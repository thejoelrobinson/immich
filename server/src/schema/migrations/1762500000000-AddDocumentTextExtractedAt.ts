import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" ADD COLUMN IF NOT EXISTS "documentTextExtractedAt" timestamp with time zone`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN IF EXISTS "documentTextExtractedAt"`.execute(db);
}
