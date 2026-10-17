/** Browser-safe published-map DTO and pure interaction math. No server or DB imports. */
export const plotStatuses = [
  "available",
  "reserved",
  "booked",
  "sold",
  "resale",
  "blocked",
] as const;
export type PlotStatus = (typeof plotStatuses)[number];
export type Point = [number, number];
export type Box = [number, number, number, number];
export const statusPresentation: Record<
  PlotStatus,
  { label: string; color: string; mark: string }
> = {
  available: { label: "Available", color: "#009E73", mark: "A" },
  reserved: { label: "Reserved", color: "#E69F00", mark: "R" },
  booked: { label: "Booked", color: "#E69F00", mark: "B" },
  sold: { label: "Sold", color: "#D55E00", mark: "S" },
  resale: { label: "Resale", color: "#0072B2", mark: "RS" },
  blocked: { label: "Blocked", color: "#64748B", mark: "X" },
};
export type ViewerPlot = {
  id: string;
  elementId: string;
  number: string;
  block: string | null;
  phase: string | null;
  street: string | null;
  status: PlotStatus;
  rings: Point[][];
  fillRule: "evenodd" | "nonzero";
  centroid: Point;
  bbox: Box;
  area: {
    value: number;
    unit: string;
    source: "official" | "calculated";
    filterValue: number;
  };
  dimensions: { text: string; source: "official" | "calculated" } | null;
  facing: string | null;
  corner: boolean | null;
  category: string | null;
  priceMinor: number | null;
  currency: string;
};
export type PublishedMap = {
  id: string;
  version: number;
  publishedAt: string;
  loadedAt: string;
  projectId: string;
  projectName: string;
  viewBox: Box;
  areaUnit: string;
  svg: string;
  plots: ViewerPlot[];
};
export type MapFilters = {
  status: string;
  block: string;
  minArea: string;
  maxArea: string;
  minPrice: string;
  maxPrice: string;
  facing: string;
  corner: string;
};
export const emptyMapFilters: MapFilters = {
  status: "",
  block: "",
  minArea: "",
  maxArea: "",
  minPrice: "",
  maxPrice: "",
  facing: "",
  corner: "",
};
export function matchesMapFilters(p: ViewerPlot, f: MapFilters) {
  if (
    (f.status && p.status !== f.status) ||
    (f.block && p.block !== f.block) ||
    (f.facing && p.facing !== f.facing)
  )
    return false;
  if (f.corner && (p.corner === null || p.corner !== (f.corner === "yes")))
    return false;
  if (
    (f.minArea !== "" && p.area.filterValue < Number(f.minArea)) ||
    (f.maxArea !== "" && p.area.filterValue > Number(f.maxArea))
  )
    return false;
  // UI price input uses major units, DTO/storage uses integer minor units.
  if ((f.minPrice !== "" || f.maxPrice !== "") && p.priceMinor === null)
    return false;
  if (
    (f.minPrice !== "" &&
      p.priceMinor! < Math.round(Number(f.minPrice) * 100)) ||
    (f.maxPrice !== "" && p.priceMinor! > Math.round(Number(f.maxPrice) * 100))
  )
    return false;
  return true;
}
export function validateMapFilters(f: MapFilters) {
  for (const k of ["minArea", "maxArea", "minPrice", "maxPrice"] as const)
    if (
      f[k] !== "" &&
      (!Number.isFinite(Number(f[k])) ||
        Number(f[k]) < 0 ||
        Number(f[k]) > 1e15)
    )
      return "Use finite, nonnegative range values.";
  if (
    f.minArea !== "" &&
    f.maxArea !== "" &&
    Number(f.minArea) > Number(f.maxArea)
  )
    return "Minimum size cannot exceed maximum size.";
  if (
    f.minPrice !== "" &&
    f.maxPrice !== "" &&
    Number(f.minPrice) > Number(f.maxPrice)
  )
    return "Minimum price cannot exceed maximum price.";
  return null;
}
export function statusCounts(plots: ViewerPlot[]) {
  const counts: Record<PlotStatus, number> = {
    available: 0,
    reserved: 0,
    booked: 0,
    sold: 0,
    resale: 0,
    blocked: 0,
  };
  for (const p of plots) counts[p.status]++;
  return counts;
}
export function plotAriaLabel(p: ViewerPlot) {
  return `Plot ${p.number}, ${Number(p.area.value.toFixed(3))} ${p.area.unit} (${p.area.source}), ${statusPresentation[p.status].label}${p.block ? ", block " + p.block : ""}`;
}
export function findPlot(plots: ViewerPlot[], query: string) {
  const q = query.trim().toUpperCase();
  return plots.find((p) => p.number.toUpperCase() === q) || null;
}
export function pathFor(rings: Point[][]) {
  return rings
    .map((r) => "M" + r.map((p) => p.join(" ")).join("L") + "Z")
    .join(" ");
}
export type Camera = { scale: number; x: number; y: number };
export const fitCamera: Camera = { scale: 1, x: 0, y: 0 };
export const clampScale = (scale: number) => Math.max(1, Math.min(32, scale));
export function zoomAt(v: Camera, scale: number, point: Point): Camera {
  const next = clampScale(scale),
    factor = next / v.scale;
  return {
    scale: next,
    x: point[0] - (point[0] - v.x) * factor,
    y: point[1] - (point[1] - v.y) * factor,
  };
}
export function constrainCamera(
  v: Camera,
  width: number,
  height: number,
): Camera {
  const scale = clampScale(v.scale);
  return {
    scale,
    x: Math.max(32 - width * scale, Math.min(width - 32, v.x)),
    y: Math.max(32 - height * scale, Math.min(height - 32, v.y)),
  };
}
export function cameraForPlot(
  box: Box,
  viewBox: Box,
  width: number,
  height: number,
): Camera {
  if (width <= 0 || height <= 0) return { ...fitCamera };
  const k = Math.min(width / viewBox[2], height / viewBox[3]),
    ox = (width - viewBox[2] * k) / 2 - viewBox[0] * k,
    oy = (height - viewBox[3] * k) / 2 - viewBox[1] * k;
  const scale = clampScale(
    Math.min(
      Math.max(1, width - 80) / Math.max(1, (box[2] - box[0]) * k),
      Math.max(1, height - 80) / Math.max(1, (box[3] - box[1]) * k),
    ),
  );
  return constrainCamera(
    {
      scale,
      x: width / 2 - (((box[0] + box[2]) / 2) * k + ox) * scale,
      y: height / 2 - (((box[1] + box[3]) / 2) * k + oy) * scale,
    },
    width,
    height,
  );
}
export function tooltipPosition(
  point: Point,
  size: Point,
  viewport: Point,
): Point {
  const left =
    point[0] + 16 + size[0] > viewport[0] - 12
      ? point[0] - size[0] - 16
      : point[0] + 16;
  const top =
    point[1] + 16 + size[1] > viewport[1] - 12
      ? point[1] - size[1] - 16
      : point[1] + 16;
  return [
    Math.max(12, Math.min(viewport[0] - size[0] - 12, left)),
    Math.max(12, Math.min(viewport[1] - size[1] - 12, top)),
  ];
}
/** Spatial arrow navigation; disallow candidates behind the focused plot. */
export function directionalPlot(
  from: ViewerPlot,
  plots: ViewerPlot[],
  key: string,
) {
  const axis = key === "ArrowLeft" || key === "ArrowRight" ? 0 : 1,
    sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  let best: ViewerPlot | undefined,
    score = Infinity;
  for (const p of plots) {
    if (p.id === from.id) continue;
    const delta = (p.centroid[axis] - from.centroid[axis]) * sign,
      side = Math.abs(p.centroid[1 - axis] - from.centroid[1 - axis]);
    if (delta <= 1e-6) continue;
    const rank = Math.hypot(delta, side) + side * 2;
    if (rank < score) {
      score = rank;
      best = p;
    }
  }
  return best;
}
