import { calendarGuides } from "./calendar.js";
import { groupColors } from "./colors.js";
import { palettes, type Palette } from "./palette.js";
import type { Point, TimeChartOptions, TimeSeries, TimeWindow } from "./types.js";

export const GRID_LEFT = 64, GRID_TOP = 64, GRID_BOTTOM = 44;
export const GUIDE_ID = "\u0000time-guides";
const DAY_MS = 86_400_000;
const RISE = { day: 26, month: 45, year: 65, now: 27 };
// ECharts draws 5 minor ticks instead of 100 or more.
const MAX_MINOR_SPLIT = 99;

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
  /** Widest legend label in px, measured when labels change (auto width). */
  legendLabelWidth: number;
  /** Widest auto column of the chart's link group, if linked. */
  legendLinkedWidth?: number;
}
// Legend column around the label: 18px swatch + 6px gap + 12px scrollbar
// gutter + 8px right margin + 8px gap to the plot (legend.ts).
export const LEGEND_CHROME = 52, LEGEND_MIN_WIDTH = 80, LEGEND_MAX_WIDTH = 240;

export function validateWindow(start: number, end: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new RangeError("Window must have finite start < end");
}
export function validateSeries(series: TimeSeries[]): void {
  const ids = new Set<string>();
  for (const s of series) {
    if (!s.id || s.id.startsWith("\u0000") || ids.has(s.id)) throw new Error("Series ids must be unique, nonempty and not start with NUL");
    ids.add(s.id);
    if ((s.min === undefined) !== (s.max === undefined) || (s.min && (s.min.length !== s.points.length || s.max?.length !== s.points.length))) throw new Error(`Band arrays must both match points: ${s.id}`);
    if (s.width !== undefined && (!Number.isFinite(s.width) || s.width <= 0)) throw new Error(`Width must be finite and positive: ${s.id}`);
    if (s.fill !== undefined && (!Number.isFinite(s.fill) || s.fill <= 0 || s.fill > 1)) throw new Error(`Fill opacity must be in (0,1]: ${s.id}`);
    if (s.fill !== undefined && s.stack) throw new Error(`Fill cannot be combined with stack: ${s.id}`);
    if (s.band !== undefined && (s.min === undefined || s.max === undefined)) throw new Error(`Band style requires min and max: ${s.id}`);
    if (s.band?.opacity !== undefined && (!Number.isFinite(s.band.opacity) || s.band.opacity <= 0 || s.band.opacity > 1)) throw new Error(`Band opacity must be in (0,1]: ${s.id}`);
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
/** Full time-axis bounds: the data padded by twice its span, and the window. */
export function axisExtent(state: NormalizedState): TimeWindow {
  const extent = dataExtent(state.series, state.now), span = Math.max(extent.end - extent.start, DAY_MS);
  return { start: Math.min(extent.start - 2 * span, state.window.start), end: Math.max(extent.end + 2 * span, state.window.end) };
}
export function normalizeState(options: TimeChartOptions, width = 1000, height = 400, now = Date.now()): NormalizedState {
  validateSeries(options.series);
  const interval = options.yAxis?.interval, minorInterval = options.yAxis?.minorInterval;
  if (interval !== undefined && (!Number.isFinite(interval) || interval <= 0)) throw new Error("yAxis interval must be finite and positive");
  if (minorInterval !== undefined) {
    const count = (interval ?? NaN) / minorInterval;
    if (!Number.isFinite(minorInterval) || minorInterval <= 0 || !Number.isFinite(count) || Math.round(count) < 2 || Math.round(count) > MAX_MINOR_SPLIT || Math.abs(count - Math.round(count)) > Number.EPSILON * Math.max(1, count) * 4) throw new Error(`yAxis minorInterval must divide interval into an integer count from 2 to ${MAX_MINOR_SPLIT}`);
  }
  if (options.window) validateWindow(options.window.start, options.window.end);
  const legend = options.legend;
  const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (legend?.width !== undefined && legend.width !== "auto" && !positive(legend.width)) throw new Error(`legend width must be "auto" or a finite positive number, got ${String(legend.width)}`);
  if (legend?.maxWidth !== undefined && !positive(legend.maxWidth)) throw new Error(`legend maxWidth must be a finite positive number, got ${String(legend.maxWidth)}`);
  const colors = groupColors(options.series);
  for (const s of options.series) if (s.color) colors.set(s.id, s.color);
  return { options, series: options.series, window: options.window ? { ...options.window } : dataExtent(options.series, now), colors, hidden: new Set(), highlight: null, legendCollapsed: options.legend?.collapsed ?? false, width, height, now, palette: palettes.light, legendLabelWidth: 0 };
}
/**
 * Width of the legend column, from the plot's right edge to the chart's.
 * A numeric (or default) width is used as is; an explicit `maxWidth` caps
 * it.  `"auto"` fits the widest label: swatch, gap, scrollbar gutter and
 * margins add LEGEND_CHROME; linked charts share the group's widest column.
 */
export function legendWidth(state: NormalizedState): number {
  const { width = 340, maxWidth } = state.options.legend ?? {};
  if (width !== "auto") return maxWidth === undefined ? width : Math.min(width, maxWidth);
  const own = Math.max(Math.ceil(state.legendLabelWidth) + LEGEND_CHROME, LEGEND_MIN_WIDTH);
  return Math.min(Math.max(own, state.legendLinkedWidth ?? 0), maxWidth ?? LEGEND_MAX_WIDTH);
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
  const lineLess = new Set(state.series.filter(s => s.line === false).map(s => s.id));
  const formatValue = options.formatValue ?? (v => v.toLocaleString(options.locale));
  const formatTime = options.formatTime ?? (t => new Intl.DateTimeFormat(options.locale, { dateStyle: "medium", timeStyle: "short" }).format(t));
  const extent = axisExtent(state);
  const values = valueExtent(state.series);
  const real = state.series.map(s => {
    const dim = state.highlight !== null && !state.highlight.has(s.id);
    return {
      id: s.id, name: s.id, type: "line" as const, data: s.points, color: state.colors.get(s.id), showSymbol: false, connectNulls: false,
      stack: s.stack ? "__stack__" : undefined, areaStyle: s.fill !== undefined ? { origin: "start" as const, opacity: s.fill } : s.stack ? { origin: "auto" as const, opacity: 0.6 } : undefined,
      lineStyle: { color: state.colors.get(s.id), width: s.line === false ? 0 : (s.width ?? 1) * (dim ? 0.5 : state.highlight ? 2 : 1), opacity: s.line === false ? 0 : dim ? 0.7 : 1, type: s.dash ?? "solid" },
      itemStyle: { color: state.colors.get(s.id), opacity: dim ? 0.7 : 1 }, emphasis: { disabled: true }, tooltip: { show: s.line !== false }, z: 2,
    };
  });
  const bands = state.series.flatMap(s => {
    if (!s.min || !s.max) return [];
    const lower: Point[] = [], delta: Point[] = [];
    if (!state.hidden.has(s.id)) s.points.forEach(([t, v], i) => {
      const lo = s.min![i], hi = s.max![i], gap = v === null || lo === null || hi === null;
      lower.push([t, gap ? null : lo]); delta.push([t, gap ? null : hi - lo]);
    });
    const decal = s.band?.pattern === "hatch" ? { color: state.colors.get(s.id), backgroundColor: "transparent", symbol: "rect", symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [1, 5], rotation: Math.PI / 4 } : undefined;
    return [lower, delta].map((data, i) => ({
      id: `\u0000band:${s.id}:${i}`, name: `\u0000band:${s.id}:${i}`, type: "line" as const, data,
      stack: `\u0000band:${s.id}`, stackStrategy: "all" as const, silent: true, showSymbol: false, connectNulls: false,
      lineStyle: { width: 0, opacity: 0 }, itemStyle: { color: state.colors.get(s.id), opacity: 0, decal: i === 1 ? decal : undefined },
      areaStyle: { color: i === 1 && decal ? "transparent" : state.colors.get(s.id), opacity: i === 0 ? 0 : s.band?.opacity ?? p.bandAlpha, decal: i === 1 ? decal : undefined }, tooltip: { show: false }, emphasis: { disabled: true }, z: 1,
    }));
  });
  return {
    animation: false,
    // The insets are the plot itself: guides, legend and linked alignment are
    // placed from them, so ECharts 6 must not shrink it around axis labels.
    grid: { left: GRID_LEFT, top: GRID_TOP, bottom: GRID_BOTTOM, right: gridRight(state), outerBoundsMode: "none" as const },
    // Linked charts point at the hovered time itself (no snapping to a point,
    // which differs between charts), also with item tooltips.
    xAxis: { type: "time" as const, min: extent.start, max: extent.end, axisPointer: { show: true, snap: false, triggerTooltip: (options.tooltip ?? "axis") === "axis" }, axisLine: { lineStyle: { color: p.axisLine } }, axisLabel: { color: p.axisLabel, hideOverlap: true }, splitLine: { show: true, lineStyle: { color: p.splitLine } } },
    yAxis: {
      // null (not undefined) means "auto" so merged updates clear an old bound.
      type: "value" as const, min: options.yAxis?.min === "auto" ? null : options.yAxis?.min ?? (values.min >= 0 ? 0 : null),
      max: options.yAxis?.max === "auto" ? null : typeof options.yAxis?.max === "number" ? options.yAxis.max : (values.max > 0 ? values.max : 1) * 1.2,
      // nameGap counts from the axis line: ECharts 6 would push the name past
      // the labels, off the canvas.
      name: options.yAxis?.name ?? "", nameLocation: "middle", nameGap: 46, nameMoveOverlap: false, nameTextStyle: { color: p.axisName },
      axisLabel: { color: p.axisLabel, formatter: formatValue }, splitLine: { lineStyle: { color: p.splitLine } },
      ...(options.yAxis?.interval !== undefined ? { interval: options.yAxis.interval } : {}),
      ...(options.yAxis?.minorInterval !== undefined ? { minorTick: { show: true, splitNumber: Math.round(options.yAxis.interval! / options.yAxis.minorInterval), lineStyle: { color: p.axisLine } }, minorSplitLine: { show: true, lineStyle: { color: p.splitLine, type: "dashed" as const } } } : {}),
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
          if (!labels.has(id) || lineLess.has(id) || state.hidden.has(id) || !Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number" || !Number.isFinite(value[1])) return [];
          return [{ id, t: value[0] as number, v: value[1] as number }];
        }).sort((a, b) => b.v - a.v);
        if (!rows.length) return "";
        return `<div>${escapeHtml(formatTime(rows[0].t))}</div>` + rows.map(row => `<div><span style="color:${escapeHtml(state.colors.get(row.id) ?? p.tooltipText)}">●</span> ${escapeHtml(labels.get(row.id)!)}: ${escapeHtml(formatValue(row.v))}</div>`).join("");
      },
    },
    series: [...real, ...bands, buildGuides(state)],
  };
}
