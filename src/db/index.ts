import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { seed } from "./seed";

export type DB = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __uptDb?: DB };

function open(): DB {
  const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "upt.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  // Migrations are idempotent, so applying them on first connection keeps a fresh
  // checkout (or a fresh deploy) working without a separate setup step.
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  seed(db);
  return db;
}

/** Lazily opened, process-wide database handle (survives dev-server hot reloads). */
export function getDb(): DB {
  globalForDb.__uptDb ??= open();
  return globalForDb.__uptDb;
}

export { schema };
