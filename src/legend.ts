import { GRID_BOTTOM, GRID_TOP, legendWidth, type NormalizedState } from "./option.js";

/**
 * HTML legend laid over the chart's right margin.  ECharts' own legend
 * lives on the canvas, so it can only page; this one scrolls natively and
 * spans exactly the plot's height.
 */
export interface Legend {
  render(state: NormalizedState): void;
  /** Width in px of the widest label, in the legend's own font. */
  measure(labels: string[]): number;
  destroy(): void;
}

const ROW = 14, SWATCH = 18;

export function createLegend(host: HTMLElement, onToggle: (id: string) => void): Legend {
  // The legend is positioned against the host.
  const position = getComputedStyle(host).position;
  if (position === "" || position === "static") host.style.position = "relative";
  const root = document.createElement("div");
  root.dataset.timeChartLegend = "";
  Object.assign(root.style, {
    position: "absolute", top: `${GRID_TOP}px`, bottom: `${GRID_BOTTOM}px`, right: "8px", zIndex: "1",
    // Overlay scrollbars (WebKitGTK, macOS) draw over the content: keep the
    // labels' ellipsis clear of them.
    overflowY: "auto", overscrollBehavior: "contain", paddingRight: "12px", display: "", boxSizing: "border-box",
    font: `11px/${ROW}px sans-serif`, userSelect: "none",
  });
  // Rows are kept by series id so re-renders keep the scroll position.
  const rows = new Map<string, HTMLElement>();
  function row(id: string): HTMLElement {
    const existing = rows.get(id);
    if (existing) return existing;
    const el = document.createElement("div"), swatch = document.createElement("span"), text = document.createElement("span");
    el.dataset.seriesId = id; el.setAttribute("role", "checkbox"); el.tabIndex = 0;
    Object.assign(el.style, { display: "flex", alignItems: "center", gap: "6px", height: `${ROW}px`, marginBottom: "6px", cursor: "pointer" });
    Object.assign(swatch.style, { flex: `0 0 ${SWATCH}px`, height: "10px", borderRadius: "3px" });
    Object.assign(text.style, { flex: "1 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    el.append(swatch, text);
    el.addEventListener("click", () => onToggle(id));
    el.addEventListener("keydown", event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onToggle(id); } });
    rows.set(id, el);
    return el;
  }
  host.append(root);
  let canvas: HTMLCanvasElement | undefined;
  return {
    measure(labels) {
      const style = getComputedStyle(root);
      const size = parseFloat(style.fontSize) || 11;
      const ctx = (canvas ??= document.createElement("canvas")).getContext("2d");
      // Without a canvas, estimate an average glyph at 0.6 em.
      if (!ctx) return Math.max(0, ...labels.map(label => label.length * size * 0.6));
      ctx.font = `${style.fontStyle || "normal"} ${style.fontWeight || "normal"} ${size}px ${style.fontFamily || "sans-serif"}`;
      return Math.max(0, ...labels.map(label => ctx.measureText(label).width));
    },
    render(state) {
      const shown = state.options.legend?.show !== false && !state.legendCollapsed;
      root.style.display = shown ? "" : "none";
      root.style.width = `${legendWidth(state) - 16}px`;
      root.style.color = state.palette.legendText;
      const ids = new Set(state.series.map(s => s.id));
      for (const [id, el] of rows) if (!ids.has(id)) { el.remove(); rows.delete(id); }
      const scroll = root.scrollTop;
      state.series.forEach((s, i) => {
        const el = row(s.id), visible = !state.hidden.has(s.id);
        const [swatch, text] = el.children as unknown as [HTMLElement, HTMLElement];
        el.title = s.label; text.textContent = s.label;
        el.setAttribute("aria-checked", String(visible));
        swatch.style.background = visible ? state.colors.get(s.id) ?? state.palette.legendText : state.palette.legendInactive;
        text.style.opacity = visible ? "1" : "0.5";
        if (root.children[i] !== el) root.insertBefore(el, root.children[i] ?? null);
      });
      root.scrollTop = scroll;
    },
    destroy() { root.remove(); rows.clear(); canvas = undefined; },
  };
}
