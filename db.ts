import * as SQLite from "expo-sqlite";

// Kairos local-first store (J2). Minimal v1: tasks + intent log.
export type Task = {
  id: number;
  title: string;
  status: "todo" | "done";
  due: string | null;
  priority: number | null;
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
      priority INTEGER,
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
}

function requireDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error("DB not initialised");
  return db;
}

export async function createTask(input: {
  title: string;
  due?: string | null;
  priority?: number | null;
}): Promise<Task> {
  const now = Date.now();
  const res = await requireDb().runAsync(
    "INSERT INTO task (title, status, due, priority, created_at) VALUES (?, 'todo', ?, ?, ?)",
    input.title,
    input.due ?? null,
    input.priority ?? null,
    now,
  );
  return {
    id: res.lastInsertRowId,
    title: input.title,
    status: "todo",
    due: input.due ?? null,
    priority: input.priority ?? null,
    created_at: now,
    completed_at: null,
  };
}

export async function listTasks(
  filter: "all" | "open" = "open",
): Promise<Task[]> {
  const where = filter === "open" ? "WHERE status = 'todo'" : "";
  return requireDb().getAllAsync<Task>(
    `SELECT * FROM task ${where} ORDER BY (priority IS NULL), priority ASC, created_at DESC`,
  );
}

// Fuzzy-ish completion: latest open task whose title contains the phrase
// (case-insensitive), else latest open task containing any significant word.
export async function completeTaskByTitle(
  phrase: string,
): Promise<Task | null> {
  const dbi = requireDb();
  const like = `%${phrase.toLowerCase()}%`;
  let row = await dbi.getFirstAsync<Task>(
    "SELECT * FROM task WHERE status='todo' AND lower(title) LIKE ? ORDER BY created_at DESC LIMIT 1",
    like,
  );
  if (!row) {
    const words = phrase
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    for (const w of words) {
      row = await dbi.getFirstAsync<Task>(
        "SELECT * FROM task WHERE status='todo' AND lower(title) LIKE ? ORDER BY created_at DESC LIMIT 1",
        `%${w}%`,
      );
      if (row) break;
    }
  }
  if (!row) return null;
  const now = Date.now();
  await dbi.runAsync(
    "UPDATE task SET status='done', completed_at=? WHERE id=?",
    now,
    row.id,
  );
  return { ...row, status: "done", completed_at: now };
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
