import { expect, it } from "vitest";
import { groupColors } from "../src/colors";

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const h = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return ((h / 6) % 1 + 1) % 1;
};
it("is deterministic for an input set regardless of order", () => {
  const items = [{ id: "a", group: "g" }, { id: "b", group: "g" }, { id: "c" }];
  expect(groupColors(items)).toEqual(groupColors([...items].reverse()));
});
it("varies grouped hues by at most three percent around their base", () => {
  const colors = groupColors([{ id: "a", group: "g" }, { id: "b", group: "g" }]);
  for (const color of colors.values()) { const delta = Math.abs(hue(color) - 0.02); expect(Math.min(delta, 1 - delta)).toBeLessThan(0.032); }
});
it("assigns distinct hues to different and ungrouped items", () => {
  expect(new Set(groupColors([{ id: "a" }, { id: "b" }, { id: "c", group: "g" }]).values()).size).toBe(3);
});
