import { calendarGuides } from "./calendar.js";
import { groupColors } from "./colors.js";
import { palettes, type Palette } from "./palette.js";
import type { Point, TimeChartOptions, TimeSeries, TimeWindow } from "./types.js";

export const GRID_LEFT = 64, GRID_TOP = 64, GRID_BOTTOM = 44;
export const GUIDE_ID = "\u0000time-guides";
const DAY_MS = 86_400_000;
const RISE = { day: 26, month: 45, year: 65, now: 27 };

export interface NormalizedState {
  options: TimeChartOptions;
  series: TimeSeries[];
  window: TimeWindow;
  colors: Map<string, string>;
  hidden: Set<string>;
  highlight: Set<string> | null;
  legendCollapsed: boolean;
  width: number;
  height: number;
  now: number;
  palette: Palette;
  hatch?: { image: HTMLCanvasElement; repeat: "repeat" };
}

export function validateWindow(start: number, end: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new RangeError("Window must have finite start < end");
}
export function validateSeries(series: TimeSeries[]): void {
  const ids = new Set<string>();
  for (const s of series) {
    if (!s.id || s.id.startsWith("\u0000") || ids.has(s.id)) throw new Error("Series ids must be unique, nonempty and not start with NUL");
    ids.add(s.id);
    if ((s.min === undefined) !== (s.max === undefined) || (s.min && (s.min.length !== s.points.length || s.max?.length !== s.points.length))) throw new Error(`Band arrays must both match points: ${s.id}`);
    let previous = -Infinity;
    s.points.forEach(([t, v], i) => {
      if (!Number.isFinite(t) || t < previous || (v !== null && !Number.isFinite(v))) throw new Error(`Points must be finite and time-sorted: ${s.id}`);
      previous = t;
      const lo = s.min?.[i], hi = s.max?.[i];
      if ((lo != null && !Number.isFinite(lo)) || (hi != null && !Number.isFinite(hi)) || (lo != null && hi != null && lo > hi)) throw new Error(`Invalid band bounds: ${s.id}`);
    });
  }
}
export function dataExtent(series: TimeSeries[], now: number): TimeWindow {
  let start = Infinity, end = -Infinity;
  for (const s of series) for (const [t] of s.points) { start = Math.min(start, t); end = Math.max(end, t); }
  if (start === Infinity) return { start: now - DAY_MS, end: now };
  return { start, end: end === start ? end + DAY_MS : end };
}
export function normalizeState(options: TimeChartOptions, width = 1000, height = 400, now = Date.now()): NormalizedState {
  validateSeries(options.series);
  if (options.window) validateWindow(options.window.start, options.window.end);
  const colors = groupColors(options.series);
  for (const s of options.series) if (s.color) colors.set(s.id, s.color);
  return { options, series: options.series, window: options.window ? { ...options.window } : dataExtent(options.series, now), colors, hidden: new Set(), highlight: null, legendCollapsed: options.legend?.collapsed ?? false, width, height, now, palette: palettes.light };
}
export function legendWidth(state: NormalizedState): number {
  return state.options.legend?.width ?? 340;
}
export function gridRight(state: NormalizedState): number {
  return state.legendCollapsed || state.options.legend?.show === false ? 24 : legendWidth(state) + 24;
}

function valueExtent(series: TimeSeries[]): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  const totals = new Map<number, { positive: number; negative: number }>();
  for (const s of series) s.points.forEach(([t, v], i) => {
    for (const n of [v, s.min?.[i], s.max?.[i]]) if (n != null) { min = Math.min(min, n); max = Math.max(max, n); }
    if (s.stack && v !== null) {
      const total = totals.get(t) ?? { positive: 0, negative: 0 };
      if (v >= 0) total.positive += v; else total.negative += v;
      totals.set(t, total);
    }
  });
  for (const total of totals.values()) { max = Math.max(max, total.positive); min = Math.min(min, total.negative); }
  return { min, max };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
interface TooltipRow { seriesName?: string; value?: unknown }

export function buildGuides(state: NormalizedState) {
  const p = state.palette;
  const geometry = calendarGuides(state.window.start, state.window.end, Math.max(1, state.width - GRID_LEFT - gridRight(state)), state.now, state.options.locale);
  return {
    id: GUIDE_ID, name: GUIDE_ID, type: "line" as const, data: [] as Point[], silent: true, showSymbol: false, tooltip: { show: false }, z: 0,
    markArea: {
      silent: true,
      data: geometry.bands.map(b => [{ xAxis: b.start, itemStyle: { color: state.hatch ?? p.hatch, opacity: b.alpha } }, { xAxis: b.end }]),
    },
    markLine: {
      silent: true, symbol: "none", clip: false, emphasis: { disabled: true },
      data: geometry.lines.map(g => {
        const size = g.tier === "year" ? 13 : g.tier === "day" ? 10 : 11;
        const color = g.tier === "day" ? (g.monday ? p.mondayLine : p.dayLine) : p[`${g.tier}Line`];
        return [
          { xAxis: g.t, y: state.height - GRID_BOTTOM,
            lineStyle: { color, width: g.tier === "year" ? 1.2 : g.tier === "month" ? 0.8 : g.tier === "now" ? 1.6 : g.monday ? 0.9 : 0.6, opacity: g.lineAlpha, type: g.tier === "day" ? [1, 3] : g.tier === "month" ? [3, 3] : g.tier === "year" ? [6, 4] : "solid" },
            label: { show: g.label !== null, formatter: g.label ?? "", position: "end", rotate: 0, distance: 0, offset: [3, size + 2], align: "left", verticalAlign: "bottom", color: p[`${g.tier}Label`], opacity: g.labelAlpha, fontSize: size, fontWeight: g.tier === "day" ? "normal" : "bold" },
          },
          { xAxis: g.t, y: GRID_TOP - RISE[g.tier] },
        ];
      }),
    },
  };
}

export function buildOption(state: NormalizedState) {
  const { options, palette: p } = state;
  const labels = new Map(state.series.map(s => [s.id, s.label]));
  const formatValue = options.formatValue ?? (v => v.toLocaleString(options.locale));
  const formatTime = options.formatTime ?? (t => new Intl.DateTimeFormat(options.locale, { dateStyle: "medium", timeStyle: "short" }).format(t));
  const extent = dataExtent(state.series, state.now), span = Math.max(extent.end - extent.start, DAY_MS);
  const values = valueExtent(state.series);
  const real = state.series.map(s => {
    const dim = state.highlight !== null && !state.highlight.has(s.id);
    return {
      id: s.id, name: s.id, type: "line" as const, data: s.points, color: state.colors.get(s.id), showSymbol: false, connectNulls: false,
      stack: s.stack ? "__stack__" : undefined, areaStyle: s.stack ? { opacity: 0.6 } : undefined,
      lineStyle: { color: state.colors.get(s.id), width: dim ? 0.5 : state.highlight ? 2 : 1, opacity: dim ? 0.7 : 1 },
      itemStyle: { color: state.colors.get(s.id), opacity: dim ? 0.7 : 1 }, emphasis: { disabled: true }, tooltip: { show: true }, z: 2,
    };
  });
  const bands = state.series.flatMap(s => {
    if (!s.min || !s.max) return [];
    const lower: Point[] = [], delta: Point[] = [];
    if (!state.hidden.has(s.id)) s.points.forEach(([t, v], i) => {
      const lo = s.min![i], hi = s.max![i], gap = v === null || lo === null || hi === null;
      lower.push([t, gap ? null : lo]); delta.push([t, gap ? null : hi - lo]);
    });
    return [lower, delta].map((data, i) => ({
      id: `\u0000band:${s.id}:${i}`, name: `\u0000band:${s.id}:${i}`, type: "line" as const, data,
      stack: `\u0000band:${s.id}`, stackStrategy: "all" as const, silent: true, showSymbol: false, connectNulls: false,
      lineStyle: { width: 0, opacity: 0 }, itemStyle: { color: state.colors.get(s.id), opacity: 0 },
      areaStyle: { color: state.colors.get(s.id), opacity: i === 0 ? 0 : p.bandAlpha }, tooltip: { show: false }, emphasis: { disabled: true }, z: 1,
    }));
  });
  return {
    animation: false,
    grid: { left: GRID_LEFT, top: GRID_TOP, bottom: GRID_BOTTOM, right: gridRight(state) },
    xAxis: { type: "time" as const, min: Math.min(extent.start - 2 * span, state.window.start), max: Math.max(extent.end + 2 * span, state.window.end), axisLine: { lineStyle: { color: p.axisLine } }, axisLabel: { color: p.axisLabel, hideOverlap: true }, splitLine: { show: true, lineStyle: { color: p.splitLine } } },
    yAxis: {
      // null (not undefined) means "auto" so merged updates clear an old bound.
      type: "value" as const, min: options.yAxis?.min === "auto" ? null : options.yAxis?.min ?? (values.min >= 0 ? 0 : null),
      max: options.yAxis?.max === "auto" ? null : typeof options.yAxis?.max === "number" ? options.yAxis.max : (values.max > 0 ? values.max : 1) * 1.2,
      name: options.yAxis?.name ?? "", nameLocation: "middle", nameGap: 46, nameTextStyle: { color: p.axisName },
      axisLabel: { color: p.axisLabel, formatter: formatValue }, splitLine: { lineStyle: { color: p.splitLine } },
    },
    dataZoom: [{ type: "inside" as const, xAxisIndex: 0, filterMode: "none", startValue: state.window.start, endValue: state.window.end, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false }],
    // Never drawn: legend.ts shows a scrolling HTML legend instead.  The
    // component stays for `selected`, which hides the deselected series.
    legend: { show: false, data: state.series.map(s => s.id), selected: Object.fromEntries(state.series.map(s => [s.id, !state.hidden.has(s.id)])) },
    tooltip: {
      trigger: options.tooltip ?? "axis", confine: true, backgroundColor: p.tooltipBg, borderColor: p.tooltipBorder, borderWidth: 1, textStyle: { color: p.tooltipText, fontSize: 12 },
      formatter: (input: TooltipRow | TooltipRow[]) => {
        const rows = (Array.isArray(input) ? input : [input]).flatMap(row => {
          const id = row.seriesName ?? "", value = row.value;
          if (!labels.has(id) || state.hidden.has(id) || !Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number" || !Number.isFinite(value[1])) return [];
          return [{ id, t: value[0] as number, v: value[1] as number }];
        }).sort((a, b) => b.v - a.v);
        if (!rows.length) return "";
        return `<div>${escapeHtml(formatTime(rows[0].t))}</div>` + rows.map(row => `<div><span style="color:${escapeHtml(state.colors.get(row.id) ?? p.tooltipText)}">●</span> ${escapeHtml(labels.get(row.id)!)}: ${escapeHtml(formatValue(row.v))}</div>`).join("");
      },
    },
    series: [...real, ...bands, buildGuides(state)],
  };
}
