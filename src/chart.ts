import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, DataZoomInsideComponent as DataZoomComponent, MarkLineComponent, MarkAreaComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { buildGuides, buildOption, legendWidth, normalizeState, validateSeries, validateWindow } from "./option.js";
import { groupColors } from "./colors.js";
import { createLegend } from "./legend.js";
import { onSchemeChange, palettes, prefersDark } from "./palette.js";
import type { TimeChart, TimeChartOptions, TimeWindow } from "./types.js";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer]);

const patterns = new Map<string, HTMLCanvasElement>();
function hatch(stroke: string): HTMLCanvasElement | undefined {
  const cached = patterns.get(stroke);
  if (cached) return cached;
  const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.strokeStyle = stroke; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(8, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-1, 1); ctx.lineTo(1, -1); ctx.moveTo(7, 9); ctx.lineTo(9, 7); ctx.stroke();
  patterns.set(stroke, canvas);
  return canvas;
}

/**
 * Charts sharing a `link` key.  Besides zooming together, their auto-width
 * legends share the group's widest column so their plot areas line up.
 */
interface LinkMember {
  /** The chart's own auto legend width, or undefined for a fixed width. */
  autoWidth(): number | undefined;
  /** Takes the group width; returns whether the legend width changed. */
  adopt(width: number | undefined): boolean;
  redraw(): void;
}
const links = new Map<string, Set<LinkMember>>();
function syncLegends(group: string, self?: LinkMember) {
  const members = links.get(group);
  if (!members) return;
  const widths = [...members].map(m => m.autoWidth()).filter((w): w is number => w !== undefined);
  const width = widths.length ? Math.max(...widths) : undefined;
  for (const m of members) if (m.adopt(width) && m !== self) m.redraw();
}

export function createTimeChart(el: HTMLElement, options: TimeChartOptions): TimeChart {
  const state = normalizeState(options);
  const chart = echarts.init(el, undefined, { renderer: "canvas" });
  let destroyed = false;
  let guideTimer: ReturnType<typeof setTimeout> | undefined;
  let windowTimer: ReturnType<typeof setTimeout> | undefined;
  const group = options.link === undefined ? undefined : `0k-time-chart:${options.link}`;
  const autoLegend = options.legend?.width === "auto";

  function assertLive() { if (destroyed) throw new Error("TimeChart is destroyed"); }
  function getWindow(): TimeWindow {
    assertLive();
    const opt = chart.getOption();
    const zooms = opt.dataZoom as { startValue?: number; endValue?: number; start?: number; end?: number }[] | undefined;
    const zoom = zooms?.[0];
    if (typeof zoom?.startValue === "number" && typeof zoom.endValue === "number") return { start: zoom.startValue, end: zoom.endValue };
    const axes = opt.xAxis as { min: number; max: number }[] | undefined;
    const axis = axes?.[0];
    if (axis && zoom) return { start: axis.min + (axis.max - axis.min) * (zoom.start ?? 0) / 100, end: axis.min + (axis.max - axis.min) * (zoom.end ?? 100) / 100 };
    return { ...state.window };
  }
  function refreshGeometry() { state.width = chart.getWidth(); state.height = chart.getHeight(); state.now = Date.now(); }
  function setPalette(dark: boolean) {
    state.palette = palettes[dark ? "dark" : "light"];
    const image = hatch(state.palette.hatch);
    state.hatch = image ? { image, repeat: "repeat" } : undefined;
  }
  // Only the first render replaces everything.  Later renders replace the
  // series list but merge components: a notMerge update disposes the tooltip
  // view while ECharts' own keep-show timer still references it.
  let rendered = false;
  function render() {
    refreshGeometry();
    chart.setOption(buildOption(state) as unknown as echarts.EChartsCoreOption, rendered ? { replaceMerge: ["series"], silent: true } : { notMerge: true, silent: true });
    legend.render(state);
    rendered = true;
  }
  function refreshGuides() {
    if (destroyed) return;
    state.window = getWindow(); refreshGeometry();
    chart.setOption({ series: [buildGuides(state)] } as unknown as echarts.EChartsCoreOption, { silent: true });
  }
  function scheduleGuides() {
    clearTimeout(guideTimer);
    guideTimer = setTimeout(() => { guideTimer = undefined; refreshGuides(); }, 100);
  }
  function onZoom() {
    state.window = getWindow(); scheduleGuides();
    clearTimeout(windowTimer);
    windowTimer = setTimeout(() => { windowTimer = undefined; if (!destroyed) { const w = getWindow(); options.onWindowChange?.(w.start, w.end); } }, 150);
  }
  function toggle(id: string) {
    if (destroyed || !state.series.some(s => s.id === id)) return;
    const visible = state.hidden.has(id);
    if (visible) state.hidden.delete(id); else state.hidden.add(id);
    state.window = getWindow(); render(); options.onLegendToggle?.(id, visible);
  }
  const legend = createLegend(el, toggle);
  // Labels are measured only when they change, not on every render.
  let measuredLabels: string | undefined;
  function measureLegend() {
    if (!autoLegend) return;
    const labels = state.series.map(s => s.label), key = labels.join("\u0000");
    if (key === measuredLabels) return;
    measuredLabels = key; state.legendLabelWidth = legend.measure(labels);
  }
  const member: LinkMember = {
    autoWidth: () => autoLegend ? legendWidth({ ...state, legendLinkedWidth: undefined }) : undefined,
    adopt(width) {
      if (!autoLegend || state.legendLinkedWidth === width) return false;
      const before = legendWidth(state);
      state.legendLinkedWidth = width;
      return legendWidth(state) !== before;
    },
    redraw() { if (!destroyed) { state.window = getWindow(); render(); } },
  };
  setPalette(options.theme === "dark" || (options.theme !== "light" && prefersDark()));
  measureLegend();
  if (group) {
    chart.group = group;
    const members = links.get(group) ?? new Set<LinkMember>();
    links.set(group, members.add(member)); echarts.connect(group);
    syncLegends(group, member);
  }
  render();
  chart.on("datazoom", onZoom);
  const unsubscribe = options.theme === undefined || options.theme === "auto" ? onSchemeChange(dark => { state.window = getWindow(); setPalette(dark); render(); }) : () => undefined;
  const clock = setInterval(refreshGuides, 60_000);
  function resize() { assertLive(); chart.resize(); scheduleGuides(); }
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
  observer?.observe(el);
  if (!observer) window.addEventListener("resize", resize);

  return {
    getWindow,
    setSeries(series) {
      assertLive(); validateSeries(series); state.window = getWindow();
      const newColors = groupColors(series);
      for (const s of series) if (s.color) state.colors.set(s.id, s.color); else if (!state.colors.has(s.id)) state.colors.set(s.id, newColors.get(s.id)!);
      state.series = series; measureLegend();
      if (group) syncLegends(group, member);
      render();
    },
    setWindow(start, end) {
      assertLive(); validateWindow(start, end); clearTimeout(windowTimer); windowTimer = undefined;
      state.window = { start, end }; render();
    },
    setHidden(ids) { assertLive(); state.window = getWindow(); state.hidden = new Set(ids); render(); },
    highlight(ids) { assertLive(); state.window = getWindow(); state.highlight = ids === null ? null : new Set(ids); render(); },
    setLegendCollapsed(collapsed) { assertLive(); state.window = getWindow(); state.legendCollapsed = collapsed; render(); },
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true; clearTimeout(guideTimer); clearTimeout(windowTimer); clearInterval(clock);
      unsubscribe(); observer?.disconnect(); if (!observer) window.removeEventListener("resize", resize);
      chart.off("datazoom", onZoom); legend.destroy(); chart.dispose();
      if (group) {
        const members = links.get(group);
        members?.delete(member);
        if (!members?.size) { links.delete(group); echarts.disconnect(group); } else syncLegends(group);
      }
    },
  };
}
