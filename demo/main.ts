import { getInstanceByDom, type EChartsType } from "echarts/core";
import { createTimeChart, type TimeChart, type TimeSeries } from "../src/index";

const DAY = 86_400_000;
const now = Date.now();
const start = now - 30 * DAY;
const step = 120_000;
const times = Array.from({ length: Math.floor((now - start) / step) + 1 }, (_, i) => start + i * step);
const waves = (i: number, j: number) => 1.3 + 0.35 * Math.sin(i / 290 + j) + 0.2 * Math.cos(i / 93 + j * 2);
const stacked: TimeSeries[] = Array.from({ length: 14 }, (_, j) => ({
  id: `component-${j}`, label: `Component ${String(j + 1).padStart(2, "0")} / deterministic telemetry`, group: `group-${Math.floor(j / 3)}`,
  stack: true, points: times.map((t, i) => [t, Math.round(waves(i, j) * (j + 1) * 1024 * 1024)]),
}));
const banded: TimeSeries[] = [0, 1, 2].map(j => ({
  id: `observation-${j}`, label: `Observation ${j + 1}`, points: times.map((t, i) => [t, waves(i, j) * (j + 1)]),
  min: times.map((_, i) => waves(i, j) * (j + 1) - 0.3), max: times.map((_, i) => waves(i, j) * (j + 1) + 0.3),
}));
const gaps: TimeSeries[] = [0, 1].map(j => ({
  id: `signal-${j}`, label: `Signal ${j + 1} / missing intervals`,
  points: times.map((t, i) => [t, i % 2500 > 1600 ? null : waves(i, j) * (j + 1)]),
}));
const elements = ["stacked", "bands", "gaps"].map(id => {
  const el = document.getElementById(id); if (!el) throw new Error(`Missing demo element ${id}`); return el;
});
let callbackCount = 0;
const charts = [stacked, banded, gaps].map((series, i) => createTimeChart(elements[i], {
  series, link: "demo", locale: "en-GB", legend: { width: 280 }, yAxis: { max: "data", name: i === 0 ? "Bytes" : "Value" },
  formatValue: i === 0 ? v => `${(v / 1024 / 1024).toFixed(1)} MiB` : v => v.toFixed(2),
  onWindowChange: (a, b) => { callbackCount++; document.querySelector("output")!.textContent = `${new Date(a).toLocaleString()} — ${new Date(b).toLocaleString()}`; },
}));

function setRange(days: number) { for (const chart of charts) chart.setWindow(now - days * DAY + DAY / 2, now + DAY / 2); }
document.getElementById("week")!.onclick = () => setRange(6);
document.getElementById("month")!.onclick = () => setRange(30);
document.getElementById("year")!.onclick = () => setRange(365);
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-collapse]"))) button.onclick = () => {
  const collapsed = button.getAttribute("aria-expanded") === "true";
  charts[Number(button.dataset.collapse)].setLegendCollapsed(collapsed);
  button.setAttribute("aria-expanded", String(!collapsed)); button.textContent = collapsed ? "Expand legend" : "Collapse legend";
};

declare global {
  interface Window {
    __charts: TimeChart[];
    __instances: EChartsType[];
    __callbackCount: () => number;
    __legendTarget: (index: number, id: string) => { x: number; y: number };
  }
}
window.__charts = charts;
window.__instances = elements.map(el => { const instance = getInstanceByDom(el); if (!instance) throw new Error("Demo chart did not initialize"); return instance; });
window.__callbackCount = () => callbackCount;
// Canvas legends have no DOM nodes; return the actual rendered item's geometry.
window.__legendTarget = (index, id) => {
  const instance = window.__instances[index];
  const legend = instance.getOption().legend as { data: (string | { name: string })[] }[];
  const dataIndex = legend[0].data.findIndex(entry => (typeof entry === "string" ? entry : entry.name) === id);
  const item = instance.getZr().storage.getDisplayList().find(display => {
    if (display.silent) return false;
    for (let element: typeof display | typeof display.parent = display; element; element = element.parent) {
      if ("__legendDataIndex" in element && element.__legendDataIndex === dataIndex) return true;
    }
    return false;
  });
  if (!item) throw new Error(`Rendered legend item not found: ${id}`);
  const rect = item.getBoundingRect().clone(); rect.applyTransform(item.transform);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};
window.addEventListener("pagehide", () => charts.forEach(chart => chart.destroy()), { once: true });
