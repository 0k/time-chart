import { describe, expect, it } from "vitest";
import { calendarGuides, markerAlpha } from "../src/calendar";

const day = 86_400_000;
const at = (y: number, m: number, d: number) => new Date(y, m, d).getTime();
const guides = (start: number, end: number, width = 1000) => calendarGuides(start, end, width, -1, "en-US");

describe("calendar specification", () => {
  it("fades from 3px to 50px", () => {
    expect([2.9, 3, 50].map(px => markerAlpha(1, 1, px))).toEqual([0, 0, 1]);
  });
  it("hides overlapping day labels and shows separated ones", () => {
    expect(guides(at(2026, 0, 2), at(2026, 0, 3), 22 * 1.08 - 0.01).lines.filter(g => g.tier === "day").every(g => g.label === null)).toBe(true);
    expect(guides(at(2026, 0, 2), at(2026, 0, 3), 44).lines.find(g => g.tier === "day")?.label).toBe("Fri");
  });
  it("flags Monday", () => expect(guides(at(2026, 0, 5), at(2026, 0, 6)).lines.find(g => g.tier === "day")?.monday).toBe(true));
  it("bounds weekends by local Saturday and Monday", () => {
    expect(guides(at(2026, 2, 28), at(2026, 2, 30)).bands[0]).toMatchObject({ start: at(2026, 2, 28), end: at(2026, 2, 30) });
  });
  it("keeps January label while the year owns the line", () => {
    const lines = guides(at(2026, 0, 1), at(2026, 0, 2)).lines;
    expect(lines.find(g => g.tier === "month")).toMatchObject({ hidden: true, lineAlpha: 0, label: "Jan" });
    expect(lines.find(g => g.tier === "year")?.label).toBe("2026");
  });
  it("includes now only inside the window", () => {
    expect(calendarGuides(0, day, 1000, day / 2).lines.some(g => g.tier === "now")).toBe(true);
    expect(calendarGuides(0, day, 1000, day + 1).lines.some(g => g.tier === "now")).toBe(false);
  });
  it("caps each tier at 400", () => {
    const lines = guides(at(2026, 0, 1), at(3026, 0, 1), 1e9).lines;
    for (const tier of ["day", "month", "year"]) expect(lines.filter(g => g.tier === tier)).toHaveLength(400);
  });
  it.each([[2, 29, 23], [9, 25, 25]])("uses local midnights across DST month %i", (month, date, hours) => {
    const lines = guides(at(2026, month, date), at(2026, month, date + 1)).lines.filter(g => g.tier === "day");
    expect(lines.map(g => new Date(g.t).getHours())).toEqual([0, 0]);
    expect(lines[1].t - lines[0].t).toBe(hours * 3_600_000);
  });
  it("formats short labels using the chosen locale", () => {
    expect(calendarGuides(at(2026, 0, 5), at(2026, 0, 6), 1000, -1, "fr-FR").lines.find(g => g.tier === "day")?.label).toBe("lun.");
  });
  it("returns no guides for invalid geometry", () => expect(calendarGuides(1, 0, 0, 0)).toEqual({ lines: [], bands: [] }));
});
