import { afterEach, expect, it, vi } from "vitest";
import { createTimeChart } from "../src/chart";

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  return { handlers, option: {} as Record<string, unknown>, disposed: false, observer: vi.fn(), disconnect: vi.fn(), remove: vi.fn(), media: undefined as ((event: { matches: boolean }) => void) | undefined };
});
vi.mock("echarts/core", () => ({
  use: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  init: () => ({
    setOption: vi.fn((option: Record<string, unknown>) => { mock.option = { ...mock.option, ...option }; }),
    getOption: () => mock.option, getWidth: () => 1000, getHeight: () => 400,
    on: (name: string, cb: (e: unknown) => void) => mock.handlers.set(name, cb),
    off: (name: string) => mock.handlers.delete(name), resize: vi.fn(),
    dispose: () => { mock.disposed = true; },
  }),
}));

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
afterEach(() => { host?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); mock.handlers.clear(); mock.option = {}; vi.restoreAllMocks(); vi.clearAllMocks(); });
it("preserves window, hidden ids and existing colors across setSeries", () => {
  const chart = create(); chart.setWindow(100, 900); chart.setHidden(["a"]);
  const before = mock.option.series; chart.setSeries([...series, { ...series[0], id: "b" }]);
  expect(chart.getWindow()).toEqual({ start: 100, end: 900 });
  const defs = mock.option.series as { id: string; color?: string }[];
  expect(defs[0].color).toBe((before as typeof defs)[0].color);
  expect(mock.option.legend).toMatchObject({ selected: { a: false } }); chart.destroy();
});
it("never calls the window callback for programmatic setWindow", () => {
  const onWindowChange = vi.fn(), chart = create({ onWindowChange }); chart.setWindow(100, 900); vi.advanceTimersByTime(500);
  expect(onWindowChange).not.toHaveBeenCalled(); chart.destroy();
});
it("debounces user windows at 150ms and guide updates at 100ms", () => {
  const onWindowChange = vi.fn(), chart = create({ onWindowChange });
  mock.option.dataZoom = [{ startValue: 100, endValue: 900 }]; mock.handlers.get("datazoom")?.({});
  vi.advanceTimersByTime(149); expect(onWindowChange).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(onWindowChange).toHaveBeenCalledWith(100, 900); chart.destroy();
});
it("refreshes now without moving the window", () => {
  const chart = create(); chart.setWindow(100, 900); vi.advanceTimersByTime(60_000);
  expect(chart.getWindow()).toEqual({ start: 100, end: 900 }); chart.destroy();
});
it("follows live theme and tears down timers, observers and listeners", () => {
  const chart = create(); mock.media?.({ matches: true }); expect(mock.option.tooltip).toMatchObject({ backgroundColor: "rgba(29,32,39,0.97)" });
  chart.destroy(); chart.destroy(); expect(vi.getTimerCount()).toBe(0); expect(mock.disconnect).toHaveBeenCalledOnce(); expect(mock.remove).toHaveBeenCalledOnce(); expect(mock.disposed).toBe(true);
});
it("lists every series in a legend that scrolls, spanning exactly the plot height", () => {
  const chart = create({ series: two, legend: { width: 300 } });
  expect(rows().map(r => [r.dataset.seriesId, r.textContent, r.title])).toEqual([["a", "Alpha", "Alpha"], ["b", "Beta", "Beta"]]);
  expect(legend().style).toMatchObject({ position: "absolute", top: "64px", bottom: "44px", right: "8px", width: "284px", overflowY: "auto", overscrollBehavior: "contain", paddingRight: "12px" });
  expect(host.style.position).toBe("relative");
  expect(mock.option.legend).toMatchObject({ show: false }); chart.destroy();
});
it("toggles a series on click, keeps the scroll position, and reports it", () => {
  const onLegendToggle = vi.fn(), chart = create({ series: two, onLegendToggle });
  legend().scrollTop = 30; rows()[1].click();
  expect(mock.option.legend).toMatchObject({ selected: { a: true, b: false } });
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
