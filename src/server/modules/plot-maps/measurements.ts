import clipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { z } from "zod";
import {
  containsRing,
  measure,
  signedArea,
  type Geometry,
  type Point,
} from "./geometry";
export const pointSchema = z.tuple([
  z.number().finite().min(-1e9).max(1e9),
  z.number().finite().min(-1e9).max(1e9),
]);
export const calibrationSchema = z
  .object({
    unit: z.enum(["ft", "m"]),
    ratio: z.number().positive().max(1e6).optional(),
    points: z.tuple([pointSchema, pointSchema]).optional(),
    distance: z.number().positive().max(1e9).optional(),
    areaUnit: z.enum(["sqft", "sqm", "marla", "kanal"]).default("marla"),
    marlaSqFt: z.number().positive().max(10000).default(272.25),
    northUp: z.boolean().default(false),
  })
  .strict()
  .superRefine((q, c) => {
    if (
      q.points
        ? !q.distance ||
          q.ratio !== undefined ||
          Math.hypot(
            q.points[0][0] - q.points[1][0],
            q.points[0][1] - q.points[1][1],
          ) < 1e-6
        : !q.ratio || q.distance !== undefined
    )
      c.addIssue({
        code: "custom",
        message: "Supply ratio OR two distinct SVG points and a real distance.",
      });
  });
export type Scale = {
  unit: "ft" | "m";
  ratio: number;
  areaUnit: "sqft" | "sqm" | "marla" | "kanal";
  marlaSqFt: number;
  northUp: boolean;
};
export function scaleFrom(q: z.infer<typeof calibrationSchema>): Scale {
  return {
    ...q,
    ratio: q.points
      ? q.distance! /
        Math.hypot(
          q.points[0][0] - q.points[1][0],
          q.points[0][1] - q.points[1][1],
        )
      : q.ratio!,
  };
}
/** Normalize filled boundaries to boolean polygons. Redundant same-winding inner rings are not holes. */
export function polygons(g: Geometry): MultiPolygon {
  const rings = [...g.rings]
    .filter((r) => Math.abs(signedArea(r)) > 1e-8)
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const outers: { ring: Point[]; polygon: Polygon }[] = [];
  for (const ring of rings) {
    const parents = rings.filter(
      (r) =>
        Math.abs(signedArea(r)) > Math.abs(signedArea(ring)) &&
        ring.every((p) => containsRing(r, p)),
    );
    const outside = parents.reduce((n, r) => n + Math.sign(signedArea(r)), 0),
      inside = outside + Math.sign(signedArea(ring));
    const before =
        g.fillRule === "evenodd" ? parents.length % 2 === 1 : outside !== 0,
      after = g.fillRule === "evenodd" ? !before : inside !== 0;
    if (!before && after) outers.push({ ring, polygon: [ring] });
    else if (before && !after) {
      const parent = [...outers]
        .reverse()
        .find((o) => ring.every((p) => containsRing(o.ring, p)));
      if (parent) parent.polygon.push(ring);
    }
  }
  return outers.length
    ? clipping.union(
        outers[0].polygon,
        ...outers.slice(1).map((o) => o.polygon),
      )
    : [];
}
export function fromPolygons(polys: MultiPolygon): Geometry | null {
  return measure(
    polys.flatMap((p) => p.map((r) => r as Point[])),
    "evenodd",
  );
}
export function dimensions(g: Geometry, s: Scale) {
  const ring = [...g.rings].sort(
    (a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)),
  )[0];
  let longest = 0,
    angle = 0;
  const edges: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      n = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (n > 1e-7) edges.push(n * s.ratio);
    if (n > longest) {
      longest = n;
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  const rotated = ring.map(([x, y]) => [
    x * Math.cos(angle) + y * Math.sin(angle),
    -x * Math.sin(angle) + y * Math.cos(angle),
  ]);
  const widths = [0, 1]
    .map(
      (i) =>
        (Math.max(...rotated.map((p) => p[i])) -
          Math.min(...rotated.map((p) => p[i]))) *
        s.ratio,
    )
    .sort((a, b) => a - b);
  return {
    unit: s.unit,
    width: widths[0],
    length: widths[1],
    edges: edges.slice(0, 256),
    approximate: true,
  };
}
export function areas(areaSvg: number, s: Scale) {
  const sqft =
    areaSvg * s.ratio * s.ratio * (s.unit === "m" ? 1 / (0.3048 * 0.3048) : 1);
  const values = {
    sqft,
    sqm: sqft * 0.3048 * 0.3048,
    marla: sqft / s.marlaSqFt,
    kanal: sqft / (s.marlaSqFt * 20),
  };
  return {
    ...values,
    unit: s.areaUnit,
    value: values[s.areaUnit],
    calculated: true,
  };
}
export function roadHints(g: Geometry, roads: Geometry[], northUp: boolean) {
  const tolerance =
    Math.min(g.bbox[2] - g.bbox[0], g.bbox[3] - g.bbox[1]) * 0.16;
  const directions = new Set<string>();
  for (const road of roads)
    for (const rr of road.rings)
      for (let j = 0; j < rr.length; j++) {
        const a = rr[j],
          b = rr[(j + 1) % rr.length],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          l2 = dx * dx + dy * dy;
        if (l2 < 1e-8) continue;
        for (const ring of g.rings)
          for (let i = 0; i < ring.length; i++) {
            const p = ring[i],
              q = ring[(i + 1) % ring.length],
              ex = q[0] - p[0],
              ey = q[1] - p[1],
              edge = Math.hypot(ex, ey);
            if (
              edge < 1e-5 ||
              Math.abs(ex * dy - ey * dx) / (edge * Math.sqrt(l2)) > 0.08
            )
              continue;
            const mid: Point = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
              t = ((mid[0] - a[0]) * dx + (mid[1] - a[1]) * dy) / l2;
            if (t < 0 || t > 1) continue;
            const x = a[0] + t * dx,
              y = a[1] + t * dy;
            if (Math.hypot(x - mid[0], y - mid[1]) > tolerance) continue;
            const vx = x - g.centroid[0],
              vy = y - g.centroid[1];
            directions.add(
              Math.abs(vx) > Math.abs(vy)
                ? vx > 0
                  ? "East"
                  : "West"
                : vy > 0
                  ? "South"
                  : "North",
            );
          }
      }
  return {
    facingCalculated:
      northUp && directions.size ? [...directions].join(" / ") : null,
    cornerCalculated: directions.size
      ? Boolean(
          (directions.has("North") || directions.has("South")) &&
            (directions.has("East") || directions.has("West")),
        )
      : null,
    roadInference: "approximate; verify approved layout",
  };
}
