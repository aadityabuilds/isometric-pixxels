import type { ScenePreset } from "./types";

const PRESET_MINUTES: Record<Exclude<ScenePreset, "live">, number> = {
  morning: 8 * 60 + 40,
  "class-change": 10 * 60 + 22,
  lunch: 12 * 60 + 15,
  evening: 18 * 60 + 10,
  night: 23 * 60 + 30,
};

export interface CampusTime {
  /** minutes since midnight, Pacific time */
  minutes: number;
  /** 0 = Monday ... 6 = Sunday */
  weekday: number;
  /** YYYYMMDD in Pacific time */
  ymd: string;
  label: string;
}

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function campusTime(now: Date, preset: ScenePreset, presetSince = now.getTime()): CampusTime {
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdayLive = DAYS.indexOf(parts.weekday);
  let minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute) + Number(parts.second) / 60;
  let weekday = weekdayLive;
  if (preset !== "live") {
    // Presets replay a weekday at a fixed time, ticking forward from when they were chosen.
    minutes = PRESET_MINUTES[preset] + (((now.getTime() - presetSince) / 60000) % 20);
    weekday = Math.min(weekdayLive, 4);
  }
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  const label = `${DAYS[weekday]} ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return { minutes, weekday, ymd: `${parts.year}${parts.month}${parts.day}`, label };
}

/** Stanford classes start on the hour and half hour; foot and bike traffic peaks in the ten minutes before. */
export function classChange(minutes: number) {
  const intoHalf = minutes % 30;
  const before = 30 - intoHalf;
  return before <= 10 ? 1 - before / 10 + 0.3 : intoHalf < 4 ? 0.8 - intoHalf * 0.2 : 0;
}

function bump(minutes: number, center: number, width: number) {
  const d = (minutes - center) / width;
  return Math.exp(-d * d);
}

export interface Densities {
  students: number;
  bikes: number;
  cars: number;
  parkedShare: number;
}

export function densities(t: CampusTime): Densities {
  const m = t.minutes;
  const weekend = t.weekday >= 5;
  const day = m > 7 * 60 && m < 22 * 60 ? 1 : m > 6 * 60 && m < 23.5 * 60 ? 0.45 : 0.12;
  const classes = !weekend && m > 8 * 60 && m < 18 * 60 ? classChange(m) : 0;
  const meals = bump(m, 12 * 60 + 10, 50) + bump(m, 18 * 60 + 15, 60) * 0.8 + bump(m, 8 * 60, 35) * 0.5;
  const commute = weekend ? 0.3 : bump(m, 8 * 60 + 30, 60) + bump(m, 17 * 60 + 15, 75);
  return {
    students: Math.round((weekend ? 650 : 1200) * day + 3900 * classes + 900 * meals),
    bikes: Math.round((weekend ? 260 : 560) * day + 2800 * classes + 280 * meals),
    cars: Math.round(70 + 260 * day + 520 * commute),
    parkedShare: weekend ? 0.3 + 0.2 * day : 0.25 + 0.6 * Math.min(1, day * (m > 7.5 * 60 && m < 19 * 60 ? 1 : 0.5)),
  };
}

export function serviceActive(
  svc: { days: number[]; start: string; end: string; add: string[]; remove: string[] } | undefined,
  t: CampusTime,
) {
  if (!svc) return false;
  if (svc.remove.includes(t.ymd)) return false;
  if (svc.add.includes(t.ymd)) return true;
  return svc.days[t.weekday] === 1 && t.ymd >= svc.start && t.ymd <= svc.end;
}
