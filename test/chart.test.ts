import { afterEach, expect, it, vi } from "vitest";
import { createTimeChart } from "../src/chart";

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  return { handlers, charts: [] as { el: HTMLElement; option: Record<string, unknown> }[], disposed: false, observer: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), media: undefined as ((event: { matches: boolean }) => void) | undefined };
});
vi.mock("echarts/core", () => ({
  use: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  init: (el: HTMLElement) => {
    const chart = { el, option: {} as Record<string, unknown> };
    mock.charts.push(chart);
    return {
      setOption: vi.fn((option: Record<string, unknown>) => { chart.option = { ...chart.option, ...option }; }),
      getOption: () => chart.option, getWidth: () => 1000, getHeight: () => 400,
      on: (name: string, cb: (e: unknown) => void) => mock.handlers.set(name, cb),
      off: (name: string) => mock.handlers.delete(name), resize: vi.fn(),
      dispose: () => { mock.disposed = true; },
    };
  },
}));
/** Option of the chart drawn in `el`, or of the last chart created. */
const option = (el?: HTMLElement) => (el ? mock.charts.find(c => c.el === el)! : mock.charts.at(-1)!).option;

const series = [{ id: "a", label: "Alpha", points: [[0, 1], [1000, 2]] as [number, number | null][] }];
function create(extra = {}) {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("ResizeObserver", class { observe = mock.observer; disconnect = mock.disconnect; });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: (_: string, cb: typeof mock.media) => { mock.media = cb; }, removeEventListener: mock.remove }));
  host = document.body.appendChild(document.createElement("div"));
  return createTimeChart(host, { series, ...extra });
}
let host: HTMLDivElement;
const two = [series[0], { id: "b", label: "Beta", points: series[0].points }];
const legend = () => host.querySelector<HTMLElement>("[data-time-chart-legend]")!;
const rows = () => Array.from(legend().querySelectorAll<HTMLElement>("[data-series-id]"));
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); mock.handlers.clear(); mock.charts.length = 0; vi.restoreAllMocks(); vi.clearAllMocks(); });
it("preserves window, hidden ids and existing colors across setSeries", () => {
  const chart = create(); chart.setWindow(100, 900); chart.setHidden(["a"]);
  const before = option().series; chart.setSeries([...series, { ...series[0], id: "b" }]);
  expect(chart.getWindow()).toEqual({ start: 100, end: 900 });
  const defs = option().series as { id: string; color?: string }[];
  expect(defs[0].color).toBe((before as typeof defs)[0].color);
  expect(option().legend).toMatchObject({ selected: { a: false } }); chart.destroy();
});
it("never calls the window callback for programmatic setWindow", () => {
  const onWindowChange = vi.fn(), chart = create({ onWindowChange }); chart.setWindow(100, 900); vi.advanceTimersByTime(500);
  expect(onWindowChange).not.toHaveBeenCalled(); chart.destroy();
});
it("debounces user windows at 150ms and guide updates at 100ms", () => {
  const onWindowChange = vi.fn(), chart = create({ onWindowChange });
  option().dataZoom = [{ startValue: 100, endValue: 900 }]; mock.handlers.get("datazoom")?.({});
  vi.advanceTimersByTime(149); expect(onWindowChange).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(onWindowChange).toHaveBeenCalledWith(100, 900); chart.destroy();
});
it("refreshes now without moving the window", () => {
  const chart = create(); chart.setWindow(100, 900); vi.advanceTimersByTime(60_000);
  expect(chart.getWindow()).toEqual({ start: 100, end: 900 }); chart.destroy();
});
it("follows live theme and tears down timers, observers and listeners", () => {
  const chart = create(); mock.media?.({ matches: true }); expect(option().tooltip).toMatchObject({ backgroundColor: "rgba(29,32,39,0.97)" });
  chart.destroy(); chart.destroy(); expect(vi.getTimerCount()).toBe(0); expect(mock.disconnect).toHaveBeenCalledOnce(); expect(mock.remove).toHaveBeenCalledOnce(); expect(mock.disposed).toBe(true);
});
it("lists every series in a legend that scrolls, spanning exactly the plot height", () => {
  const chart = create({ series: two, legend: { width: 300 } });
  expect(rows().map(r => [r.dataset.seriesId, r.textContent, r.title])).toEqual([["a", "Alpha", "Alpha"], ["b", "Beta", "Beta"]]);
  expect(legend().style).toMatchObject({ position: "absolute", top: "64px", bottom: "44px", right: "8px", width: "284px", overflowY: "auto", overscrollBehavior: "contain", paddingRight: "12px" });
  expect(host.style.position).toBe("relative");
  expect(option().legend).toMatchObject({ show: false }); chart.destroy();
});
it("toggles a series on click, keeps the scroll position, and reports it", () => {
  const onLegendToggle = vi.fn(), chart = create({ series: two, onLegendToggle });
  legend().scrollTop = 30; rows()[1].click();
  expect(option().legend).toMatchObject({ selected: { a: true, b: false } });
  expect(rows().map(r => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  expect(onLegendToggle).toHaveBeenCalledWith("b", false); expect(legend().scrollTop).toBe(30);
  rows()[1].click(); expect(onLegendToggle).toHaveBeenLastCalledWith("b", true); chart.destroy();
});
it("follows setHidden, setSeries and collapse, and honours show: false", () => {
  const chart = create({ series: two }); chart.setHidden(["a"]);
  expect(rows().map(r => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  chart.setSeries([two[1]]); expect(rows().map(r => r.dataset.seriesId)).toEqual(["b"]);
  chart.setLegendCollapsed(true); expect(legend().style.display).toBe("none");
  chart.setLegendCollapsed(false); expect(legend().style.display).toBe(""); chart.destroy();
  create({ legend: { show: false } }); expect(legend().style.display).toBe("none");
});
it("removes its legend on destroy", () => {
  const chart = create(); chart.destroy(); expect(host.querySelector("[data-time-chart-legend]")).toBeNull();
});

// Auto-width legends.  Text is measured by a stub: 6 px per character, so a
// column is 6 * (longest label length) + 52 px of swatch, gap, scrollbar
// gutter and margins.
const measured = vi.hoisted(() => ({ fonts: [] as string[], calls: 0 }));
function stubMeasure() {
  measured.fonts.length = 0; measured.calls = 0;
  const ctx = {
    font: "", beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(text: string) { measured.calls++; measured.fonts.push(ctx.font); return { width: text.length * 6 }; },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
}
const labelOf = (n: number) => "x".repeat(n);
const right = (el?: HTMLElement) => (option(el).grid as { right: number }).right;
const columnOf = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-time-chart-legend]")!.style.width;
function autoMeasured(labels: string[], extra: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe = mock.observer; disconnect = mock.disconnect; });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  stubMeasure();
  const el = document.body.appendChild(document.createElement("div"));
  const chart = createTimeChart(el, { series: labels.map((label, i) => ({ id: `s${i}`, label, points: series[0].points })), legend: { width: "auto", ...(extra.legend as object) }, ...(extra.link ? { link: extra.link as string } : {}) });
  return { chart, el };
}

it("sizes an auto legend to its widest label, measured in the legend's font", () => {
  const { el } = autoMeasured(["Alpha", labelOf(20)]);
  expect(right(el)).toBe(20 * 6 + 52 + 24);
  expect(columnOf(el)).toBe(`${20 * 6 + 52 - 16}px`);
  expect(measured.fonts.every(f => /11px/.test(f) && /sans-serif/.test(f))).toBe(true);
});
it("clamps an auto legend to maxWidth (default 240) and to a minimum", () => {
  expect(right(autoMeasured([labelOf(100)]).el)).toBe(240 + 24);
  expect(right(autoMeasured([labelOf(100)], { legend: { maxWidth: 150 } }).el)).toBe(150 + 24);
  expect(right(autoMeasured(["A"]).el)).toBe(80 + 24);
});
it("re-measures when labels change, not on renders that keep them", () => {
  const { chart, el } = autoMeasured([labelOf(10)]);
  const calls = measured.calls;
  chart.setHidden(["s0"]); chart.highlight(["s0"]); chart.setWindow(10, 900);
  expect(measured.calls).toBe(calls);
  chart.setSeries([{ id: "s0", label: labelOf(30), points: series[0].points }]);
  expect(right(el)).toBe(30 * 6 + 52 + 24);
});
it("keeps a collapsed or hidden auto legend out of the plot's way", () => {
  const { chart, el } = autoMeasured([labelOf(20)]);
  chart.setLegendCollapsed(true); expect(right(el)).toBe(24);
  chart.setLegendCollapsed(false); expect(right(el)).toBe(20 * 6 + 52 + 24);
  expect(right(autoMeasured([labelOf(20)], { legend: { show: false } }).el)).toBe(24);
});
it("aligns linked auto legends on the widest of the group, and re-syncs on change and destroy", () => {
  const narrow = autoMeasured([labelOf(10)], { link: "g" });
  const wide = autoMeasured([labelOf(30)], { link: "g" });
  expect([right(narrow.el), right(wide.el)]).toEqual([30 * 6 + 76, 30 * 6 + 76]);
  expect(columnOf(narrow.el)).toBe(columnOf(wide.el));
  wide.chart.setSeries([{ id: "s0", label: labelOf(20), points: series[0].points }]);
  expect([right(narrow.el), right(wide.el)]).toEqual([20 * 6 + 76, 20 * 6 + 76]);
  narrow.chart.setSeries([{ id: "s0", label: labelOf(25), points: series[0].points }]);
  expect([right(narrow.el), right(wide.el)]).toEqual([25 * 6 + 76, 25 * 6 + 76]);
  narrow.chart.destroy();
  expect(right(wide.el)).toBe(20 * 6 + 76);
  wide.chart.destroy();
});
it("leaves numeric-width charts of a link group at their own width", () => {
  const fixed = autoMeasured([labelOf(40)], { link: "h", legend: { width: 300 } });
  const sized = autoMeasured([labelOf(10)], { link: "h" });
  expect([right(fixed.el), right(sized.el)]).toEqual([324, 10 * 6 + 76]);
  fixed.chart.destroy(); sized.chart.destroy();
});
it("does not link legends of other groups or unlinked charts", () => {
  const a = autoMeasured([labelOf(30)], { link: "one" });
  const b = autoMeasured([labelOf(10)], { link: "two" });
  const c = autoMeasured([labelOf(12)]);
  expect([right(a.el), right(b.el), right(c.el)]).toEqual([30 * 6 + 76, 10 * 6 + 76, 12 * 6 + 76]);
  a.chart.destroy(); b.chart.destroy(); c.chart.destroy();
});
