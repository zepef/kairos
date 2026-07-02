import { useMemo, type ReactNode } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { taskEmoji, type CalRange } from "./intent";
import type { Task } from "./db";
import { tr, DATE_LOCALE, type Lang, type Strings } from "./i18n";
import type { Theme } from "./theme";

type CalStyles = ReturnType<typeof makeStyles>;

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

// Day/month names + all calendar labels are localized via the active language's
// strings table (tr(lang)), threaded down as the `L` prop. Colours + fonts come
// from the active theme (theme.ts), threaded down as the `st` (themed styles)
// prop. Calendar is landscape and full-screen, so the language flag lives on the
// home screen; the chosen language + theme are passed in here.

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

function Chip({ t, locale, st }: { t: Task; locale: string; st: CalStyles }) {
  const ms = parseIso(t.due_iso);
  const time = Number.isNaN(ms)
    ? ""
    : new Date(ms).toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
  return (
    <View style={st.chip}>
      <Text style={st.chipText} numberOfLines={1}>
        {taskEmoji(t.category, t.title)} {t.title}
      </Text>
      {time ? <Text style={st.chipTime}>{time}</Text> : null}
    </View>
  );
}

type Dated = { t: Task; ms: number };

// The four zoom levels, narrowest → widest. Zooming "in" goes left (more
// detail: year→month→week→day), "out" goes right (wider: day→week→month→year).
const LEVELS: CalRange[] = ["day", "week", "month", "year"];
const widerOf = (r: CalRange): CalRange =>
  LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(r) + 1)];
const narrowerOf = (r: CalRange): CalRange =>
  LEVELS[Math.max(0, LEVELS.indexOf(r) - 1)];

// Shift the anchor by one period at the current zoom level. dir +1 = next
// (swipe left), -1 = previous (swipe right). Drives the swipe navigation in
// week/month/year so the user pages through time without leaving the view.
function shiftAnchor(range: CalRange, anchor: Date, dir: number): Date {
  const d = new Date(anchor);
  if (range === "day") d.setDate(d.getDate() + dir);
  else if (range === "week") d.setDate(d.getDate() + 7 * dir);
  else if (range === "month") d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  return d;
}

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
  lang,
  theme,
  onNavigate,
  onClose,
  renderTalk,
}: {
  range: CalRange;
  anchor: Date;
  tasks: Task[];
  lang: Lang;
  theme: Theme;
  onNavigate: (range: CalRange, anchor: Date) => void;
  onClose: () => void;
  renderTalk?: (size: number) => ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const now = new Date();
  const L = tr(lang);
  const locale = DATE_LOCALE[lang];
  const st = useMemo(() => makeStyles(theme), [theme]);

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
    day: L.dayTitle(L.days[wd(a)], a.getDate(), L.months[a.getMonth()]),
    week: L.weekTitle(weekStart.getDate(), L.monthsShort[weekStart.getMonth()]),
    month: L.monthTitle(L.months[a.getMonth()], a.getFullYear()),
    year: `${a.getFullYear()}`,
  };

  // Swipe left/right pages one period at the current level (week/month/year):
  // claim only clearly-horizontal gestures so the inner vertical ScrollViews
  // keep working, and never on day (its hour strip scrolls horizontally).
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Capture so a clearly-horizontal swipe is stolen from the inner
        // vertical ScrollView of month/year (which otherwise grabs it first);
        // the |dx|>|dy| gate keeps vertical scrolling working.
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          range !== "day" &&
          Math.abs(g.dx) > 24 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < 40) return;
          const dir = g.dx < 0 ? 1 : -1;
          onNavigate(range, shiftAnchor(range, a, dir));
        },
      }),
    [range, a, onNavigate],
  );

  return (
    <View style={st.root}>
      <View style={st.header}>
        <View style={st.headerLeft}>
          <Text style={st.title}>🗓️ {titles[range]}</Text>
          {/* Zoom in: more detail (year→month→week→day), same anchor. */}
          {range !== "day" && (
            <Pressable
              onPress={() => onNavigate(narrowerOf(range), a)}
              hitSlop={12}
              style={st.zoomBtn}
            >
              <Text style={st.zoomLabel}>{L.levelLabel[narrowerOf(range)]} ＋</Text>
            </Pressable>
          )}
        </View>
        <View style={st.headerRight}>
          {/* Zoom out: widen the window (day→week→month→year), same anchor.
              Sits left of Fermer so the Android nav bar never clips it. */}
          {range !== "year" && (
            <Pressable
              onPress={() => onNavigate(widerOf(range), a)}
              hitSlop={12}
              style={st.zoomBtn}
            >
              <Text style={st.zoomLabel}>－ {L.levelLabel[widerOf(range)]}</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={st.close}>{L.calClose}</Text>
          </Pressable>
        </View>
      </View>
      {/* Day view owns a horizontal hour strip (ScrollView) that the user scrolls
          to browse earlier/later hours, so it must NOT sit under the swipe-paging
          PanResponder — a capture responder on the parent can swallow the first
          move of a real touch and make scrolling back feel broken. Render it bare;
          week/month/year keep the pan handlers for previous/next-period swipes. */}
      {range === "day" ? (
        <View style={st.body}>
          <DayView day={a} now={now} dated={dated} L={L} locale={locale} st={st} />
        </View>
      ) : (
        <View style={st.body} {...pan.panHandlers}>
          {range === "week" && (
            <WeekView
              start={weekStart}
              now={now}
              dated={dated}
              L={L}
              locale={locale}
              st={st}
              onPickDay={(d) => onNavigate("day", d)}
            />
          )}
          {range === "month" && (
            <MonthView
              month={a}
              now={now}
              dated={dated}
              w={width}
              L={L}
              st={st}
              onPickDay={(d) => onNavigate("day", d)}
            />
          )}
          {range === "year" && (
            <YearView
              year={a.getFullYear()}
              now={now}
              dated={dated}
              h={height}
              L={L}
              st={st}
              theme={theme}
              onPickMonth={(d) => onNavigate("month", d)}
              onPickDay={(d) => onNavigate("day", d)}
            />
          )}
        </View>
      )}
      {/* Push-to-talk dock: the calendar is full-screen, so the app's mic lives
          here too — hold to speak "zoom avant/arrière", "calendrier mensuel"… */}
      {renderTalk && (
        <View style={st.talkDock} pointerEvents="box-none">
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
  L,
  locale,
  st,
}: {
  day: Date;
  now: Date;
  dated: Dated[];
  L: Strings;
  locale: string;
  st: CalStyles;
}) {
  const HSTART = 7;
  const HEND = 22;
  const items0 = dated.filter((x) => sameDay(new Date(x.ms), day));
  const hours = [];
  for (let h = HSTART; h <= HEND; h++) {
    const items = items0.filter((x) => new Date(x.ms).getHours() === h);
    hours.push(
      <View key={h} style={st.hourCol}>
        <Text style={st.hourLabel}>{L.hourLabel(h)}</Text>
        <View style={st.hourBody}>
          {items.map((x) => (
            <Chip key={x.t.id} t={x.t} locale={locale} st={st} />
          ))}
        </View>
      </View>,
    );
  }
  return (
    <ScrollView horizontal contentContainerStyle={st.dayScroll}>
      {hours}
    </ScrollView>
  );
}

function WeekView({
  start,
  now,
  dated,
  L,
  locale,
  st,
  onPickDay,
}: {
  start: Date;
  now: Date;
  dated: Dated[];
  L: Strings;
  locale: string;
  st: CalStyles;
  onPickDay: (d: Date) => void;
}) {
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const items = dated.filter((x) => sameDay(new Date(x.ms), d));
    const isToday = sameDay(d, now);
    cols.push(
      <Pressable key={i} style={st.weekCol} onPress={() => onPickDay(d)}>
        <Text style={[st.weekHead, isToday && st.weekHeadToday]}>
          {L.days[i]} {d.getDate()}
        </Text>
        <ScrollView contentContainerStyle={st.weekBody}>
          {items.map((x) => (
            <Chip key={x.t.id} t={x.t} locale={locale} st={st} />
          ))}
        </ScrollView>
      </Pressable>,
    );
  }
  return <View style={st.weekRow}>{cols}</View>;
}

function MonthView({
  month,
  now,
  dated,
  w,
  L,
  st,
  onPickDay,
}: {
  month: Date;
  now: Date;
  dated: Dated[];
  w: number;
  L: Strings;
  st: CalStyles;
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
    <ScrollView contentContainerStyle={st.monthWrap}>
      <View style={st.monthHeadRow}>
        {L.days.map((d) => (
          <Text key={d} style={[st.monthHeadCell, { width: cw }]}>
            {d}
          </Text>
        ))}
      </View>
      <View style={st.monthGrid}>
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={{ width: cw, height: 64 }} />;
          const items = dated.filter((x) => sameDay(new Date(x.ms), d));
          const isToday = sameDay(d, now);
          return (
            <Pressable
              key={i}
              onPress={() => onPickDay(d)}
              style={[st.monthCell, { width: cw }, isToday && st.monthCellToday]}
            >
              <Text style={[st.monthDay, isToday && st.monthDayToday]}>
                {d.getDate()}
              </Text>
              {items.length > 0 && (
                <Text style={st.monthEmoji} numberOfLines={1}>
                  {items
                    .slice(0, 3)
                    .map((x) => taskEmoji(x.t.category, x.t.title))
                    .join("")}
                </Text>
              )}
              {items.length > 0 && (
                <Text style={st.monthCount}>{items.length}</Text>
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
  L,
  st,
  theme,
  onPickMonth,
  onPickDay,
}: {
  year: number;
  now: Date;
  dated: Dated[];
  h: number;
  L: Strings;
  st: CalStyles;
  theme: Theme;
  onPickMonth: (d: Date) => void;
  onPickDay: (d: Date) => void;
}) {
  // Heatmap intensity per day from task count (background under the emoji).
  const tint = (n: number) =>
    n === 0
      ? theme.line
      : n === 1
        ? theme.chipBg
        : n <= 3
          ? theme.accent2
          : theme.accent;

  // Upcoming dated tasks for the rest of the year, soonest first.
  const todayMs = startOfDay(now);
  const upcoming = dated
    .filter((x) => x.ms >= todayMs && new Date(x.ms).getFullYear() === year)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 14);

  return (
    <View style={st.yearRoot}>
      <ScrollView contentContainerStyle={st.yearWrap}>
        {L.months.map((_mName, m) => {
          const first = new Date(year, m, 1);
          const offset = wd(first);
          const days = new Date(year, m + 1, 0).getDate();
          const cells: (number | null)[] = [];
          for (let i = 0; i < offset; i++) cells.push(null);
          for (let d = 1; d <= days; d++) cells.push(d);
          while (cells.length % 7 !== 0) cells.push(null);
          return (
            <View key={m} style={st.miniMonth}>
              <Pressable
                onPress={() => onPickMonth(new Date(year, m, 1))}
                hitSlop={6}
              >
                <Text style={st.miniTitle}>{L.monthsShort[m]} ›</Text>
              </Pressable>
              <View style={st.miniGrid}>
                {cells.map((d, i) => {
                  if (!d) return <View key={i} style={st.miniCell} />;
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
                        st.miniCell,
                        { backgroundColor: tint(n) },
                        isToday && st.miniToday,
                      ]}
                    >
                      {emoji ? (
                        <Text style={st.miniEmoji} numberOfLines={1}>
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
      <View style={st.rail}>
        <Text style={st.railTitle}>{L.calUpcoming}</Text>
        <ScrollView contentContainerStyle={st.railBody}>
          {upcoming.length === 0 ? (
            <Text style={st.railEmpty}>{L.calNothingHorizon}</Text>
          ) : (
            upcoming.map((x) => {
              const d = new Date(x.ms);
              return (
                <Pressable
                  key={x.t.id}
                  style={st.railRow}
                  onPress={() => onPickDay(d)}
                >
                  <Text style={st.railEmoji}>
                    {taskEmoji(x.t.category, x.t.title)}
                  </Text>
                  <View style={st.railText}>
                    <Text style={st.railDate}>
                      {L.railDate(d.getDate(), L.monthsShort[d.getMonth()])}
                    </Text>
                    <Text style={st.railTask} numberOfLines={1}>
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

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg, paddingTop: 28 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingLeft: 31,
    },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
    body: { flex: 1 },
    zoomBtn: {
      backgroundColor: t.chipBg,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.line,
      paddingVertical: 5,
      paddingHorizontal: 10,
    },
    zoomLabel: { fontFamily: t.body.bold, fontSize: 13, color: t.accent },
    title: { fontFamily: t.display.semibold, fontSize: 18, color: t.ink },
    close: { fontFamily: t.body.bold, fontSize: 15, color: t.accent },
    // Floating push-to-talk dock (bottom-center); box-none lets touches through
    // the empty area so the calendar underneath stays interactive.
    talkDock: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 23,
      alignItems: "center",
    },
    chip: {
      backgroundColor: t.chipBg,
      borderRadius: 8,
      borderLeftWidth: 3,
      borderLeftColor: t.accent,
      paddingVertical: 5,
      paddingHorizontal: 7,
      marginBottom: 6,
    },
    chipText: { fontFamily: t.body.semibold, fontSize: 12, color: t.ink },
    chipTime: { fontFamily: t.body.medium, fontSize: 10, color: t.accent, marginTop: 1 },
    // Day
    dayScroll: { paddingHorizontal: 12, paddingBottom: 12 },
    hourCol: { width: 130, marginRight: 8 },
    hourLabel: {
      fontFamily: t.body.bold,
      fontSize: 12,
      color: t.accent,
      marginBottom: 6,
    },
    hourBody: {
      flex: 1,
      borderLeftWidth: 2,
      borderLeftColor: t.line,
      paddingLeft: 6,
      minHeight: 60,
    },
    // Week
    weekRow: { flex: 1, flexDirection: "row", paddingHorizontal: 8 },
    weekCol: {
      flex: 1,
      marginHorizontal: 3,
      backgroundColor: t.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.line,
      overflow: "hidden",
    },
    weekHead: {
      fontFamily: t.body.bold,
      fontSize: 12,
      color: t.muted,
      textAlign: "center",
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    weekHeadToday: { color: t.accent },
    weekBody: { padding: 6 },
    // Month
    monthWrap: { paddingHorizontal: 12, paddingBottom: 12 },
    monthHeadRow: { flexDirection: "row" },
    monthHeadCell: {
      textAlign: "center",
      fontFamily: t.body.bold,
      fontSize: 11,
      color: t.muted,
      paddingVertical: 4,
    },
    monthGrid: { flexDirection: "row", flexWrap: "wrap" },
    monthCell: {
      height: 64,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.line,
      padding: 3,
    },
    monthCellToday: { backgroundColor: t.chipBg, borderColor: t.accent },
    monthDay: { fontFamily: t.body.semibold, fontSize: 12, color: t.ink },
    monthDayToday: { fontFamily: t.body.bold, color: t.accent },
    monthEmoji: { fontSize: 12, marginTop: 2 },
    monthCount: {
      position: "absolute",
      right: 4,
      bottom: 3,
      fontFamily: t.body.bold,
      fontSize: 10,
      color: t.accent,
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
      fontFamily: t.body.bold,
      fontSize: 12,
      color: t.accent,
      marginBottom: 4,
    },
    miniGrid: { flexDirection: "row", flexWrap: "wrap" },
    miniCell: {
      width: "14.28%",
      aspectRatio: 1,
      borderRadius: 2,
      borderWidth: 1,
      borderColor: t.line,
      alignItems: "center",
      justifyContent: "center",
    },
    miniEmoji: { fontSize: 11 },
    miniToday: { borderColor: t.accent, borderWidth: 1.5 },
    // Year — "À venir" side rail
    rail: {
      width: 220,
      backgroundColor: t.surface,
      borderLeftWidth: 1,
      borderLeftColor: t.line,
      paddingHorizontal: 12,
      paddingTop: 4,
    },
    railTitle: {
      fontFamily: t.body.bold,
      fontSize: 13,
      color: t.accent,
      marginBottom: 8,
    },
    railBody: { paddingBottom: 16 },
    railEmpty: { fontFamily: t.body.regular, fontSize: 12, color: t.muted, fontStyle: "italic" },
    railRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    railEmoji: { fontSize: 18, marginRight: 8 },
    railText: { flex: 1 },
    railDate: { fontFamily: t.body.bold, fontSize: 11, color: t.accent },
    railTask: { fontFamily: t.body.semibold, fontSize: 12, color: t.ink },
  });
}
