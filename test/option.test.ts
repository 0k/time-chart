// @vitest-environment node
import { expect, it } from "vitest";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { buildGuides, buildOption, normalizeState } from "../src/option";
import type { TimeChartOptions } from "../src/types";
import { palettes } from "../src/palette";

echarts.use([LineChart, GridComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, SVGRenderer]);

const series = [{ id: "a", label: "Alpha", points: [[0, 2], [86_400_000, 10]] as [number, number | null][] }];
it("pads data by twice the span and initially frames its extent", () => {
  const o = buildOption(normalizeState({ series }));
  expect([o.xAxis.min, o.xAxis.max]).toEqual([-172_800_000, 259_200_000]);
  expect(o.dataZoom[0]).toMatchObject({ startValue: 0, endValue: 86_400_000, filterMode: "none", xAxisIndex: 0 });
});
it("takes the fixed data ceiling from all data including hidden series", () => {
  const state = normalizeState({ series, yAxis: { max: "data" } }); state.hidden.add("a");
  expect(buildOption(state).yAxis.max).toBe(12);
});
it("adds stack and areaStyle to stacked series", () => expect(buildOption(normalizeState({ series: [{ ...series[0], stack: true }] })).series[0]).toMatchObject({ stack: "__stack__", areaStyle: { opacity: 0.6 } }));
it("excludes band helpers from legend and tooltip and hides them with the owner", () => {
  const state = normalizeState({ series: [{ ...series[0], min: [1, 3], max: [4, 12] }] });
  const o = buildOption(state);
  expect(o.legend.data).toEqual(["a"]);
  expect(o.series.filter(s => s.id.includes("band"))).toHaveLength(2);
  expect(o.series.filter(s => s.id.includes("band")).every(s => s.tooltip?.show === false)).toBe(true);
  state.hidden.add("a"); expect(buildOption(state).series.filter(s => s.id.includes("band")).every(s => s.data.length === 0)).toBe(true);
});
it("preserves null gaps", () => expect(buildOption(normalizeState({ series: [{ ...series[0], points: [[0, null]] }] })).series[0]).toMatchObject({ data: [[0, null]], connectNulls: false }));
it("defaults nonnegative y minimum to zero but negative data to auto", () => {
  expect(buildOption(normalizeState({ series })).yAxis.min).toBe(0);
  expect(buildOption(normalizeState({ series: [{ ...series[0], points: [[0, -1]] }] })).yAxis.min).toBeNull();
});
it("sorts and formats visible tooltip rows and escapes host strings", () => {
  const state = normalizeState({ series: [...series, { id: "b", label: "<Beta>", points: [[0, 20]] }], formatValue: v => `value ${v}`, formatTime: () => "time" });
  const text = buildOption(state).tooltip.formatter([{ seriesName: "a", value: [0, 2] }, { seriesName: "b", value: [0, 20] }]);
  expect(text.indexOf("&lt;Beta&gt;")).toBeLessThan(text.indexOf("Alpha")); expect(text).toContain("value 20"); expect(text).toContain("time");
});
it("uses ids in legend so duplicate display labels remain independent", () => {
  const o = buildOption(normalizeState({ series: [series[0], { ...series[0], id: "b" }] }));
  expect(o.legend.data).toEqual(["a", "b"]);
});
it("applies highlight proportions and collapse insets", () => {
  const state = normalizeState({ series }); state.highlight = new Set(); state.legendCollapsed = true;
  const o = buildOption(state); expect("lineStyle" in o.series[0] && o.series[0].lineStyle).toMatchObject({ width: 0.5, opacity: 0.7 }); expect(o.grid.right).toBe(24);
});
it("never draws the paging canvas legend, only uses it to hide deselected series", () => {
  const state = normalizeState({ series }); state.hidden.add("a");
  expect(buildOption(state).legend).toEqual({ show: false, data: ["a"], selected: { a: false } });
});

it.each(["solid", "dashed", "dotted"] as const)("draws %s lines", dash => {
  const o = buildOption(normalizeState({ series: [{ ...series[0], dash }] }));
  expect(o.series[0]).toMatchObject({ lineStyle: { type: dash } });
});
it("scales highlight and dim widths relative to the base", () => {
  const state = normalizeState({ series: [{ ...series[0], width: 3 }] });
  expect(buildOption(state).series[0]).toMatchObject({ lineStyle: { width: 3 } });
  state.highlight = new Set(["a"]);
  expect(buildOption(state).series[0]).toMatchObject({ lineStyle: { width: 6 } });
  state.highlight = new Set();
  expect(buildOption(state).series[0]).toMatchObject({ lineStyle: { width: 1.5 } });
  state.highlight = null;
  expect(buildOption(state).series[0]).toMatchObject({ lineStyle: { width: 3 } });
});
it("fills to the axis bottom without stacking, including negative data", () => {
  const o = buildOption(normalizeState({ series: [{ ...series[0], points: [[0, -2]], fill: 0.2 }] }));
  expect(o.series[0]).toMatchObject({ stack: undefined, areaStyle: { origin: "start", opacity: 0.2 } });
});
it.each([undefined, {}, { pattern: "solid" as const }, { opacity: 0.4 }])("preserves solid bands or applies their opacity: %j", band => {
  const o = buildOption(normalizeState({ series: [{ ...series[0], min: [1, 3], max: [4, 12], band }] }));
  expect(o.series[1]).toHaveProperty("areaStyle", { color: "#ca3e2b", opacity: 0 });
  expect(o.series[2]).toHaveProperty("areaStyle", { color: "#ca3e2b", opacity: band?.opacity ?? 0.18 });
});
it.each([undefined, 0.5])("hatches only the upper band area in the series color and preserves gaps (opacity %s)", opacity => {
  const o = buildOption(normalizeState({ series: [{ ...series[0], color: "red", min: [1, null], max: [4, null], band: { pattern: "hatch", opacity } }] }));
  expect(o.series[1].data).toEqual([[0, 1], [86_400_000, null]]);
  expect(o.series[2].data).toEqual([[0, 3], [86_400_000, null]]);
  expect(o.series[1]).toMatchObject({ areaStyle: { decal: undefined } });
  expect(o.series[2]).toMatchObject({ areaStyle: { color: "transparent", opacity: opacity ?? 0.18, decal: { color: "red", rotation: Math.PI / 4 } } });
});
// Real ECharts, not a mock: after the first render, the chart replaces its
// series with `replaceMerge`, which deep-merges a series keeping its id.
// Dropping a style must then draw exactly what a fresh chart draws (up to
// the per-instance ``zr<N>-`` prefix of SVG class names and ids).
function svgOf(...updates: TimeChartOptions[]) {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 600, height: 300 });
  updates.forEach((options, i) => chart.setOption(buildOption(normalizeState(options, 600, 300, 0)) as unknown as echarts.EChartsCoreOption, i ? { replaceMerge: ["series"] } : { notMerge: true }));
  const svg = chart.renderToSVGString().replace(/zr\d+-[\w-]+/g, "zr"); chart.dispose(); return svg;
}
it("stops drawing a dash, a hatch or a fill once a later update drops it", () => {
  const plain = { ...series[0], min: [1, 3], max: [4, 12] };
  const styled = { ...plain, dash: "dashed" as const, fill: 0.3, band: { pattern: "hatch" as const } };
  const fresh = svgOf({ series: [plain] });
  expect(svgOf({ series: [styled] })).toMatch(/stroke-dasharray/);
  expect(svgOf({ series: [styled] })).toMatch(/<pattern/);
  expect(svgOf({ series: [styled] }, { series: [plain] })).toBe(fresh);
});
it("stacks from zero once a filled series turns stacked, even with a negative axis", () => {
  const filled = { series: [{ ...series[0], fill: 0.3 }], yAxis: { min: -5 } };
  const stacked = { series: [{ ...series[0], stack: true }], yAxis: { min: -5 } };
  expect(svgOf(filled, stacked)).toBe(svgOf(stacked));
});
// Guides, legend and linked alignment are placed in pixels from the grid
// insets, so ECharts must never shrink the plot to fit its axis labels.
it("draws the plot exactly inside the grid insets, even with wide axis labels", () => {
  const state = normalizeState({ series, yAxis: { name: "a long axis name" }, formatValue: v => `${v} ${"x".repeat(40)}` }, 600, 300, 0);
  const o = buildOption(state);
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 600, height: 300 });
  chart.setOption(o as unknown as echarts.EChartsCoreOption);
  const corner = (t: number, v: number | null) => chart.convertToPixel({ gridIndex: 0 }, [t, v]) as number[];
  expect([...corner(o.xAxis.min, o.yAxis.max), ...corner(o.xAxis.max, o.yAxis.min)].map(px => Math.round(px * 1e6) / 1e6)).toEqual([64, 64, 600 - o.grid.right, 300 - 44]);
  chart.dispose();
});
it("draws the y-axis name 46px left of the axis line, however wide the labels", () => {
  const state = normalizeState({ series, yAxis: { name: "Volts" }, formatValue: v => `${v} ${"x".repeat(12)}` }, 600, 300, 0);
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 600, height: 300 });
  chart.setOption(buildOption(state) as unknown as echarts.EChartsCoreOption);
  const name = chart.renderToSVGString().replace(/\n/g, " ").match(/<text[^<]*transform="matrix\(0,-1,1,0,([-\d.]+),[-\d.]+\)"[^<]*>Volts<\/text>/);
  chart.dispose();
  expect(Number(name?.[1])).toBe(64 - 46);
});
it("keeps line-less fills and bands in the legend but not the tooltip", () => {
  const state = normalizeState({ series: [{ ...series[0], line: false, fill: 0.2, min: [1, 3], max: [4, 12] }] });
  const o = buildOption(state);
  expect(o.series[0]).toMatchObject({ lineStyle: { width: 0, opacity: 0 }, tooltip: { show: false }, areaStyle: { origin: "start", opacity: 0.2 } });
  expect(o.legend.data).toEqual(["a"]);
  expect(o.tooltip.formatter([{ seriesName: "a", value: [0, 2] }])).toBe("");
  state.hidden.add("a");
  const hidden = buildOption(state);
  expect(hidden.legend.selected.a).toBe(false);
  expect(hidden.series.slice(1, 3).every(s => s.data.length === 0)).toBe(true);
});
it.each([0, -1, NaN, Infinity, -Infinity])("rejects invalid width %s with the series id", width => {
  expect(() => normalizeState({ series: [{ ...series[0], width }] })).toThrow(/width.*a/i);
});
it.each([0, -0.1, 1.1, NaN, Infinity, -Infinity])("rejects invalid opacity %s at the series boundary", opacity => {
  expect(() => normalizeState({ series: [{ ...series[0], fill: opacity }] })).toThrow(/fill.*a/i);
  expect(() => normalizeState({ series: [{ ...series[0], min: [1, 3], max: [4, 12], band: { opacity } }] })).toThrow(/band.*opacity.*a/i);
});
it("accepts the opacity upper bound", () => {
  expect(() => normalizeState({ series: [{ ...series[0], fill: 1, min: [1, 3], max: [4, 12], band: { opacity: 1 } }] })).not.toThrow();
});
it("rejects fill combined with stacking", () => {
  expect(() => normalizeState({ series: [{ ...series[0], fill: 0.1, stack: true }] })).toThrow(/fill.*stack.*a/i);
});
it("rejects band styling without bounds", () => {
  expect(() => normalizeState({ series: [{ ...series[0], band: {} }] })).toThrow(/band.*min.*max.*a/i);
});
it("sets major ticks without enabling minor ticks", () => {
  const o = buildOption(normalizeState({ series, yAxis: { interval: 1 } }));
  expect(o.yAxis).toHaveProperty("interval", 1);
  expect(o.yAxis).not.toHaveProperty("minorTick");
});
it.each([[1, 0.5, 2], [0.3, 0.1, 3], [99, 1, 99]])("subdivides %s ticks by %s", (interval, minorInterval, splitNumber) => {
  const o = buildOption(normalizeState({ series, yAxis: { interval, minorInterval } }));
  expect(o.yAxis).toMatchObject({ interval, minorTick: { show: true, splitNumber }, minorSplitLine: { show: true, lineStyle: { type: "dashed" } } });
});
it.each(["light", "dark"] as const)("draws minor ticks in the %s palette's axis color", scheme => {
  const state = normalizeState({ series, yAxis: { interval: 1, minorInterval: 0.5 } });
  state.palette = palettes[scheme];
  expect(buildOption(state).yAxis).toMatchObject({ minorTick: { lineStyle: { color: palettes[scheme].axisLine } } });
});
it.each([0, -1, NaN, Infinity, -Infinity])("rejects invalid major interval %s", interval => {
  expect(() => normalizeState({ series, yAxis: { interval } })).toThrow(/interval/i);
});
it.each([0, -1, NaN, Infinity, -Infinity, 1, 2, 0.3, 0.01])("rejects invalid minor subdivision %s", minorInterval => {
  expect(() => normalizeState({ series, yAxis: { interval: 1, minorInterval } })).toThrow(/minorInterval/);
});
it("requires an explicit major interval for minor ticks", () => {
  expect(() => normalizeState({ series, yAxis: { minorInterval: 0.5 } })).toThrow(/minorInterval/);
});
it("preserves the complete legacy option when new fields are omitted", () => {
  const state = normalizeState({ series, locale: "en-GB", formatValue: v => String(v), formatTime: () => "time" }, 1000, 400, 86_400_000);
  const p = state.palette, o = buildOption(state);
  expect(o).toEqual({
    animation: false, grid: { left: 64, top: 64, bottom: 44, right: 364, outerBoundsMode: "none" },
    xAxis: { type: "time", min: -172_800_000, max: 259_200_000, axisPointer: { show: true, snap: false, triggerTooltip: true }, axisLine: { lineStyle: { color: p.axisLine } }, axisLabel: { color: p.axisLabel, hideOverlap: true }, splitLine: { show: true, lineStyle: { color: p.splitLine } } },
    yAxis: { type: "value", min: 0, max: 12, name: "", nameLocation: "middle", nameGap: 46, nameMoveOverlap: false, nameTextStyle: { color: p.axisName }, axisLabel: { color: p.axisLabel, formatter: state.options.formatValue }, splitLine: { lineStyle: { color: p.splitLine } } },
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none", startValue: 0, endValue: 86_400_000, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false }],
    legend: { show: false, data: ["a"], selected: { a: true } },
    tooltip: { trigger: "axis", confine: true, backgroundColor: p.tooltipBg, borderColor: p.tooltipBorder, borderWidth: 1, textStyle: { color: p.tooltipText, fontSize: 12 }, formatter: expect.any(Function) },
    series: [{ id: "a", name: "a", type: "line", data: series[0].points, color: "#ca3e2b", showSymbol: false, connectNulls: false, stack: undefined, areaStyle: undefined, lineStyle: { color: "#ca3e2b", width: 1, opacity: 1, type: "solid" }, itemStyle: { color: "#ca3e2b", opacity: 1 }, emphasis: { disabled: true }, tooltip: { show: true }, z: 2 }, buildGuides(state)],
  });
  expect(o.tooltip.formatter({ seriesName: "a", value: [0, 2] })).toBe('<div>time</div><div><span style="color:#ca3e2b">●</span> Alpha: 2</div>');
});
const right = (legend: object) => buildOption(normalizeState({ series, legend } as Parameters<typeof normalizeState>[0])).grid.right;
it("keeps a numeric legend width exactly, unless an explicit maxWidth caps it", () => {
  expect(right({ width: 300 })).toBe(324);
  expect(right({ width: 300, maxWidth: 200 })).toBe(224);
  expect(right({ maxWidth: 200 })).toBe(224);
});
it("sizes an auto legend from the measured label width, a linked width and maxWidth", () => {
  const state = normalizeState({ series, legend: { width: "auto" } });
  state.legendLabelWidth = 100.2;
  expect(buildOption(state).grid.right).toBe(153 + 24);
  state.legendLinkedWidth = 200;
  expect(buildOption(state).grid.right).toBe(200 + 24);
  state.legendLinkedWidth = 500;
  expect(buildOption(state).grid.right).toBe(240 + 24);
});
it("lets an explicit maxWidth below 80 cap an auto legend, and cap a linked width per chart", () => {
  const state = normalizeState({ series, legend: { width: "auto", maxWidth: 40 } });
  state.legendLabelWidth = 100;
  expect(buildOption(state).grid.right).toBe(40 + 24);
  state.legendLinkedWidth = 200;
  expect(buildOption(state).grid.right).toBe(40 + 24);
});
it.each([0, -1, NaN, Infinity, "wide"])("rejects legend width %s", width => {
  expect(() => normalizeState({ series, legend: { width } } as Parameters<typeof normalizeState>[0])).toThrow(/legend width must be "auto" or a finite positive number/);
});
it.each([0, -1, NaN, Infinity, "240"])("rejects legend maxWidth %s", maxWidth => {
  expect(() => normalizeState({ series, legend: { maxWidth } } as Parameters<typeof normalizeState>[0])).toThrow(/legend maxWidth must be a finite positive number/);
});
