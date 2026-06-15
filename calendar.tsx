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

export default function CalendarView({
  range,
  tasks,
  onClose,
}: {
  range: CalRange;
  tasks: Task[];
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const now = new Date();
  const dated = tasks
    .filter(open)
    .map((t) => ({ t, ms: parseIso(t.due_iso) }))
    .filter((x) => !Number.isNaN(x.ms));

  const titles: Record<CalRange, string> = {
    day: `Aujourd'hui — ${DAYS[wd(now)].toLowerCase()} ${now.getDate()} ${MONTHS[now.getMonth()].toLowerCase()}`,
    week: `Semaine du ${(() => {
      const s = new Date(now);
      s.setDate(s.getDate() - wd(now));
      return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()].toLowerCase()}`;
    })()}`,
    month: `${MONTHS[now.getMonth()]} ${now.getFullYear()}`,
    year: `${now.getFullYear()}`,
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>🗓️ {titles[range]}</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>✕ Fermer</Text>
        </Pressable>
      </View>
      {range === "day" && <DayView now={now} dated={dated} />}
      {range === "week" && <WeekView now={now} dated={dated} />}
      {range === "month" && <MonthView now={now} dated={dated} w={width} />}
      {range === "year" && <YearView now={now} dated={dated} h={height} />}
    </View>
  );
}

type Dated = { t: Task; ms: number };

function DayView({ now, dated }: { now: Date; dated: Dated[] }) {
  const HSTART = 7;
  const HEND = 22;
  const today = dated.filter((x) => sameDay(new Date(x.ms), now));
  const hours = [];
  for (let h = HSTART; h <= HEND; h++) {
    const items = today.filter((x) => new Date(x.ms).getHours() === h);
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

function WeekView({ now, dated }: { now: Date; dated: Dated[] }) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - wd(now));
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const items = dated.filter((x) => sameDay(new Date(x.ms), d));
    const isToday = sameDay(d, now);
    cols.push(
      <View key={i} style={styles.weekCol}>
        <Text style={[styles.weekHead, isToday && styles.weekHeadToday]}>
          {DAYS[i]} {d.getDate()}
        </Text>
        <ScrollView contentContainerStyle={styles.weekBody}>
          {items.map((x) => (
            <Chip key={x.t.id} t={x.t} />
          ))}
        </ScrollView>
      </View>,
    );
  }
  return <View style={styles.weekRow}>{cols}</View>;
}

function MonthView({ now, dated, w }: { now: Date; dated: Dated[]; w: number }) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const offset = wd(first);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
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
            <View
              key={i}
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
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function YearView({ now, dated, h }: { now: Date; dated: Dated[]; h: number }) {
  const year = now.getFullYear();
  // Heatmap intensity per day from task count.
  const tint = (n: number) =>
    n === 0 ? "#e2e6ec" : n === 1 ? "#bcd0ff" : n <= 3 ? "#6f9bff" : "#2f6fed";
  return (
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
            <Text style={styles.miniTitle}>{MONTHS_SHORT[m]}</Text>
            <View style={styles.miniGrid}>
              {cells.map((d, i) => {
                if (!d) return <View key={i} style={styles.miniCell} />;
                const dt = new Date(year, m, d);
                const n = dated.filter((x) => sameDay(new Date(x.ms), dt)).length;
                const isToday = sameDay(dt, now);
                return (
                  <View
                    key={i}
                    style={[
                      styles.miniCell,
                      { backgroundColor: tint(n) },
                      isToday && styles.miniToday,
                    ]}
                  />
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
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
  title: { fontSize: 18, fontWeight: "800", color: "#1a1a1a" },
  close: { fontSize: 15, color: "#2f6fed", fontWeight: "700" },
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
  yearWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingBottom: 12,
    justifyContent: "space-between",
  },
  miniMonth: { width: "24%", marginBottom: 12 },
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
  },
  miniToday: { borderColor: "#1a1a1a", borderWidth: 1.5 },
});
