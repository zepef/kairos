import * as SQLite from "expo-sqlite";

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
  due_iso: string | null; // resolved ISO datetime for calendar filtering
  priority: number | null;
  category: string | null; // level-1 folder
  subcategory: string | null; // level-2 sub-folder
  person: string | null; // WHO — associated person
  place: string | null; // WHERE — place / context
  created_at: number;
  completed_at: number | null;
};

let db: SQLite.SQLiteDatabase | null = null;

export async function initDb(): Promise<void> {
  if (db) return;
  db = await SQLite.openDatabaseAsync("kairos.db");
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
  `);
  // Migrations for existing installs (ignore "duplicate column" errors).
  for (const col of [
    "category TEXT",
    "subcategory TEXT",
    "due_iso TEXT",
    "person TEXT",
    "place TEXT",
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

export async function createTask(input: {
  title: string;
  due?: string | null;
  dueIso?: string | null;
  priority?: number | null;
  category?: string | null;
  subcategory?: string | null;
  person?: string | null;
  place?: string | null;
}): Promise<Task> {
  const now = Date.now();
  const res = await requireDb().runAsync(
    "INSERT INTO task (title, status, due, due_iso, priority, category, subcategory, person, place, created_at) VALUES (?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?)",
    input.title,
    input.due ?? null,
    input.dueIso ?? null,
    input.priority ?? null,
    input.category ?? null,
    input.subcategory ?? null,
    input.person ?? null,
    input.place ?? null,
    now,
  );
  return {
    id: res.lastInsertRowId,
    title: input.title,
    status: "todo",
    due: input.due ?? null,
    due_iso: input.dueIso ?? null,
    priority: input.priority ?? null,
    category: input.category ?? null,
    subcategory: input.subcategory ?? null,
    person: input.person ?? null,
    place: input.place ?? null,
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
