import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema";

/** Registration shipped on main before the first calendar migration on the feature branch.
 * Drizzle compares timestamps, so an existing calendar preview would skip registration. */
export function migrateDatabase(sqlite: Database.Database, migrationsFolder: string) {
  const config = { migrationsFolder };
  const missingRegistration = sqlite.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'google_sync_state'
      AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'registration_links')
  `);
  if (missingRegistration.get()) {
    sqlite.transaction(() => {
      if (!missingRegistration.get()) return;
      const registration = readMigrationFiles(config).find(m => m.folderMillis === 1795281491440);
      if (!registration) throw new Error("The registration migration is missing.");
      for (const sql of registration.sql) sqlite.exec(sql);
      sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(registration.hash, registration.folderMillis);
    }).immediate();
  }
  const db = drizzle(sqlite, { schema });
  migrate(db, config);
  return db;
}
