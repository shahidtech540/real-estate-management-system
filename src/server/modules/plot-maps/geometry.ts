import svgpath from "svgpath";
export type Point = [number, number];
export type Geometry = {
  rings: Point[][];
  area: number;
  centroid: Point;
  bbox: [number, number, number, number];
  fillRule: "evenodd" | "nonzero";
};
const num = (s: string | null, otherwise = 0) =>
  s === null ? otherwise : Number(s.replace(/px$/, ""));
export function numberList(s: string): number[] {
  if (s.length > 1000000) throw Error("Geometry attribute too long");
  const re = /[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?/g;
  const tokens = [...s.matchAll(re)].map((m) => Number(m[0]));
  if (
    s.replace(re, "").replace(/[\s,]/g, "") ||
    tokens.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9)
  )
    throw Error("Invalid geometry coordinates");
  return tokens;
}

function pathData(el: Element): string {
  switch (el.localName) {
    case "path":
      return el.getAttribute("d") || "";
    case "rect": {
      const x = num(el.getAttribute("x")),
        y = num(el.getAttribute("y")),
        w = num(el.getAttribute("width")),
        h = num(el.getAttribute("height"));
      if (w <= 0 || h <= 0) return "";
      return `M${x} ${y}h${w}v${h}h${-w}z`;
    }
    case "polygon":
    case "polyline": {
      const p = numberList(el.getAttribute("points") || "");
      if (p.length < 6 || p.length % 2) return "";
      if (
        el.localName === "polyline" &&
        (p[0] !== p[p.length - 2] || p[1] !== p[p.length - 1])
      )
        return "";
      return `M${p[0]} ${p[1]}L${p.slice(2).join(" ")}Z`;
    }
    default:
      return "";
  }
}
export function transforms(el: Element) {
  const parts: string[] = [];
  for (let p: Element | null = el; p; p = p.parentElement)
    if (p.hasAttribute("transform")) {
      const transform = p.getAttribute("transform")!;
      const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
      let end = 0,
        matched = false;
      for (const m of transform.matchAll(re)) {
        if (transform.slice(end, m.index).trim())
          throw Error("Invalid SVG transform");
        const n = numberList(m[2]),
          arity: Record<string, number[]> = {
            matrix: [6],
            translate: [1, 2],
            scale: [1, 2],
            rotate: [1, 3],
            skewX: [1],
            skewY: [1],
          };
        if (!arity[m[1]].includes(n.length))
          throw Error("Invalid SVG transform arguments");
        end = m.index! + m[0].length;
        matched = true;
      }
      if (!matched || transform.slice(end).trim())
        throw Error("Invalid SVG transform");
      parts.unshift(transform);
    }
  return parts.join(" ");
}
export function transformPoint(el: Element, point: Point): Point {
  let result: Point = point;
  svgpath(`M${point[0]} ${point[1]}`)
    .transform(transforms(el))
    .abs()
    .iterate((seg) => {
      if (seg[0] === "M") result = [seg[1], seg[2]];
    });
  if (result.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e12))
    throw Error("Invalid transformed position");
  return result;
}
export function signedArea(p: Point[]) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}
export function containsRing(ring: Point[], p: Point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function contains(g: Geometry, p: Point) {
  if (
    p[0] < g.bbox[0] ||
    p[0] > g.bbox[2] ||
    p[1] < g.bbox[1] ||
    p[1] > g.bbox[3]
  )
    return false;
  return g.fillRule === "evenodd"
    ? g.rings.reduce(
        (inside, r) => (containsRing(r, p) ? !inside : inside),
        false,
      )
    : g.rings.reduce(
        (w, r) => w + (containsRing(r, p) ? Math.sign(signedArea(r)) : 0),
        0,
      ) !== 0;
}
export function measure(
  rings: Point[][],
  fillRule: Geometry["fillRule"] = "nonzero",
): Geometry | null {
  if (!rings.length) return null;
  let area = 0,
    cx = 0,
    cy = 0;
  const xs: number[] = [],
    ys: number[] = [];
  for (const ring of rings) {
    const raw = signedArea(ring);
    if (Math.abs(raw) < 1e-8) continue;
    const parents = rings.filter(
      (other) =>
        other !== ring &&
        Math.abs(signedArea(other)) > Math.abs(raw) &&
        containsRing(other, ring[0]),
    );
    const outside = parents.reduce((w, r) => w + Math.sign(signedArea(r)), 0),
      inside = outside + Math.sign(raw);
    const weight =
      Math.abs(raw) *
      (fillRule === "evenodd"
        ? parents.length % 2
          ? -1
          : 1
        : Number(inside !== 0) - Number(outside !== 0));
    let x = 0,
      y = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      x += (ring[j][0] + ring[i][0]) * cross;
      y += (ring[j][1] + ring[i][1]) * cross;
      xs.push(ring[i][0]);
      ys.push(ring[i][1]);
    }
    area += weight;
    cx += (weight * x) / (6 * raw);
    cy += (weight * y) / (6 * raw);
  }
  if (area <= 1e-8 || !Number.isFinite(area)) return null;
  return {
    rings,
    area,
    fillRule,
    centroid: [cx / area, cy / area],
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}
export function shapeGeometry(el: Element): Geometry | null {
  const d = pathData(el);
  if (!d) return null;
  if (d.length > 100000) throw Error("Path exceeds 100,000 characters");
  const rings: Point[][] = [];
  let current: Point[] = [],
    position: Point = [0, 0],
    count = 0;
  const push = (p: Point) => {
    if (
      p.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e12) ||
      ++count > 10000
    )
      throw Error("Shape exceeds geometry limits");
    current.push(p);
    position = p;
  };
  const path = svgpath(d).abs().unshort().unarc().transform(transforms(el));
  if ((path as unknown as { err: string }).err) throw Error("Invalid SVG path");
  path.iterate((seg) => {
    const c = seg[0].toUpperCase(),
      n = seg.slice(1) as number[];
    if (c === "M") {
      current = [];
      push([n[0], n[1]]);
    } else if (c === "L") push([n[0], n[1]]);
    else if (c === "H") push([n[0], position[1]]);
    else if (c === "V") push([position[0], n[0]]);
    else if (c === "C" || c === "Q") {
      const start = position;
      for (let i = 1; i <= 32; i++) {
        const t = i / 32,
          u = 1 - t;
        if (c === "C")
          push([
            u * u * u * start[0] +
              3 * u * u * t * n[0] +
              3 * u * t * t * n[2] +
              t * t * t * n[4],
            u * u * u * start[1] +
              3 * u * u * t * n[1] +
              3 * u * t * t * n[3] +
              t * t * t * n[5],
          ]);
        else
          push([
            u * u * start[0] + 2 * u * t * n[0] + t * t * n[2],
            u * u * start[1] + 2 * u * t * n[1] + t * t * n[3],
          ]);
      }
    } else if (c === "Z") {
      if (current.length >= 3) rings.push(current);
      position = current[0] || position;
      current = [];
    }
  });
  let fillRule: Geometry["fillRule"] = "nonzero";
  for (let p: Element | null = el; p; p = p.parentElement)
    if (p.hasAttribute("fill-rule")) {
      fillRule =
        p.getAttribute("fill-rule") === "evenodd" ? "evenodd" : "nonzero";
      break;
    }
  return measure(rings, fillRule);
}
