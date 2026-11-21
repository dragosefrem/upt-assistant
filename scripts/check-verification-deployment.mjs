import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import * as cheerio from "cheerio";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

const host = "127.0.0.1";
const email = "student@poli.example.test";
const publicHost = process.env.RAILWAY_PRIVATE_DOMAIN || "poli.example.test";
const publicOrigin = "https://" + publicHost;
const temp = mkdtempSync(join(tmpdir(), "poli-verification-"));
const dbPath = join(temp, "test.db");
const db = new Database(dbPath);
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
db.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
for (const migration of migrations.slice(0, -1)) {
  db.transaction(() => {
    for (const statement of migration.sql) db.exec(statement);
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(migration.hash, migration.folderMillis);
  })();
}
db.prepare("INSERT INTO users (id,email,name,password_hash,role,feed_token) VALUES (?,?,?,?,?,?)")
  .run("legacy", "existing@poli.example.test", "Existing Student", "fixture", "admin", "fixture");
const messages = [];
const mailbox = net.createServer(socket => {
  socket.setEncoding("utf8");
  socket.write("220 fixture ESMTP\r\n");
  let pending = "", data = null;
  socket.on("data", chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\r\n")) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 2);
      if (data !== null) {
        if (line === ".") {
          messages.push(data.join("\r\n"));
          data = null;
          socket.write("250 accepted\r\n");
        } else data.push(line);
      } else if (/^(EHLO|HELO) /i.test(line)) socket.write("250-fixture\r\n250 AUTH PLAIN\r\n");
      else if (/^AUTH /i.test(line)) socket.write("235 ok\r\n");
      else if (line === "DATA") { data = []; socket.write("354 continue\r\n"); }
      else if (line === "QUIT") socket.end("221 bye\r\n");
      else socket.write("250 ok\r\n");
    }
  });
});
mailbox.listen(0, host);
await once(mailbox, "listening");
const listener = net.createServer().listen(0, host);
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = "http://" + host + ":" + port;
let next;
async function start() {
  next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", host, "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_PATH: dbPath, APP_URL: publicOrigin,
      RESEND_API_KEY: "", SMTP_HOST: host, SMTP_PORT: String(mailbox.address().port),
      SMTP_USER: "poli@example.test", SMTP_PASS: "fixture", },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let check = 0; check < 100; check++) {
    try { if ((await fetch(base + "/api/health")).ok) return; } catch {}
    await pause(200);
  }
  throw new Error("The production server failed readiness");
}
async function stop() {
  if (next && next.exitCode === null) {
    const stopped = once(next, "exit");
    next.kill("SIGTERM");
    await stopped;
  }
  next = null;
}
const language = { "Accept-Language": "en" };
async function submit(path, html, fields) {
  const $ = cheerio.load(html);
  const form = $("form").filter((_, el) => $(el).find("input[name=email]").length > 0).first();
  assert.ok(form.length, "Expected the account form");
  const body = new FormData();
  form.find("input[type=hidden][name]").each((_, el) => {
    body.append($(el).attr("name"), $(el).attr("value") ?? "");
  });
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return fetch(base + path, { method: "POST", headers: { ...language, Origin: base }, body, redirect: "manual" });
}
try {
  if (process.env.RAILWAY_SERVICE_ID) {
    assert.equal(process.env.TIMETABLE_PYTHON, "/opt/timetables/bin/python", "Expected the production Docker runtime");
    assert.equal(process.versions.node.split(".")[0], "24");
  }
  await start();
  assert.equal(db.prepare("SELECT email_verified_at FROM users WHERE id='legacy'").get().email_verified_at, null);
  const registerForm = await (await fetch(base + "/register", { headers: language })).text();
  const issued = await submit("/register", registerForm, { email });
  assert.equal(issued.status, 200);
  assert.match(await issued.text(), /Check student@poli.example.test for your verification link/);
  assert.equal(issued.headers.getSetCookie().some(s => s.startsWith("upt_session=")), false);
  assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 1);
  assert.equal(messages.length, 1);
  const mail = messages[0];
  let body = mail.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  if (/Content-Transfer-Encoding: base64/i.test(mail)) body = Buffer.from(body, "base64").toString();
  else body = body.replace(/=\r\n/g, "");
  const link = new URL(body.match(/https:\/\/[^\s]+\/verify\/[\w-]{43}/)[0]);
  assert.equal(link.origin, publicOrigin);
  await stop();
  await start();
  const getForm = () => fetch(base + link.pathname, { headers: language });
  const read = await getForm();
  assert.match(read.headers.get("cache-control"), /no-store/);
  assert.match(await read.text(), /Finish creating your account/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 1);
  const credentials = { email, password: "temporary-test-password" };
  const confirmed = await submit(link.pathname, await (await getForm()).text(), { ...credentials, name: "Railway Test" });
  assert.equal(confirmed.status, 303);
  assert.equal(new URL(confirmed.headers.get("location"), base).pathname, "/onboarding");
  assert.ok(confirmed.headers.getSetCookie().some(s => s.startsWith("upt_session=") && /HttpOnly/i.test(s) && /Secure/i.test(s)));
  assert.ok(db.prepare("SELECT email_verified_at FROM users WHERE email=?").get(email).email_verified_at);
  assert.match(await (await getForm()).text(), /Request a new verification link/);
  const loginHtml = await (await fetch(base+"/login", { headers: language })).text();
  const login = await submit("/login", loginHtml, credentials);
  assert.equal(login.status, 303);
  assert.equal(new URL(login.headers.get("location"), base).pathname, "/onboarding");
  const provider = await fetch("https://api.resend.com/emails", { signal: AbortSignal.timeout(10000) });
  assert.ok([401,403].includes(provider.status), "Expected the provider to require authentication");
  console.log("POLI_SIGNUP_PASS: migration, captured verification mail, restart, GET, confirmation, secure session, replay, sign-in, and HTTPS connectivity to Resend.");
} catch (error) {
  console.error("POLI_SIGNUP_FAIL:", String(error).replace(/\/verify\/[\w-]+/g, "/verify/[redacted]").slice(0, 550));
  process.exitCode = 1;
} finally {
  await stop();
  mailbox.close();
  db.close();
}
