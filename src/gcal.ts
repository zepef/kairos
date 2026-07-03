// gcal.ts — one-way sync of dated Kairos tasks into a user-chosen Google
// Calendar. THE ONLY module that touches expo-calendar.
//
// Approach (offline-first friendly): Kairos writes events into a device calendar
// backed by a Google account; Android's account sync adapter propagates them to
// Google Calendar. The app performs NO OAuth and makes NO network call — it only
// does a local content-provider insert, so "the app sends nothing" still holds.
import * as Calendar from "expo-calendar/legacy";
import {
  listTasks,
  listGcalMaps,
  upsertGcalMap,
  deleteGcalMap,
  type Task,
} from "./db";

// Hermes returns NaN for ISO without seconds (cf. App.tsx / intent.ts): parse the
// parts by hand. Returns local-time ms (matches the intended device wall-clock).
function parseIso(iso: string | null): number {
  if (!iso) return NaN;
  const m = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return NaN;
  return new Date(
    +m[1],
    +m[2] - 1,
    +m[3],
    +(m[4] ?? 0),
    +(m[5] ?? 0),
    +(m[6] ?? 0),
  ).getTime();
}

// A calendar the user can pick as the sync target (writable + account-backed).
export type CalInfo = {
  id: string;
  title: string;
  sourceName: string;
  color?: string;
};

export type SyncReason =
  | "no-permission"
  | "no-calendar"
  | "calendar-missing"
  | "error";

export type SyncSummary = {
  ok: boolean;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: number;
  reason?: SyncReason;
};

const DEFAULT_EVENT_MINUTES = 60;

export async function requestAccess(): Promise<boolean> {
  try {
    const res = await Calendar.requestCalendarPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

// Device calendars the user can WRITE to and that are backed by a real account
// (Google etc.). Writing to a LOCAL calendar would never sync to any cloud, so
// those are excluded.
export async function listWritableGoogleCalendars(): Promise<CalInfo[]> {
  try {
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return cals
      .filter(
        (c: any) =>
          c.allowsModifications === true && c.source?.isLocalAccount === false,
      )
      .map((c: any) => ({
        id: String(c.id),
        title: String(c.title ?? c.name ?? c.id),
        sourceName: String(c.source?.name ?? c.ownerAccount ?? ""),
        color: typeof c.color === "string" ? c.color : undefined,
      }));
  } catch {
    return [];
  }
}

// Event fields for a task. All-day when due_iso has no time, else a timed 60-min
// block. timeZone is omitted deliberately: the local Date preserves wall-clock.
function buildEventDetails(task: Task): Partial<Calendar.Event> {
  const start = new Date(parseIso(task.due_iso));
  const hasTime = /T\d{2}:\d{2}/.test(task.due_iso ?? "");
  const base: Partial<Calendar.Event> = {
    title: task.title,
    notes: task.note ?? undefined,
  };
  if (hasTime) {
    // Use the task's real end time if it's a valid instant after the start,
    // otherwise fall back to a default 60-minute block.
    const endMs = parseIso(task.end_iso);
    const endDate =
      !Number.isNaN(endMs) && endMs > start.getTime()
        ? new Date(endMs)
        : new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60000);
    return { ...base, startDate: start, endDate };
  }
  // All-day events must be UTC-midnight with timeZone "UTC" (Android/Google
  // Calendar contract) — local midnight shifts the event a day in non-UTC zones.
  const dayUtc = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  return {
    ...base,
    startDate: new Date(dayUtc),
    endDate: new Date(dayUtc + 24 * 3600 * 1000),
    allDay: true,
    timeZone: "UTC",
  };
}

// Push all OPEN dated tasks into `calendarId` (create/update), and remove events
// for tasks that are no longer open (done/archived/deleted). Idempotent via the
// gcal_map table. Never throws — returns a summary for the caller to speak.
export async function syncNow(opts: {
  calendarId: string | null;
}): Promise<SyncSummary> {
  const s: SyncSummary = {
    ok: false,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
  };
  if (!opts.calendarId) return { ...s, reason: "no-calendar" };
  if (!(await requestAccess())) return { ...s, reason: "no-permission" };
  const calendarId = opts.calendarId;
  const cals = await listWritableGoogleCalendars();
  if (!cals.some((c) => c.id === calendarId))
    return { ...s, reason: "calendar-missing" };

  const open = await listTasks("open");
  const live = open.filter((t) => !Number.isNaN(parseIso(t.due_iso)));
  s.skipped = open.length - live.length;
  const liveIds = new Set(live.map((t) => t.id));
  const maps = await listGcalMaps();
  const mapByTask = new Map(maps.map((m) => [m.task_id, m]));

  // Create / update events for the live dated tasks.
  for (const task of live) {
    try {
      const details = buildEventDetails(task);
      const m = mapByTask.get(task.id);
      if (m && m.calendar_id === calendarId) {
        try {
          await Calendar.updateEventAsync(m.event_id, details);
          s.updated++;
        } catch {
          // Update failed (event deleted on Google's side, or transient). Delete-
          // then-recreate so we never leave a duplicate or an orphaned event.
          try {
            await Calendar.deleteEventAsync(m.event_id);
          } catch {
            // already gone — fine
          }
          const id = await Calendar.createEventAsync(calendarId, details);
          await upsertGcalMap(task.id, id, calendarId);
          s.created++;
        }
      } else {
        // No mapping, or the target calendar changed: drop the stale event first.
        if (m) {
          try {
            await Calendar.deleteEventAsync(m.event_id);
          } catch {
            // best effort — may already be gone
          }
        }
        const id = await Calendar.createEventAsync(calendarId, details);
        await upsertGcalMap(task.id, id, calendarId);
        s.created++;
      }
    } catch {
      s.errors++;
    }
  }

  // Remove events whose task is no longer open (done / archived / deleted).
  for (const m of maps) {
    if (liveIds.has(m.task_id)) continue;
    try {
      await Calendar.deleteEventAsync(m.event_id);
    } catch {
      // ignore — event may already be gone
    }
    await deleteGcalMap(m.task_id);
    s.deleted++;
  }

  s.ok = s.errors === 0;
  return s;
}
