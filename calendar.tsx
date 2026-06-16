import { type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { taskEmoji, type CalRange } from "./intent";
import type { Task } from "./db";

// Hermes returns NaN for ISO without seconds — parse from parts (cf. App.tsx).
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

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
const MONTHS_SHORT = [
  "Janv",
  "Févr",
  "Mars",
  "Avr",
  "Mai",
  "Juin",
  "Juil",
  "Août",
  "Sept",
  "Oct",
  "Nov",
  "Déc",
];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// Monday-based weekday index (0 = Mon … 6 = Sun).
const wd = (d: Date) => (d.getDay() + 6) % 7;

// Midnight of the given date (used to compare "is this in the future").
const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const open = (t: Task) => t.status !== "done" && t.status !== "archived";

function Chip({ t }: { t: Task }) {
  const ms = parseIso(t.due_iso);
  const time = Number.isNaN(ms)
    ? ""
    : new Date(ms).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      });
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText} numberOfLines={1}>
        {taskEmoji(t.category, t.title)} {t.title}
      </Text>
      {time ? <Text style={styles.chipTime}>{time}</Text> : null}
    </View>
  );
}

type Dated = { t: Task; ms: number };

// The four zoom levels, narrowest → widest. Zooming "in" goes left (more
// detail: year→month→week→day), "out" goes right (wider: day→week→month→year).
const LEVELS: CalRange[] = ["day", "week", "month", "year"];
const LEVEL_LABEL: Record<CalRange, string> = {
  day: "Jour",
  week: "Semaine",
  month: "Mois",
  year: "Année",
};
const widerOf = (r: CalRange): CalRange =>
  LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(r) + 1)];
const narrowerOf = (r: CalRange): CalRange =>
  LEVELS[Math.max(0, LEVELS.indexOf(r) - 1)];

// Controlled view: the current zoom level (range) and the date it is anchored
// on both live in App (single source of truth), so zoom works identically from
// touch (the header ± buttons and tap-to-drill) and from voice (zoomCalendar /
// showCalendar). onNavigate reports the requested (range, anchor); renderTalk
// injects App's push-to-talk control so voice commands work while the calendar
// is full-screen.
export default function CalendarView({
  range,
  anchor,
  tasks,
  onNavigate,
  onClose,
  renderTalk,
}: {
  range: CalRange;
  anchor: Date;
  tasks: Task[];
  onNavigate: (range: CalRange, anchor: Date) => void;
  onClose: () => void;
  renderTalk?: (size: number) => ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const now = new Date();

  const dated = tasks
    .filter(open)
    .map((t) => ({ t, ms: parseIso(t.due_iso) }))
    .filter((x) => !Number.isNaN(x.ms));

  const a = anchor;
  const weekStart = (() => {
    const s = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    s.setDate(s.getDate() - wd(s));
    return s;
  })();
  const titles: Record<CalRange, string> = {
    day: `${DAYS[wd(a)].toLowerCase()} ${a.getDate()} ${MONTHS[a.getMonth()].toLowerCase()}`,
    week: `Semaine du ${weekStart.getDate()} ${MONTHS_SHORT[weekStart.getMonth()].toLowerCase()}`,
    month: `${MONTHS[a.getMonth()]} ${a.getFullYear()}`,
    year: `${a.getFullYear()}`,
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {/* Zoom out: widen the window (day→week→month→year), same anchor. */}
          {range !== "year" && (
            <Pressable
              onPress={() => onNavigate(widerOf(range), a)}
              hitSlop={12}
              style={styles.zoomBtn}
            >
              <Text style={styles.zoomLabel}>－ {LEVEL_LABEL[widerOf(range)]}</Text>
            </Pressable>
          )}
          <Text style={styles.title}>🗓️ {titles[range]}</Text>
          {/* Zoom in: more detail (year→month→week→day), same anchor. */}
          {range !== "day" && (
            <Pressable
              onPress={() => onNavigate(narrowerOf(range), a)}
              hitSlop={12}
              style={styles.zoomBtn}
            >
              <Text style={styles.zoomLabel}>{LEVEL_LABEL[narrowerOf(range)]} ＋</Text>
            </Pressable>
          )}
        </View>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>✕ Fermer</Text>
        </Pressable>
      </View>
      {range === "day" && <DayView day={a} now={now} dated={dated} />}
      {range === "week" && (
        <WeekView
          start={weekStart}
          now={now}
          dated={dated}
          onPickDay={(d) => onNavigate("day", d)}
        />
      )}
      {range === "month" && (
        <MonthView
          month={a}
          now={now}
          dated={dated}
          w={width}
          onPickDay={(d) => onNavigate("day", d)}
        />
      )}
      {range === "year" && (
        <YearView
          year={a.getFullYear()}
          now={now}
          dated={dated}
          h={height}
          onPickMonth={(d) => onNavigate("month", d)}
          onPickDay={(d) => onNavigate("day", d)}
        />
      )}
      {/* Push-to-talk dock: the calendar is full-screen, so the app's mic lives
          here too — hold to speak "zoom avant/arrière", "calendrier mensuel"… */}
      {renderTalk && (
        <View style={styles.talkDock} pointerEvents="box-none">
          {renderTalk(46)}
        </View>
      )}
    </View>
  );
}

function DayView({
  day,
  now,
  dated,
}: {
  day: Date;
  now: Date;
  dated: Dated[];
}) {
  const HSTART = 7;
  const HEND = 22;
  const items0 = dated.filter((x) => sameDay(new Date(x.ms), day));
  const hours = [];
  for (let h = HSTART; h <= HEND; h++) {
    const items = items0.filter((x) => new Date(x.ms).getHours() === h);
    hours.push(
      <View key={h} style={styles.hourCol}>
        <Text style={styles.hourLabel}>{String(h).padStart(2, "0")}h</Text>
        <View style={styles.hourBody}>
          {items.map((x) => (
            <Chip key={x.t.id} t={x.t} />
          ))}
        </View>
      </View>,
    );
  }
  return (
    <ScrollView horizontal contentContainerStyle={styles.dayScroll}>
      {hours}
    </ScrollView>
  );
}

function WeekView({
  start,
  now,
  dated,
  onPickDay,
}: {
  start: Date;
  now: Date;
  dated: Dated[];
  onPickDay: (d: Date) => void;
}) {
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const items = dated.filter((x) => sameDay(new Date(x.ms), d));
    const isToday = sameDay(d, now);
    cols.push(
      <Pressable
        key={i}
        style={styles.weekCol}
        onPress={() => onPickDay(d)}
      >
        <Text style={[styles.weekHead, isToday && styles.weekHeadToday]}>
          {DAYS[i]} {d.getDate()}
        </Text>
        <ScrollView contentContainerStyle={styles.weekBody}>
          {items.map((x) => (
            <Chip key={x.t.id} t={x.t} />
          ))}
        </ScrollView>
      </Pressable>,
    );
  }
  return <View style={styles.weekRow}>{cols}</View>;
}

function MonthView({
  month,
  now,
  dated,
  w,
  onPickDay,
}: {
  month: Date;
  now: Date;
  dated: Dated[];
  w: number;
  onPickDay: (d: Date) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const offset = wd(first);
  const days = new Date(year, m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const cw = Math.floor((w - 24) / 7);
  return (
    <ScrollView contentContainerStyle={styles.monthWrap}>
      <View style={styles.monthHeadRow}>
        {DAYS.map((d) => (
          <Text key={d} style={[styles.monthHeadCell, { width: cw }]}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={{ width: cw, height: 64 }} />;
          const items = dated.filter((x) => sameDay(new Date(x.ms), d));
          const isToday = sameDay(d, now);
          return (
            <Pressable
              key={i}
              onPress={() => onPickDay(d)}
              style={[
                styles.monthCell,
                { width: cw },
                isToday && styles.monthCellToday,
              ]}
            >
              <Text style={[styles.monthDay, isToday && styles.monthDayToday]}>
                {d.getDate()}
              </Text>
              {items.length > 0 && (
                <Text style={styles.monthEmoji} numberOfLines={1}>
                  {items
                    .slice(0, 3)
                    .map((x) => taskEmoji(x.t.category, x.t.title))
                    .join("")}
                </Text>
              )}
              {items.length > 0 && (
                <Text style={styles.monthCount}>{items.length}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

// Annual "horizon" board: months are tappable (→ month view), days that carry a
// dated task show that task's emoji (→ day view), and a side rail lists what's
// still coming this year so long-range commitments are never out of sight.
function YearView({
  year,
  now,
  dated,
  h,
  onPickMonth,
  onPickDay,
}: {
  year: number;
  now: Date;
  dated: Dated[];
  h: number;
  onPickMonth: (d: Date) => void;
  onPickDay: (d: Date) => void;
}) {
  // Heatmap intensity per day from task count (background under the emoji).
  const tint = (n: number) =>
    n === 0 ? "#e2e6ec" : n === 1 ? "#cfe0ff" : n <= 3 ? "#9dbcff" : "#6f9bff";

  // Upcoming dated tasks for the rest of the year, soonest first.
  const todayMs = startOfDay(now);
  const upcoming = dated
    .filter((x) => x.ms >= todayMs && new Date(x.ms).getFullYear() === year)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 14);

  return (
    <View style={styles.yearRoot}>
      <ScrollView contentContainerStyle={styles.yearWrap}>
        {MONTHS.map((mName, m) => {
          const first = new Date(year, m, 1);
          const offset = wd(first);
          const days = new Date(year, m + 1, 0).getDate();
          const cells: (number | null)[] = [];
          for (let i = 0; i < offset; i++) cells.push(null);
          for (let d = 1; d <= days; d++) cells.push(d);
          while (cells.length % 7 !== 0) cells.push(null);
          return (
            <View key={m} style={styles.miniMonth}>
              <Pressable
                onPress={() => onPickMonth(new Date(year, m, 1))}
                hitSlop={6}
              >
                <Text style={styles.miniTitle}>{MONTHS_SHORT[m]} ›</Text>
              </Pressable>
              <View style={styles.miniGrid}>
                {cells.map((d, i) => {
                  if (!d) return <View key={i} style={styles.miniCell} />;
                  const dt = new Date(year, m, d);
                  const items = dated.filter((x) => sameDay(new Date(x.ms), dt));
                  const n = items.length;
                  const isToday = sameDay(dt, now);
                  const emoji = n
                    ? taskEmoji(items[0].t.category, items[0].t.title)
                    : "";
                  return (
                    <Pressable
                      key={i}
                      disabled={n === 0}
                      onPress={() => onPickDay(dt)}
                      style={[
                        styles.miniCell,
                        { backgroundColor: tint(n) },
                        isToday && styles.miniToday,
                      ]}
                    >
                      {emoji ? (
                        <Text style={styles.miniEmoji} numberOfLines={1}>
                          {emoji}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.rail}>
        <Text style={styles.railTitle}>À venir</Text>
        <ScrollView contentContainerStyle={styles.railBody}>
          {upcoming.length === 0 ? (
            <Text style={styles.railEmpty}>Rien de daté à l'horizon.</Text>
          ) : (
            upcoming.map((x) => {
              const d = new Date(x.ms);
              return (
                <Pressable
                  key={x.t.id}
                  style={styles.railRow}
                  onPress={() => onPickDay(d)}
                >
                  <Text style={styles.railEmoji}>
                    {taskEmoji(x.t.category, x.t.title)}
                  </Text>
                  <View style={styles.railText}>
                    <Text style={styles.railDate}>
                      {d.getDate()} {MONTHS_SHORT[d.getMonth()].toLowerCase()}
                    </Text>
                    <Text style={styles.railTask} numberOfLines={1}>
                      {x.t.title}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#edf0f4", paddingTop: 28 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  zoomBtn: {
    backgroundColor: "#e7eefc",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cfe0ff",
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  zoomLabel: { fontSize: 13, color: "#2f6fed", fontWeight: "700" },
  title: { fontSize: 18, fontWeight: "800", color: "#1a1a1a" },
  close: { fontSize: 15, color: "#2f6fed", fontWeight: "700" },
  // Floating push-to-talk dock (bottom-center); box-none lets touches through
  // the empty area so the calendar underneath stays interactive.
  talkDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 8,
    alignItems: "center",
  },
  chip: {
    backgroundColor: "#eaf0ff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cfe0ff",
    paddingVertical: 5,
    paddingHorizontal: 7,
    marginBottom: 6,
  },
  chipText: { fontSize: 12, color: "#1a1a1a", fontWeight: "600" },
  chipTime: { fontSize: 10, color: "#2f6fed", marginTop: 1 },
  // Day
  dayScroll: { paddingHorizontal: 12, paddingBottom: 12 },
  hourCol: { width: 130, marginRight: 8 },
  hourLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1e3a8a",
    marginBottom: 6,
  },
  hourBody: {
    flex: 1,
    borderLeftWidth: 2,
    borderLeftColor: "#dfe4ec",
    paddingLeft: 6,
    minHeight: 60,
  },
  // Week
  weekRow: { flex: 1, flexDirection: "row", paddingHorizontal: 8 },
  weekCol: {
    flex: 1,
    marginHorizontal: 3,
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e6ec",
    overflow: "hidden",
  },
  weekHead: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: "#1e3a8a",
    textAlign: "center",
    paddingVertical: 6,
  },
  weekHeadToday: { backgroundColor: "#2f6fed" },
  weekBody: { padding: 6 },
  // Month
  monthWrap: { paddingHorizontal: 12, paddingBottom: 12 },
  monthHeadRow: { flexDirection: "row" },
  monthHeadCell: {
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    color: "#7a869a",
    paddingVertical: 4,
  },
  monthGrid: { flexDirection: "row", flexWrap: "wrap" },
  monthCell: {
    height: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#dfe4ec",
    padding: 3,
  },
  monthCellToday: { backgroundColor: "#eaf0ff", borderColor: "#2f6fed" },
  monthDay: { fontSize: 12, color: "#1a1a1a", fontWeight: "600" },
  monthDayToday: { color: "#2f6fed", fontWeight: "800" },
  monthEmoji: { fontSize: 12, marginTop: 2 },
  monthCount: {
    position: "absolute",
    right: 4,
    bottom: 3,
    fontSize: 10,
    color: "#2f6fed",
    fontWeight: "700",
  },
  // Year
  yearRoot: { flex: 1, flexDirection: "row" },
  yearWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingBottom: 12,
    justifyContent: "space-between",
    flexGrow: 1,
  },
  miniMonth: { width: "30%", marginBottom: 12 },
  miniTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1e3a8a",
    marginBottom: 4,
  },
  miniGrid: { flexDirection: "row", flexWrap: "wrap" },
  miniCell: {
    width: "14.28%",
    aspectRatio: 1,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: "#edf0f4",
    alignItems: "center",
    justifyContent: "center",
  },
  miniEmoji: { fontSize: 11 },
  miniToday: { borderColor: "#1a1a1a", borderWidth: 1.5 },
  // Year — "À venir" side rail
  rail: {
    width: 220,
    backgroundColor: "#f8fafc",
    borderLeftWidth: 1,
    borderLeftColor: "#dfe4ec",
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  railTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#1e3a8a",
    marginBottom: 8,
  },
  railBody: { paddingBottom: 16 },
  railEmpty: { fontSize: 12, color: "#7a869a", fontStyle: "italic" },
  railRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e6ec",
  },
  railEmoji: { fontSize: 18, marginRight: 8 },
  railText: { flex: 1 },
  railDate: { fontSize: 11, fontWeight: "700", color: "#2f6fed" },
  railTask: { fontSize: 12, color: "#1a1a1a", fontWeight: "600" },
});
