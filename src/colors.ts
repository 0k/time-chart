export interface ColorItem { id: string; group?: string }

function hlsValue(m1: number, m2: number, hue: number): number {
  hue = ((hue % 1) + 1) % 1;
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}

export function groupColors(items: ColorItem[]): Map<string, string> {
  const groups = new Map<string, ColorItem[]>();
  for (const item of items) {
    // Prefixes prevent an ungrouped id from colliding with an explicit group.
    const key = item.group === undefined ? `id:${item.id}` : `group:${item.group}`;
    const members = groups.get(key) ?? [];
    members.push(item); groups.set(key, members);
  }
  const colors = new Map<string, string>();
  [...groups.keys()].sort().forEach((group, index) => {
    const members = groups.get(group)!;
    members.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const base = index / groups.size + 0.02;
    members.forEach((item, i) => {
      const t = members.length === 1 ? 0 : i / (members.length - 1) - 0.5;
      const h = base + t * 0.06, s = 0.65 + t * 0.25, l = 0.48 + t * 0.18;
      const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
      const channels = [h + 1 / 3, h, h - 1 / 3].map(v => Math.round(hlsValue(m1, m2, v) * 255).toString(16).padStart(2, "0"));
      colors.set(item.id, `#${channels.join("")}`);
    });
  });
  return colors;
}
