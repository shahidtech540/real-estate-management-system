import clipping from "polygon-clipping";
import { polygons, fromPolygons } from "./measurements";
import { createHash } from "node:crypto";
import { RE2JS } from "re2js";
import { HttpError } from "@/server/auth/guards";
import { sanitizeSvg } from "./svg";
import {
  shapeGeometry,
  measure,
  contains,
  numberList,
  transformPoint,
  type Geometry,
} from "./geometry";
export const DEFAULT_PLOT_PATTERN =
  "^(?:(?:plot)[-_ ]*|P-)?([A-Za-z]?-?[0-9]+[A-Za-z]?)$";
export type Detection = {
  plotNumber: string;
  elementId: string;
  method: "attribute" | "id" | "group" | "text";
  confidence: number;
  geometry: Geometry;
  geometryHash: string;
};
export type Warning = {
  code: string;
  elementId?: string;
  plotNumber?: string;
  message: string;
};
export function compilePattern(pattern: string) {
  if (pattern.length > 256)
    throw new HttpError(
      400,
      "PLOT_PATTERN",
      "Pattern limit is 256 characters.",
    );
  try {
    return RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
  } catch {
    throw new HttpError(
      400,
      "PLOT_PATTERN",
      "Use a valid RE2-compatible plot pattern (capture group 1 is the number).",
    );
  }
}
export function detectPlots(source: string, pattern = DEFAULT_PLOT_PATTERN) {
  const matcher = compilePattern(pattern),
    { doc, sanitized, removed } = sanitizeSvg(source),
    warnings: Warning[] = [],
    plots: Detection[] = [];
  const id = (el: Element) => el.getAttribute("id")!,
    ignored = (el: Element) => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        if (
          ["defs", "clipPath", "mask", "symbol", "marker", "pattern"].includes(
            p.localName,
          ) ||
          p.getAttribute("display") === "none" ||
          p.getAttribute("visibility") === "hidden" ||
          /(?:^|[-_\s])(?:roads?|parks?|boundar(?:y|ies)|legends?|compass|title)(?:$|[-_\s\d])/i.test(
            `${p.getAttribute("data-source-id") || ""} ${p.getAttribute("class") || ""}`,
          )
        )
          return true;
      }
      return false;
    };
  const match = (s: string) => {
    const m = matcher.matcher(s.trim());
    if (!m.matches()) return null;
    const n = String(m.groupCount() ? m.group(1) : m.group())
      .trim()
      .toUpperCase();
    return /^[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(n) ? n : null;
  };
  const label = (
    el: Element,
  ): { number: string; method: Detection["method"] } | null => {
    for (const attr of ["data-plot-number", "data-plot"])
      if (el.hasAttribute(attr)) {
        const raw = el.getAttribute(attr)!.trim(),
          n =
            match(raw) ||
            (/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(raw)
              ? raw.toUpperCase()
              : null);
        if (n) return { number: n, method: "attribute" };
        warnings.push({
          code: "invalid_number",
          elementId: id(el),
          message: "Explicit plot number is invalid.",
        });
      }
    const n = match(el.getAttribute("data-source-id") || "");
    return n
      ? { number: n, method: el.localName === "g" ? "group" : "id" }
      : null;
  };
  const shapes = new Map<Element, Geometry>();
  let points = 0;
  for (const el of doc.querySelectorAll("path,polygon,rect,polyline")) {
    if (ignored(el)) continue;
    try {
      const raw = shapeGeometry(el);
      const g = raw && raw.rings.length > 1 ? fromPolygons(polygons(raw)) : raw;
      if (g) {
        points += g.rings.reduce((n, r) => n + r.length, 0);
        if (points > 100000 || shapes.size >= 5000)
          throw new HttpError(
            413,
            "SVG_COMPLEXITY",
            "Map limit: 5,000 closed shapes / 100,000 sampled points.",
          );
        shapes.set(el, g);
      } else
        warnings.push({
          code: "open_or_empty_shape",
          elementId: id(el),
          message: "Shape is open, empty or degenerate; not a plot candidate.",
        });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      warnings.push({
        code: "invalid_geometry",
        elementId: id(el),
        message: e instanceof Error ? e.message : "Invalid geometry",
      });
    }
  }
  const claimed = new Set<Element>();
  const add = (
    el: Element,
    n: string,
    method: Detection["method"],
    g: Geometry,
  ) => {
    const hash = createHash("sha256")
      .update(JSON.stringify({ rings: g.rings, fillRule: g.fillRule }))
      .digest("hex");
    plots.push({
      plotNumber: n,
      elementId: id(el),
      method,
      confidence: method === "attribute" ? 1 : method === "text" ? 0.7 : 0.95,
      geometry: g,
      geometryHash: hash,
    });
  };
  // Outermost explicitly numbered group owns its descendants; never double-count.
  for (const el of doc.querySelectorAll("g,path,polygon,rect,polyline")) {
    if (ignored(el) || claimed.has(el)) continue;
    let p = el.parentElement,
      owned = false;
    while (p) {
      if (claimed.has(p)) {
        owned = true;
        break;
      }
      p = p.parentElement;
    }
    if (owned) continue;
    const l = label(el);
    if (!l) continue;
    const children =
      el.localName === "g"
        ? [...shapes.keys()].filter((s) => el.contains(s))
        : [el];
    const g =
      el.localName === "g"
        ? (() => {
            const parts = children.flatMap((s) => {
              const g = shapes.get(s);
              return g ? [polygons(g)] : [];
            });
            return parts.length
              ? fromPolygons(clipping.union(parts[0], ...parts.slice(1)))
              : null;
          })()
        : shapes.get(el);
    if (!g) {
      warnings.push({
        code: "number_without_shape",
        elementId: id(el),
        plotNumber: l.number,
        message: "Numbered element has no usable closed geometry.",
      });
      continue;
    }
    add(el, l.number, l.method, g);
    claimed.add(el);
    children.forEach((s) => claimed.add(s));
  }
  const areas = [...shapes.values()].map((g) => g.area).sort((a, b) => a - b),
    median = areas[Math.floor((areas.length - 1) / 2)] || 0;
  let matchChecks = 0;
  for (const text of doc.querySelectorAll("text")) {
    if (ignored(text)) continue;
    let p: Element | null = text,
      owned = false;
    while (p) {
      if (claimed.has(p)) {
        owned = true;
        break;
      }
      p = p.parentElement;
    }
    if (owned) continue;
    const n = match(text.textContent || "");
    if (!n) continue;
    try {
      const anchor =
        text.hasAttribute("x") && text.hasAttribute("y")
          ? text
          : text.querySelector("tspan[x][y]");
      if (!anchor)
        throw Error(
          "Numbered text needs explicit x and y (or a positioned tspan).",
        );
      const x = numberList(anchor.getAttribute("x")!)[0],
        y = numberList(anchor.getAttribute("y")!)[0];
      if (x === undefined || y === undefined)
        throw Error("Missing text anchor");
      const pos = transformPoint(anchor, [x, y]);
      const candidates = [...shapes]
        .filter(([s, g]) => {
          if (++matchChecks > 10000000)
            throw new HttpError(
              413,
              "SVG_COMPLEXITY",
              "Too many text-to-shape comparisons.",
            );
          return !claimed.has(s) && g.area <= median * 20 && contains(g, pos);
        })
        .sort((a, b) => a[1].area - b[1].area);
      if (!candidates.length) {
        warnings.push({
          code: "number_without_shape",
          elementId: id(text),
          plotNumber: n,
          message: "No unclaimed closed shape contains this number anchor.",
        });
        continue;
      }
      const [shape, g] = candidates[0];
      add(shape, n, "text", g);
      claimed.add(shape);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      warnings.push({
        code: "invalid_text_anchor",
        elementId: id(text),
        plotNumber: n,
        message: e instanceof Error ? e.message : "Invalid text position",
      });
    }
  }
  for (const [el, g] of shapes)
    if (!claimed.has(el))
      warnings.push({
        code: g.area > median * 20 ? "large_non_plot" : "unlabelled_shape",
        elementId: id(el),
        message: "Unnumbered shape excluded; review/override in Phase B.",
      });
  const counts = new Map<string, number>();
  for (const p of plots)
    counts.set(p.plotNumber, (counts.get(p.plotNumber) || 0) + 1);
  for (const [n, count] of counts)
    if (count > 1)
      warnings.push({
        code: "duplicate_number",
        plotNumber: n,
        message: `${count} candidates share this number; publishing must resolve it.`,
      });
  for (const p of plots)
    if (
      median &&
      (p.geometry.area < median * 0.05 || p.geometry.area > median * 20)
    )
      warnings.push({
        code: "area_outlier",
        elementId: p.elementId,
        plotNumber: p.plotNumber,
        message: "Area differs substantially from typical closed shapes.",
      });
  const root = doc.documentElement;
  let viewBox = numberList(root.getAttribute("viewBox") || "");
  if (!viewBox.length)
    viewBox = [
      0,
      0,
      Number(root.getAttribute("width")?.replace(/px$/, "")),
      Number(root.getAttribute("height")?.replace(/px$/, "")),
    ];
  if (
    viewBox.length !== 4 ||
    viewBox.some((n) => !Number.isFinite(n)) ||
    viewBox[2] <= 0 ||
    viewBox[3] <= 0
  )
    throw new HttpError(
      400,
      "SVG_VIEWBOX",
      "Supply a valid viewBox or numeric width/height.",
    );
  if (plots.length === 0)
    warnings.push({
      code: "no_plots",
      message:
        "No plots detected. Check labels, closed shapes and project pattern.",
    });
  return { sanitized, plots, warnings, viewBox, removed, pattern };
}
