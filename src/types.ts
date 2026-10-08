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
}

export interface TimeWindow { start: number; end: number }

export interface TimeChartOptions {
  series: TimeSeries[];
  formatValue?: (value: number) => string;
  formatTime?: (timeMs: number) => string;
  yAxis?: { min?: number | "auto"; max?: number | "data" | "auto"; name?: string };
  window?: TimeWindow;
  tooltip?: "axis" | "item";
  legend?: { show?: boolean; collapsed?: boolean; width?: number };
  link?: string;
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
