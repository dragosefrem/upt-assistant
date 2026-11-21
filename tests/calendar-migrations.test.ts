import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { expect, it } from "vitest";
import { migrateDatabase } from "@/db/migrate";

it.each(["main", "two-way preview", "direction preview", "current calendar", "attendance goals"])("upgrades a database from %s in place", (version) => {
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
    const hasRegistration = version === "main" || version === "current calendar" || version === "attendance goals";
    if (hasRegistration) {
      apply(6);
      sqlite.exec("UPDATE users SET email_verified_at = '2026-11-21'");
    }
    if (version === "attendance goals") {
      apply(9); // The attendance branch shipped this SQL at index seven with the same timestamp.
      sqlite.exec("INSERT INTO semesters (id,academic_year,number,start_date,end_date,teaching_weeks) VALUES (1,'2026-2027',1,'2026-09-28','2027-01-22','[]')");
      sqlite.exec("INSERT INTO attendance_goals (user_id,semester_id,course_key,kind,title,minimum) VALUES ('student',1,'physics','lab','Physics',4)");
    } else if (version !== "main") {
      apply(7); // The published feature branch had this SQL at index six, with this same timestamp.
      sqlite.exec("INSERT INTO google_sync_state (user_id,cursor) VALUES ('student','test-cursor')");
      if (version !== "two-way preview") {
        apply(8);
        sqlite.exec("UPDATE google_sync_state SET mode = 'one_way', cursor = 'saved-cursor'");
      }
    }
    migrateDatabase(sqlite, "drizzle");
    migrateDatabase(sqlite, "drizzle");
    const verified = sqlite.prepare("SELECT email_verified_at FROM users").pluck().get();
    expect(verified).toBe(hasRegistration ? "2026-11-21" : null);
    expect(sqlite.prepare("SELECT count(*) FROM registration_links").pluck().get()).toBe(0);
    sqlite.exec("INSERT OR IGNORE INTO google_sync_state(user_id) VALUES ('student')");
    expect(sqlite.prepare("SELECT mode FROM google_sync_state").pluck().get()).toBe(version === "two-way preview" ? "two_way" : "one_way");
    expect(sqlite.prepare("SELECT cursor FROM google_sync_state").pluck().get())
      .toBe(version === "direction preview" || version === "current calendar" ? "saved-cursor" : null);
    expect(sqlite.prepare("SELECT minimum FROM attendance_goals").pluck().all()).toEqual(version === "attendance goals" ? [4] : []);
    expect(sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at").all())
      .toEqual(migrations.map(m => ({ hash: m.hash, created_at: m.folderMillis })));
    expect(sqlite.prepare("SELECT google_refresh_token FROM users").pluck().get()).toBe("grant");
  } finally { sqlite.close(); }
});
