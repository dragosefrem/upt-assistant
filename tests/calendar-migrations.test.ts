import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { expect, it } from "vitest";
import { migrateDatabase } from "@/db/migrate";

// Entries 0–5 are shared. Later entries originally shipped under different file numbers.
it.each([
  { version: "main", applied: [6] },
  { version: "two-way preview", applied: [7] },
  { version: "direction preview", applied: [7, 8] },
  { version: "current calendar", applied: [6, 7, 8] },
  { version: "attendance goals", applied: [6, 9] },
  { version: "interactive replies", applied: [6, 10] },
  { version: "previous integration", applied: [6, 7, 8, 9, 11] },
])("upgrades a database from $version in place", ({ applied }) => {
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
    sqlite.exec("INSERT INTO attendance (user_id,series_key,course_key,date,status,title,kind,start_min,end_min) VALUES ('student','e:physics-lab','physics','2026-11-20','attended','Physics','lab',600,660)");
    for (const index of applied) apply(index);
    if (applied.includes(6)) sqlite.exec("UPDATE users SET email_verified_at = '2026-11-21'");
    if (applied.includes(7)) {
      sqlite.exec("INSERT INTO google_sync_state (user_id,cursor) VALUES ('student','test-cursor')");
      if (applied.includes(8)) sqlite.exec("UPDATE google_sync_state SET mode = 'one_way', cursor = 'saved-cursor'");
    }
    if (applied.includes(9)) {
      sqlite.exec("INSERT INTO semesters (id,academic_year,number,start_date,end_date,teaching_weeks) VALUES (1,'2026-2027',1,'2026-09-28','2027-01-22','[]')");
      sqlite.exec("INSERT INTO attendance_goals (user_id,semester_id,course_key,kind,title,minimum) VALUES ('student',1,'physics','lab','Physics',4)");
    }
    const card = JSON.stringify({ type: "free", from: "2026-11-20", to: "2026-11-20", for: "Student", count: 1,
      free: [{ date: "2026-11-20", start: "12:00", end: "13:00", minutes: 60 }] });
    sqlite.exec("INSERT INTO chat_messages (user_id,role,content) VALUES ('student','assistant','Free at noon')");
    if (applied.includes(10)) sqlite.prepare("UPDATE chat_messages SET card = ?").run(card);
    if (applied.includes(11)) sqlite.exec("UPDATE attendance SET occurrence_key = '2026-11-19'");
    migrateDatabase(sqlite, "drizzle");
    migrateDatabase(sqlite, "drizzle");
    const verified = sqlite.prepare("SELECT email_verified_at FROM users").pluck().get();
    expect(verified).toBe(applied.includes(6) ? "2026-11-21" : null);
    expect(sqlite.prepare("SELECT count(*) FROM registration_links").pluck().get()).toBe(0);
    sqlite.exec("INSERT OR IGNORE INTO google_sync_state(user_id) VALUES ('student')");
    expect(sqlite.prepare("SELECT mode FROM google_sync_state").pluck().get()).toBe(applied.includes(7) && !applied.includes(8) ? "two_way" : "one_way");
    expect(sqlite.prepare("SELECT cursor FROM google_sync_state").pluck().get())
      .toBe(applied.includes(8) ? "saved-cursor" : null);
    expect(sqlite.prepare("SELECT minimum FROM attendance_goals").pluck().all()).toEqual(applied.includes(9) ? [4] : []);
    expect(sqlite.prepare("SELECT status, start_min, occurrence_key FROM attendance").all())
      .toEqual([{ status: "attended", start_min: 600, occurrence_key: applied.includes(11) ? "2026-11-19" : "" }]);
    expect(sqlite.prepare("SELECT content, card FROM chat_messages").get())
      .toEqual({ content: "Free at noon", card: applied.includes(10) ? card : null });
    expect(sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at").all())
      .toEqual(migrations.map(m => ({ hash: m.hash, created_at: m.folderMillis })));
    expect(sqlite.prepare("SELECT google_refresh_token FROM users").pluck().get()).toBe("grant");
  } finally { sqlite.close(); }
});
