export type Point = [number, number | null];

export interface TimeSeries {
  id: string;
  label: string;
  group?: string;
  points: Point[];
  min?: (number | null)[];
  max?: (number | null)[];
  stack?: boolean;
  color?: string;
  dash?: "solid" | "dashed" | "dotted";
  width?: number;
  fill?: number;
  band?: { pattern?: "solid" | "hatch"; opacity?: number };
  line?: boolean;
}

export interface TimeWindow { start: number; end: number }

export interface TimeChartOptions {
  series: TimeSeries[];
  formatValue?: (value: number) => string;
  formatTime?: (timeMs: number) => string;
  yAxis?: { min?: number | "auto"; max?: number | "data" | "auto"; name?: string; interval?: number; minorInterval?: number };
  window?: TimeWindow;
  tooltip?: "axis" | "item";
  legend?: { show?: boolean; collapsed?: boolean; width?: number | "auto"; maxWidth?: number };
  /** User zoom/pan and hover are linked by time. */
  link?: string;
  /** Debounced 150ms after user zoom/pan, including linked peers; not setWindow. */
  onWindowChange?: (start: number, end: number) => void;
  onLegendToggle?: (id: string, visible: boolean) => void;
  locale?: string;
  theme?: "auto" | "light" | "dark";
}

export interface TimeChart {
  setSeries(series: TimeSeries[]): void;
  setWindow(start: number, end: number): void;
  getWindow(): TimeWindow;
  setHidden(ids: Iterable<string>): void;
  highlight(ids: Iterable<string> | null): void;
  setLegendCollapsed(collapsed: boolean): void;
  resize(): void;
  destroy(): void;
}
