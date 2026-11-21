import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { expect, it } from "vitest";
import { migrateDatabase } from "@/db/migrate";

it.each(["main", "two-way preview", "direction preview"])("upgrades a database from %s in place", (version) => {
  const sqlite = new Database(":memory:");
  try {
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
    sqlite.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    const apply = (index: number) => {
      const migration = migrations[index];
      for (const sql of migration.sql) sqlite.exec(sql);
      sqlite.prepare("INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)").run(migration.hash, migration.folderMillis);
    };
    for (let i = 0; i < 6; i++) apply(i);
    sqlite.exec("INSERT INTO users (id,name,email,password_hash,feed_token,google_refresh_token) VALUES ('student','Student','p@example.test','x','feed','grant')");
    if (version === "main") {
      apply(6);
      sqlite.exec("UPDATE users SET email_verified_at = '2026-11-21'");
    } else {
      apply(7); // The published feature branch had this SQL at index six, with this same timestamp.
      sqlite.exec("INSERT INTO google_sync_state (user_id,cursor) VALUES ('student','test-cursor')");
      if (version === "direction preview") {
        apply(8);
        sqlite.exec("UPDATE google_sync_state SET mode = 'one_way'");
      }
    }
    migrateDatabase(sqlite, "drizzle");
    migrateDatabase(sqlite, "drizzle");
    const verified = sqlite.prepare("SELECT email_verified_at FROM users").pluck().get();
    expect(verified).toBe(version === "main" ? "2026-11-21" : null);
    expect(sqlite.prepare("SELECT count(*) FROM registration_links").pluck().get()).toBe(0);
    sqlite.exec("INSERT OR IGNORE INTO google_sync_state(user_id) VALUES ('student')");
    expect(sqlite.prepare("SELECT mode FROM google_sync_state").pluck().get()).toBe(version === "two-way preview" ? "two_way" : "one_way");
    expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(migrations.length);
    expect(sqlite.prepare("SELECT google_refresh_token FROM users").pluck().get()).toBe("grant");
  } finally { sqlite.close(); }
});
