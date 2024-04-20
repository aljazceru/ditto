import { Conf } from '@/config.ts';
import { Kysely, sql } from '@/deps.ts';

export async function up(db: Kysely<any>): Promise<void> {
  if (Conf.databaseUrl.protocol === 'sqlite:') {
    await sql`CREATE VIRTUAL TABLE events_fts USING fts5(id, content)`.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('events_fts').ifExists().execute();
}
