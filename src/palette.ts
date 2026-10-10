export const palettes = {
  light: {
    axisLine: "#9aa1ac", axisLabel: "#4b5563", axisName: "#4b5563", splitLine: "#eef1f5",
    tooltipBg: "rgba(255,255,255,0.97)", tooltipBorder: "#d0d5dd", tooltipText: "#1c2024",
    legendText: "#1c2024", legendInactive: "#c4c9d1", dayLine: "#444444", mondayLine: "#111111", dayLabel: "#666666",
    monthLine: "#999999", monthLabel: "#777777", yearLine: "#666666", yearLabel: "#555555",
    hatch: "rgba(80,80,100,0.30)", nowLine: "#2563eb", nowLabel: "#2563eb", bandAlpha: 0.18,
  },
  dark: {
    axisLine: "#565d68", axisLabel: "#aeb4bd", axisName: "#aeb4bd", splitLine: "#2a2f38",
    tooltipBg: "rgba(29,32,39,0.97)", tooltipBorder: "#3d434e", tooltipText: "#e6e8eb",
    legendText: "#d7dade", legendInactive: "#4a505a", dayLine: "#b9bec7", mondayLine: "#e8ebef", dayLabel: "#a5abb4",
    monthLine: "#8a9099", monthLabel: "#a5abb4", yearLine: "#9aa1ac", yearLabel: "#c2c7cf",
    hatch: "rgba(190,195,215,0.30)", nowLine: "#3b82f6", nowLabel: "#5a97f7", bandAlpha: 0.18,
  },
};
export type Palette = typeof palettes.light;
const query = "(prefers-color-scheme: dark)";
export function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}
export function onSchemeChange(cb: (dark: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(query);
  const listener = (event: MediaQueryListEvent) => cb(event.matches);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }
  media.addListener(listener);
  return () => media.removeListener(listener);
}
