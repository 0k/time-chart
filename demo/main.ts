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
const temperatureTimes = Array.from({ length: 289 }, (_, i) => now - 2 * DAY + i * DAY / 144);
const selected = temperatureTimes.map((_, i) => i % 144 >= 36 && i % 144 < 120 ? 20 : 16);
const current = temperatureTimes.map((_, i) => 18 + 2.5 * Math.sin(i * Math.PI / 72 - Math.PI / 2));
const temperature: TimeSeries[] = [
  { id: "confort", label: "confort", color: "yellow", fill: 0.1, points: temperatureTimes.map(t => [t, 21]) },
  { id: "reduit", label: "reduit", color: "blue", fill: 0.1, points: temperatureTimes.map(t => [t, 16]) },
  { id: "hors-gel", label: "hors-gel", color: "black", fill: 0.2, points: temperatureTimes.map(t => [t, 7]) },
  { id: "target", label: "target", color: "orange", dash: "dashed", width: 1, points: temperatureTimes.map((t, i) => [t, selected[i] + 0.6]) },
  { id: "selected", label: "selected", color: "red", dash: "dotted", width: 3, points: temperatureTimes.map((t, i) => [t, selected[i]]) },
  { id: "current", label: "current", color: "black", width: 3, points: temperatureTimes.map((t, i) => [t, current[i]]) },
  { id: "deficit", label: "current <= selected", color: "red", line: false, band: { pattern: "hatch", opacity: 0.8 },
    points: temperatureTimes.map((t, i) => [t, current[i] <= selected[i] ? current[i] : null]),
    min: current.map((v, i) => v <= selected[i] ? v : null), max: selected.map((v, i) => current[i] <= v ? v : null) },
  { id: "heating", label: "heating", color: "red", points: temperatureTimes.map((t, i) => [t, Math.max(selected[i] - current[i], 0)]) },
];
const elements = ["stacked", "bands", "gaps", "temperature"].map(id => {
  const el = document.getElementById(id); if (!el) throw new Error(`Missing demo element ${id}`); return el;
});
let callbackCount = 0;
const charts = [stacked, banded, gaps].map((series, i) => createTimeChart(elements[i], {
  series, link: "demo", locale: "en-GB", legend: { width: "auto" }, yAxis: { max: "data", name: i === 0 ? "Bytes" : "Value" },
  formatValue: i === 0 ? v => `${(v / 1024 / 1024).toFixed(1)} MiB` : v => v.toFixed(2),
  onWindowChange: (a, b) => { callbackCount++; document.querySelector("output")!.textContent = `${new Date(a).toLocaleString()} — ${new Date(b).toLocaleString()}`; },
}));
charts.push(createTimeChart(elements[3], {
  series: temperature, locale: "en-GB", legend: { width: "auto" },
  yAxis: { min: 0, max: 23, name: "Temperature (°C)", interval: 1, minorInterval: 0.5 },
  formatValue: v => v.toFixed(1),
}));

function setRange(days: number) { for (const chart of charts.slice(0, 3)) chart.setWindow(now - days * DAY + DAY / 2, now + DAY / 2); }
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
  }
}
window.__charts = charts;
window.__instances = elements.map(el => { const instance = getInstanceByDom(el); if (!instance) throw new Error("Demo chart did not initialize"); return instance; });
window.__callbackCount = () => callbackCount;
window.addEventListener("pagehide", () => charts.forEach(chart => chart.destroy()), { once: true });
