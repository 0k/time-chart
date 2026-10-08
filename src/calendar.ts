export interface Guide {
  t: number;
  tier: "day" | "month" | "year" | "now";
  label: string | null;
  lineAlpha: number;
  labelAlpha: number;
  monday: boolean;
  hidden?: boolean;
}
export interface Band { start: number; end: number; alpha: number }

const DAY_MS = 86_400_000;
const MAX_ITEMS = 400;
const LABEL_WIDTH = 22;
const LABEL_MIN = 0.08;

/** Interval and span use the same unit (the source used seconds). */
export function markerAlpha(interval: number, span: number, width: number): number {
  if (span <= 0 || width <= 0) return 0;
  const px = interval / span * width;
  return px < 3 ? 0 : Math.min((px - 3) / 47, 1);
}

/** Pure geometry; the optional fifth argument controls localized short names. */
export function calendarGuides(startMs: number, endMs: number, widthPx: number, nowMs: number, locale?: string): { lines: Guide[]; bands: Band[] } {
  const lines: Guide[] = [], bands: Band[] = [];
  const span = endMs - startMs;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(widthPx) || widthPx <= 0) return { lines, bands };
  const dayAlpha = markerAlpha(DAY_MS, span, widthPx);
  const monthAlpha = markerAlpha(30 * DAY_MS, span, widthPx);
  const yearAlpha = markerAlpha(365 * DAY_MS, span, widthPx);
  const labelAlpha = Math.max(0, Math.min((DAY_MS / span * widthPx - LABEL_WIDTH) / LABEL_WIDTH, 1)) * dayAlpha;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const month = new Intl.DateTimeFormat(locale, { month: "short" });

  if (dayAlpha > 0) {
    // Build every day from its date parts: stepping an existing Date would
    // carry the 01:00 of a day whose midnight a DST jump skipped onto all
    // following days.
    const start = new Date(startMs);
    const y = start.getFullYear(), m = start.getMonth(), first = start.getDate();
    let day = first;
    if (new Date(y, m, day).getTime() < startMs) day++;
    for (let count = 0, d = new Date(y, m, day); d.getTime() <= endMs && count < MAX_ITEMS; count++, d = new Date(y, m, ++day)) {
      const t = d.getTime(), monday = d.getDay() === 1;
      lines.push({ t, tier: "day", label: labelAlpha > LABEL_MIN ? weekday.format(d) : null, lineAlpha: dayAlpha * (monday ? 0.7 : 0.5), labelAlpha, monday });
    }
    // Start one day early: a weekend in progress at startMs began on a
    // Saturday before the window, and is still hatched.
    for (let count = 0, i = first - 1, d = new Date(y, m, i); d.getTime() <= endMs && count < MAX_ITEMS; count++, d = new Date(y, m, ++i)) {
      const end = new Date(y, m, i + 2).getTime();
      if (d.getDay() === 6 && end > startMs) bands.push({ start: d.getTime(), end, alpha: dayAlpha * 0.9 });
    }
  }
  if (monthAlpha > 0) {
    const start = new Date(startMs);
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    if (d.getTime() < startMs) d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    for (let count = 0; d.getTime() <= endMs && count < MAX_ITEMS; count++, d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const hidden = d.getMonth() === 0;
      lines.push({ t: d.getTime(), tier: "month", label: month.format(d), lineAlpha: hidden ? 0 : monthAlpha * 0.6, labelAlpha: monthAlpha * 0.85, monday: false, hidden });
    }
  }
  if (yearAlpha > 0) {
    let y = new Date(startMs).getFullYear();
    if (new Date(y, 0, 1).getTime() < startMs) y++;
    for (let count = 0; count < MAX_ITEMS && new Date(y, 0, 1).getTime() <= endMs; count++, y++) {
      lines.push({ t: new Date(y, 0, 1).getTime(), tier: "year", label: String(y), lineAlpha: yearAlpha * 0.7, labelAlpha: yearAlpha * 0.95, monday: false });
    }
  }
  if (nowMs >= startMs && nowMs <= endMs) lines.push({ t: nowMs, tier: "now", label: "now", lineAlpha: 0.9, labelAlpha: 1, monday: false });
  return { lines, bands };
}
