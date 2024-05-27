import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('connections')
    .addColumn('api_token', 'text', (col) => col.primaryKey().unique().notNull())
    .addColumn('user_pubkey', 'text', (col) => col.notNull())
    .addColumn('server_seckey', 'blob', (col) => col.notNull())
    .addColumn('server_pubkey', 'text', (col) => col.notNull())
    .addColumn('relays', 'text', (col) => col.defaultTo('[]'))
    .addColumn('connected_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('connections').execute();
}
