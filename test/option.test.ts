import { expect, it } from "vitest";
import { buildOption, normalizeState } from "../src/option";

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
  expect(o.legend.data).toEqual(["a", "b"]); expect(o.legend.formatter("b")).toBe("Alpha");
});
it("applies highlight proportions and collapse insets", () => {
  const state = normalizeState({ series }); state.highlight = new Set(); state.legendCollapsed = true;
  const o = buildOption(state); expect("lineStyle" in o.series[0] && o.series[0].lineStyle).toMatchObject({ width: 0.5, opacity: 0.7 }); expect(o.grid.right).toBe(24);
});
