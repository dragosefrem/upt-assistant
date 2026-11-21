import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema";

/** The feature branches shipped different subsets of the migrations.
 * Their timestamps survived renumbering, so use each journal entry to identify applied SQL. */
export function migrateDatabase(sqlite: Database.Database, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder });
  sqlite.transaction(() => {
    sqlite.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    const applied = new Set(sqlite.prepare<[], number>("SELECT created_at FROM __drizzle_migrations").pluck().all());
    const record = sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
    for (const migration of migrations) {
      if (applied.has(migration.folderMillis)) continue;
      for (const statement of migration.sql) sqlite.exec(statement);
      record.run(migration.hash, migration.folderMillis);
    }
  }).immediate();
  return drizzle(sqlite, { schema });
}
