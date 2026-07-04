import * as SQLite from "expo-sqlite";

// Key material handed to the SQLite layer to open/encrypt the database. `null` =
// plaintext. "raw" = a 64-hex-char key applied directly (recoverable mode, full
// entropy → skips SQLCipher's PBKDF2). "passphrase" = the user's passcode run
// through SQLCipher's own PBKDF2 (zero-knowledge mode). The value is produced by
// security.ts; db.ts only consumes it. See security.ts for the rationale.
export type KeyMaterial =
  | { form: "raw"; hex: string }
  | { form: "passphrase"; secret: string }
  | null;

// SQLCipher: the KEY clause for `PRAGMA key`/`ATTACH … KEY`. Raw keys use the
// x'…' hex form (double-quoted); passphrases are single-quoted with '' escaping.
function keyClause(key: KeyMaterial): string {
  if (!key) return "''"; // empty key = unencrypted attach/open
  return key.form === "raw"
    ? `"x'${key.hex}'"`
    : `'${key.secret.replace(/'/g, "''")}'`;
}

// Apply an encryption key to a freshly-opened connection and prove it works.
// Order matters: PRAGMA key MUST be the first statement after open, before WAL or
// any schema. Guards that SQLCipher is actually compiled in (cipher_version), then
// forces a read so a wrong/corrupt key surfaces as a throw (SQLITE_NOTADB) instead
// of silently returning garbage.
async function applyKey(
  dbi: SQLite.SQLiteDatabase,
  key: KeyMaterial,
): Promise<void> {
  if (!key) return; // plaintext — nothing to do
  await dbi.execAsync(`PRAGMA key = ${keyClause(key)};`);
  const cv = await dbi.getFirstAsync<{ cipher_version: string | null }>(
    "PRAGMA cipher_version;",
  );
  if (!cv || !cv.cipher_version)
    throw new Error("SQLCipher unavailable (cipher_version empty)");
  // Throws "file is not a database" (SQLITE_NOTADB) on a wrong key.
  await dbi.getFirstAsync("SELECT count(*) FROM sqlite_master");
}

// Kairos local-first store (J2). Minimal v1: tasks + intent log.
export type TaskStatus =
  | "todo"
  | "pending" // en attente
  | "done" // accomplie
  | "postponed" // à reporter
  | "archived"; // archivée

export type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  due: string | null; // raw expression as said ("demain 14h")
  due_iso: string | null; // resolved ISO datetime (START, for calendar filtering)
  end_iso: string | null; // resolved ISO END datetime (appointments with a range)
  priority: number | null;
  category: string | null; // level-1 folder
  subcategory: string | null; // level-2 sub-folder
  person: string | null; // WHO — associated person
  place: string | null; // WHERE — place / context
  note: string | null; // free-form textual note, dictated vocally
  created_at: number;
  completed_at: number | null;
};

// Describes how to undo the last mutation (for the "annule" intent).
export type Revert =
  | { kind: "delete"; id: number } // undo a create
  | { kind: "update"; id: number; fields: Record<string, unknown> } // restore columns
  | { kind: "reinsert"; task: Task } // undo a delete
  | { kind: "reinsertMany"; tasks: Task[] }; // undo a multi-delete

const UPDATABLE = new Set([
  "title",
  "due",
  "due_iso",
  "end_iso",
  "priority",
  "category",
  "subcategory",
  "person",
  "place",
  "note",
  "status",
  "completed_at",
]);

let db: SQLite.SQLiteDatabase | null = null;

// Open the app database (the singleton used by every query below). `file` is the
// active DB filename (plaintext "kairos.db" or an encrypted slot); `key` decrypts
// it (null = plaintext). The PRAGMA key + SQLCipher guard run before any schema.
export async function initDb(opts?: {
  key?: KeyMaterial;
  file?: string;
}): Promise<void> {
  if (db) return;
  db = await SQLite.openDatabaseAsync(opts?.file ?? "kairos.db");
  await applyKey(db, opts?.key ?? null);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS task (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      due TEXT,
      due_iso TEXT,
      priority INTEGER,
      category TEXT,
      subcategory TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS intent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transcript TEXT,
      tool TEXT,
      params_json TEXT,
      result TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gcal_map (
      task_id INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      synced_at INTEGER NOT NULL
    );
  `);
  // Migrations for existing installs (ignore "duplicate column" errors).
  for (const col of [
    "category TEXT",
    "subcategory TEXT",
    "due_iso TEXT",
    "end_iso TEXT",
    "person TEXT",
    "place TEXT",
    "note TEXT",
  ]) {
    try {
      await db.execAsync(`ALTER TABLE task ADD COLUMN ${col}`);
    } catch {
      // column already exists — ignore
    }
  }
}

function requireDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error("DB not initialised");
  return db;
}

// Close the singleton so a migration can safely re-key/rewrite the file. Must be
// called before any exportDatabase/re-open.
export async function closeDb(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
}

export function isDbOpen(): boolean {
  return db !== null;
}

// True if `file` opens cleanly with `key` (used to verify a migration output
// before we trust it). Opens its own throwaway connection.
export async function verifyKey(
  file: string,
  key: KeyMaterial,
): Promise<boolean> {
  let probe: SQLite.SQLiteDatabase | null = null;
  try {
    probe = await SQLite.openDatabaseAsync(file, { useNewConnection: true });
    await applyKey(probe, key);
    return true;
  } catch {
    return false;
  } finally {
    if (probe) await probe.closeAsync().catch(() => {});
  }
}

// Delete a database file and its -wal/-shm sidecars. The caller must ensure no
// live connection to it remains.
export async function deleteDatabaseFile(file: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(file).catch(() => {});
}

// Copy the entire contents of one database into a fresh other, changing the key
// in the process — the crash-safe core of encrypt/decrypt/rekey. The source is
// opened + verified with `srcKey`; a brand-new `dstFile` is written with `dstKey`
// via SQLCipher's sqlcipher_export, then re-opened to prove it decrypts. The
// source is NEVER touched destructively, so a crash leaves it authoritative. The
// caller flips the active-file pointer and deletes the source only AFTER this
// resolves.
export async function exportDatabase(
  srcFile: string,
  srcKey: KeyMaterial,
  dstFile: string,
  dstKey: KeyMaterial,
): Promise<void> {
  // Clear any stale destination from a previously-interrupted run.
  await SQLite.deleteDatabaseAsync(dstFile).catch(() => {});
  const src = await SQLite.openDatabaseAsync(srcFile, {
    useNewConnection: true,
  });
  try {
    await applyKey(src, srcKey); // key + guard + verify source opens
    // If we're producing an ENCRYPTED destination, make sure SQLCipher is really
    // compiled in — otherwise the ATTACH … KEY would silently write plaintext.
    if (dstKey) {
      const cv = await src.getFirstAsync<{ cipher_version: string | null }>(
        "PRAGMA cipher_version;",
      );
      if (!cv || !cv.cipher_version)
        throw new Error("SQLCipher unavailable (cipher_version empty)");
    }
    // Collapse the WAL into the main file so the export sees a complete DB with
    // no live sidecars.
    await src.execAsync("PRAGMA wal_checkpoint(TRUNCATE);");
    await src.execAsync("PRAGMA journal_mode = DELETE;");
    const dstPath = `${SQLite.defaultDatabaseDirectory}/${dstFile}`;
    await src.execAsync(
      `ATTACH DATABASE '${dstPath}' AS mig KEY ${keyClause(dstKey)};`,
    );
    await src.execAsync("SELECT sqlcipher_export('mig');");
    await src.execAsync("DETACH DATABASE mig;");
  } finally {
    await src.closeAsync().catch(() => {});
  }
  // Prove the destination opens with its key before the caller trusts it.
  const ok = await verifyKey(dstFile, dstKey);
  if (!ok) throw new Error(`export verify failed for ${dstFile}`);
}

export async function createTask(input: {
  title: string;
  due?: string | null;
  dueIso?: string | null;
  endIso?: string | null;
  priority?: number | null;
  category?: string | null;
  subcategory?: string | null;
  person?: string | null;
  place?: string | null;
  note?: string | null;
}): Promise<Task> {
  const now = Date.now();
  const res = await requireDb().runAsync(
    "INSERT INTO task (title, status, due, due_iso, end_iso, priority, category, subcategory, person, place, note, created_at) VALUES (?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    input.title,
    input.due ?? null,
    input.dueIso ?? null,
    input.endIso ?? null,
    input.priority ?? null,
    input.category ?? null,
    input.subcategory ?? null,
    input.person ?? null,
    input.place ?? null,
    input.note ?? null,
    now,
  );
  return {
    id: res.lastInsertRowId,
    title: input.title,
    status: "todo",
    due: input.due ?? null,
    due_iso: input.dueIso ?? null,
    end_iso: input.endIso ?? null,
    priority: input.priority ?? null,
    category: input.category ?? null,
    subcategory: input.subcategory ?? null,
    person: input.person ?? null,
    place: input.place ?? null,
    note: input.note ?? null,
    created_at: now,
    completed_at: null,
  };
}

// "open" = everything still actionable on screen (todo/pending/postponed);
// done and archived are hidden. "all" returns every row.
export async function listTasks(
  filter: "all" | "open" = "open",
): Promise<Task[]> {
  const where =
    filter === "open" ? "WHERE status NOT IN ('done','archived')" : "";
  return requireDb().getAllAsync<Task>(
    `SELECT * FROM task ${where} ORDER BY (due_iso IS NULL), due_iso ASC, (priority IS NULL), priority ASC, created_at DESC`,
  );
}

// Fuzzy match the latest still-open task by phrase (full phrase, then by word).
async function findOpenByTitle(phrase: string): Promise<Task | null> {
  const dbi = requireDb();
  const q =
    "SELECT * FROM task WHERE status NOT IN ('done','archived') AND lower(title) LIKE ? ORDER BY created_at DESC LIMIT 1";
  let row = await dbi.getFirstAsync<Task>(q, `%${phrase.toLowerCase()}%`);
  if (!row) {
    const words = phrase
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    for (const w of words) {
      row = await dbi.getFirstAsync<Task>(q, `%${w}%`);
      if (row) break;
    }
  }
  return row ?? null;
}

export async function setStatusByTitle(
  phrase: string,
  status: TaskStatus,
): Promise<Task | null> {
  const row = await findOpenByTitle(phrase);
  if (!row) return null;
  const completedAt = status === "done" ? Date.now() : null;
  await requireDb().runAsync(
    "UPDATE task SET status=?, completed_at=? WHERE id=?",
    status,
    completedAt,
    row.id,
  );
  return { ...row, status, completed_at: completedAt };
}

export async function getTaskById(id: number): Promise<Task | null> {
  return (
    (await requireDb().getFirstAsync<Task>("SELECT * FROM task WHERE id=?", id)) ??
    null
  );
}

// Open tasks matching a phrase (full phrase first, then by word) — used to
// resolve a voice reference for update/delete/status, with disambiguation.
export async function findCandidates(
  phrase: string,
  limit = 6,
): Promise<Task[]> {
  const dbi = requireDb();
  const q =
    "SELECT * FROM task WHERE status NOT IN ('done','archived') AND lower(title) LIKE ? ORDER BY created_at DESC LIMIT ?";
  let rows = await dbi.getAllAsync<Task>(q, `%${phrase.toLowerCase()}%`, limit);
  if (rows.length === 0) {
    const words = phrase
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const seen = new Set<number>();
    const acc: Task[] = [];
    for (const w of words) {
      for (const r of await dbi.getAllAsync<Task>(q, `%${w}%`, limit)) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          acc.push(r);
        }
      }
    }
    rows = acc.slice(0, limit);
  }
  return rows;
}

export async function updateTaskById(
  id: number,
  changes: Record<string, unknown>,
): Promise<void> {
  const cols = Object.keys(changes).filter((c) => UPDATABLE.has(c));
  if (!cols.length) return;
  const set = cols.map((c) => `${c}=?`).join(", ");
  const vals = cols.map((c) => changes[c] ?? null);
  await requireDb().runAsync(
    `UPDATE task SET ${set} WHERE id=?`,
    ...vals,
    id,
  );
}

export async function deleteTaskById(id: number): Promise<void> {
  await requireDb().runAsync("DELETE FROM task WHERE id=?", id);
}

export async function insertFullTask(t: Task): Promise<void> {
  await requireDb().runAsync(
    "INSERT INTO task (id,title,status,due,due_iso,end_iso,priority,category,subcategory,person,place,note,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    t.id,
    t.title,
    t.status,
    t.due,
    t.due_iso,
    t.end_iso,
    t.priority,
    t.category,
    t.subcategory,
    t.person,
    t.place,
    t.note,
    t.created_at,
    t.completed_at,
  );
}

// Apply the inverse of the last mutation.
export async function applyRevert(r: Revert): Promise<void> {
  if (r.kind === "delete") await deleteTaskById(r.id);
  else if (r.kind === "update") await updateTaskById(r.id, r.fields);
  else if (r.kind === "reinsert") await insertFullTask(r.task);
  else if (r.kind === "reinsertMany")
    for (const t of r.tasks) await insertFullTask(t);
}

export async function logIntent(entry: {
  transcript: string;
  tool: string;
  paramsJson: string;
  result: string;
}): Promise<void> {
  await requireDb().runAsync(
    "INSERT INTO intent_log (transcript, tool, params_json, result, created_at) VALUES (?, ?, ?, ?, ?)",
    entry.transcript,
    entry.tool,
    entry.paramsJson,
    entry.result,
    Date.now(),
  );
}

// ── Preferences (key/value) ──
// Small durable store for UI preferences (active theme, language) so a choice
// survives relaunch — reuses SQLite, no extra native storage dependency.
export async function getSetting(key: string): Promise<string | null> {
  const row = await requireDb().getFirstAsync<{ value: string }>(
    "SELECT value FROM setting WHERE key=?",
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await requireDb().runAsync(
    "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    key,
    value,
  );
}

// ── Google Calendar sync mapping (Kairos task ↔ pushed event) ──
// One row per task that has been mirrored to a calendar; lets the one-way sync
// update/delete the right event instead of creating duplicates.
export type GcalMap = {
  task_id: number;
  event_id: string;
  calendar_id: string;
};

export async function listGcalMaps(): Promise<GcalMap[]> {
  return requireDb().getAllAsync<GcalMap>(
    "SELECT task_id, event_id, calendar_id FROM gcal_map",
  );
}

export async function upsertGcalMap(
  taskId: number,
  eventId: string,
  calendarId: string,
): Promise<void> {
  await requireDb().runAsync(
    "INSERT INTO gcal_map (task_id, event_id, calendar_id, synced_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(task_id) DO UPDATE SET event_id=excluded.event_id, calendar_id=excluded.calendar_id, synced_at=excluded.synced_at",
    taskId,
    eventId,
    calendarId,
    Date.now(),
  );
}

export async function deleteGcalMap(taskId: number): Promise<void> {
  await requireDb().runAsync("DELETE FROM gcal_map WHERE task_id=?", taskId);
}
