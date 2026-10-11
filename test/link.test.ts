import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { createTimeChart } from "../src/chart";
import type { TimeChart, TimeChartOptions } from "../src/types";

// Real ECharts models and actions in Node, with SVG SSR.
// Only initialization substitutes the browser canvas; the DOM hosts the legend.
const instances = vi.hoisted(() => [] as echarts.EChartsType[]);
vi.mock("echarts/core", async importOriginal => {
  const actual = await importOriginal<typeof echarts>();
  return { ...actual, init: () => {
    const chart = actual.init(null, undefined, { renderer: "svg", ssr: true, width: 1000, height: 400 });
    instances.push(chart);
    return chart;
  } };
});
echarts.use([SVGRenderer]);

const DAY = 86_400_000;
const charts: TimeChart[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  charts.forEach(c => c.destroy()); charts.length = 0; instances.length = 0;
  document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks();
});
function linked(start: number, end: number, link = "range", extra: Partial<TimeChartOptions> = {}) {
  const onWindowChange = vi.fn();
  const el = document.body.appendChild(document.createElement("div"));
  const chart = createTimeChart(el, {
    series: [{ id: "a", label: "A", points: [[start * DAY, 1], [end * DAY, 2]] }],
    window: { start: 5 * DAY, end: 10 * DAY }, link, theme: "light", onWindowChange, ...extra,
  });
  charts.push(chart);
  return { chart, instance: instances.at(-1)!, onWindowChange };
}
function zoom(instance: echarts.EChartsType, start: number, end: number) {
  const [axis] = instance.getOption().xAxis as { min: number; max: number }[];
  // Inside zoom/drag actions carry percentages, not time values.
  instance.dispatchAction({ type: "dataZoom", start: (start * DAY - axis.min) / (axis.max - axis.min) * 100, end: (end * DAY - axis.min) / (axis.max - axis.min) * 100 });
}
function expectWindow(chart: TimeChart, start: number, end: number) {
  expect(chart.getWindow().start).toBeCloseTo(start * DAY, 3);
  expect(chart.getWindow().end).toBeCloseTo(end * DAY, 3);
}

it("keeps different data ranges on the same time window for zoom and pan in either chart", () => {
  const a = linked(0, 20), b = linked(5, 15);
  for (const [source, start, end] of [[a, 6, 8], [b, 7, 9], [a, 3, 12]] as const) {
    zoom(source.instance, start, end);
    expectWindow(a.chart, start, end); expectWindow(b.chart, start, end);
    vi.advanceTimersByTime(150);
    for (const target of [a, b]) {
      expect(target.onWindowChange.mock.lastCall?.[0]).toBeCloseTo(start * DAY, 3);
      expect(target.onWindowChange.mock.lastCall?.[1]).toBeCloseTo(end * DAY, 3);
    }
  }
});
it("relays a user window exactly once, without echoing it back", () => {
  const a = linked(0, 20), b = linked(5, 15);
  const echoes = vi.fn(); a.instance.on("datazoom", echoes);
  zoom(a.instance, 6, 8); vi.advanceTimersByTime(1000);
  expect(echoes).toHaveBeenCalledOnce();
  for (const target of [a, b]) expect(target.onWindowChange).toHaveBeenCalledOnce();
});

// Hovering one chart points every linked chart at the same time, even when
// their timestamps and plot widths differ.
const PLOT_MIDDLE = 64 + (400 - 64 - 44) / 2;
function hover(instance: echarts.EChartsType, day: number) {
  const x = instance.convertToPixel({ xAxisIndex: 0 }, day * DAY) as number;
  instance.dispatchAction({ type: "updateAxisPointer", x, y: PLOT_MIDDLE });
}
function pointerOf(instance: echarts.EChartsType) {
  const seen: (number | null)[] = [];
  instance.on("updateaxispointer", e => { seen.push((e as { axesInfo?: { axisDim: string; value: number }[] }).axesInfo?.find(i => i.axisDim === "x")?.value ?? null); });
  return () => seen.at(-1);
}
it("points linked charts at the hovered time, and hides their pointer outside their data or window, or on leave", () => {
  const a = linked(0, 20, "hover", { legend: { width: 300 } });
  const b = linked(5, 15, "hover", { legend: { width: 100 }, series: [{ id: "b", label: "B", points: Array.from({ length: 21 }, (_, i) => [(5.25 + i / 2) * DAY, i]) }] });
  const pointer = pointerOf(b.instance);
  hover(a.instance, 7);
  expect(Math.abs(pointer()! - 7 * DAY)).toBeLessThanOrEqual(DAY / 4);
  a.instance.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" });
  expect(pointer()).toBeNull();
  zoom(a.instance, 1, 19);
  hover(a.instance, 3);
  expect(pointer()).toBeNull();
  b.chart.setWindow(12 * DAY, 14 * DAY);
  hover(a.instance, 7);
  expect(pointer()).toBeNull();
});
// Sparse linked data: the linked pointer stays on the hovered time instead
// of snapping to the nearest point, and item tooltips link too.
it.each(["axis", "item"] as const)("points a sparse linked chart exactly at the hovered time (tooltip %s)", tooltip => {
  const a = linked(0, 20, "sparse", { tooltip });
  const b = linked(5, 15, "sparse", { tooltip, series: [{ id: "b", label: "B", points: [[5 * DAY, 1], [9 * DAY, 2], [15 * DAY, 3]] }] });
  const pointer = pointerOf(b.instance);
  hover(a.instance, 7);
  expect(pointer()).toBeCloseTo(7 * DAY, -6);
});
it.each([[[[8 * DAY, 1]]], [[]]] as const)("shows no linked pointer beside a peer's single point or empty data (%j)", points => {
  const a = linked(0, 20, "edge");
  const b = linked(5, 15, "edge", { series: [{ id: "b", label: "B", points: points as unknown as [number, number][] }] });
  const pointer = pointerOf(b.instance);
  hover(a.instance, 8.5);
  expect(pointer() ?? null).toBeNull();
});
it("redraws no linked chart when another one gets new data", () => {
  const a = linked(0, 20), b = linked(5, 15);
  const redraws = vi.spyOn(b.instance, "setOption");
  a.chart.setSeries([{ id: "a", label: "A", points: [[-100 * DAY, 1], [100 * DAY, 2]] }]);
  expect(redraws).not.toHaveBeenCalled();
});
it("follows a user window outside a linked chart's own data, but not a local setWindow or another group", () => {
  const a = linked(0, 20), b = linked(5, 15), other = linked(0, 20, "other");
  b.chart.setSeries([{ id: "a", label: "A", points: [[-100 * DAY, 1], [100 * DAY, 2]] }]);
  a.chart.setWindow(-1000 * DAY, -900 * DAY);
  expectWindow(b.chart, 5, 10); vi.advanceTimersByTime(150);
  for (const target of [a, b]) expect(target.onWindowChange).not.toHaveBeenCalled();
  for (const [start, end] of [[-400, -300], [300, 400]]) {
    zoom(b.instance, start, end);
    expectWindow(a.chart, start, end); expectWindow(b.chart, start, end);
  }
  expectWindow(other.chart, 5, 10);
  vi.advanceTimersByTime(150); expect(other.onWindowChange).not.toHaveBeenCalled();
});
it("removes destroyed members and safely reuses the link key", () => {
  const a = linked(0, 20), b = linked(5, 15);
  zoom(b.instance, 6, 8);
  a.chart.destroy(); a.chart.destroy();
  zoom(b.instance, 7, 9); vi.advanceTimersByTime(150);
  expect(a.onWindowChange).not.toHaveBeenCalled(); expectWindow(b.chart, 7, 9);
  const c = linked(-50, 50);
  zoom(c.instance, 7, 9); expectWindow(b.chart, 7, 9);
  b.chart.destroy(); c.chart.destroy();
  const d = linked(0, 20), e = linked(5, 15);
  zoom(e.instance, 6, 8); expectWindow(d.chart, 6, 8);
});
