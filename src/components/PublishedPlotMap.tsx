"use client";
import React, {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { api, button, Card, field, Label, secondary } from "./Phase4Shared";
import {
  cameraForPlot,
  clampScale,
  constrainCamera,
  directionalPlot,
  emptyMapFilters,
  findPlot,
  fitCamera,
  matchesMapFilters,
  pathFor,
  plotAriaLabel,
  plotStatuses,
  statusCounts,
  statusPresentation,
  tooltipPosition,
  validateMapFilters,
  zoomAt,
  type Camera,
  type MapFilters,
  type Point,
  type PublishedMap,
  type ViewerPlot,
} from "@/lib/plot-map-viewer";
import styles from "./PublishedPlotMap.module.css";
/** This memoized tree changes only when the published dataset changes, not on hover/pan/filter. */
const MapScene = memo(function MapScene({
  map,
  scope,
  worldRef,
  baseRef,
  layerRef,
}: {
  map: PublishedMap;
  scope: string;
  worldRef: React.RefObject<HTMLDivElement | null>;
  baseRef: React.RefObject<HTMLDivElement | null>;
  layerRef: React.RefObject<SVGSVGElement | null>;
}) {
  return (
    <div
      ref={worldRef}
      className={styles.world}
      data-testid="published-map-world"
    >
      {/* Only the authenticated API's server-sanitized asset reaches this markup sink. */}
      <div
        ref={baseRef}
        className={styles.base}
        inert
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: map.svg }}
      />
      <svg
        ref={layerRef}
        className={styles.layer}
        viewBox={map.viewBox.join(" ")}
        aria-label="Published plot outlines"
      >
        <defs>
          {plotStatuses.map((s, i) => (
            <pattern
              key={s}
              id={`${scope}-${s}`}
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform={i === 1 || i === 2 ? "rotate(45)" : undefined}
            >
              <rect width="8" height="8" fill={statusPresentation[s].color} />
              {s === "available" ? (
                <circle cx="4" cy="4" r=".7" fill="white" fillOpacity=".65" />
              ) : s === "sold" ? (
                <path
                  d="M0 4H8"
                  stroke="white"
                  strokeOpacity=".6"
                  strokeWidth=".8"
                />
              ) : (
                <path
                  d={
                    s === "booked" || s === "blocked"
                      ? "M4 0V8M0 4H8"
                      : "M4 0V8"
                  }
                  stroke="white"
                  strokeOpacity=".65"
                  strokeWidth=".8"
                />
              )}
            </pattern>
          ))}
        </defs>
        {map.plots.map((p) => {
          const font = Math.max(
            0.5,
            Math.min(p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]) * 0.17,
          );
          return (
            <g key={p.id} data-plot-group={p.id}>
              <path
                className={styles.plot}
                data-plot-id={p.id}
                data-element-id={p.elementId}
                data-status={p.status}
                d={pathFor(p.rings)}
                fillRule={p.fillRule}
                fill={`url(#${scope}-${p.status})`}
                vectorEffect="non-scaling-stroke"
                role="button"
                aria-label={plotAriaLabel(p)}
                aria-haspopup="dialog"
                tabIndex={-1}
              />
              <text
                aria-hidden="true"
                className={styles.number}
                x={p.centroid[0]}
                y={p.centroid[1]}
                dy=".3em"
                fontSize={font}
              >
                {p.number}
              </text>
              <text
                aria-hidden="true"
                className={styles.status}
                x={p.centroid[0]}
                y={p.centroid[1] + font * 1.3}
                fontSize={font * 0.7}
              >
                {statusPresentation[p.status].mark}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});
function money(p: ViewerPlot) {
  return p.priceMinor === null
    ? "Not set"
    : `${p.currency} ${(p.priceMinor / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function PublishedPlotMapWorkspace({
  initialProject = "",
  onProjectChange,
}: {
  initialProject?: string;
  onProjectChange?: (id: string) => void;
}) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]),
    [project, setProject] = useState(initialProject);
  useEffect(() => {
    onProjectChange?.(project);
  }, [project, onProjectChange]);
  useEffect(() => {
    let live = true;
    api<{ properties: typeof projects }>("properties")
      .then((d) => {
        if (live) {
          setProjects(d.properties);
          setProject((current) =>
            d.properties.some((p) => p.id === current)
              ? current
              : d.properties[0]?.id || "",
          );
        }
      })
      .catch(() => {
        if (live) setProjects([]);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="space-y-5" aria-label="Published Plot Map workspace">
      <div>
        <h1 className="text-2xl font-bold">Published Plot Map</h1>
        <p className="text-sm text-slate-600">
          Read-only Phase C viewer. Hover or tap for plot information; booking,
          ownership actions and automatic cross-user updates are later phases.
        </p>
      </div>
      <Label name="Published map project">
        <select
          className={field}
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">Select project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Label>
      {project ? (
        <PublishedPlotMap key={project} projectId={project} />
      ) : (
        <p>
          Select a project. If none are listed, check your session and property
          permissions.
        </p>
      )}
    </div>
  );
}
export function PublishedPlotMap({ projectId }: { projectId: string }) {
  const [map, setMap] = useState<PublishedMap | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [filters, setFilters] = useState<MapFilters>({ ...emptyMapFilters }),
    [query, setQuery] = useState(""),
    [message, setMessage] = useState(""),
    [activeId, setActiveId] = useState<string | null>(null),
    [pinned, setPinned] = useState(false),
    [zoom, setZoom] = useState(100);
  const viewport = useRef<HTMLDivElement>(null),
    world = useRef<HTMLDivElement>(null),
    base = useRef<HTMLDivElement>(null),
    layer = useRef<SVGSVGElement>(null),
    tooltip = useRef<HTMLDivElement>(null),
    nodes = useRef(new Map<string, SVGPathElement>()),
    camera = useRef<Camera>({ ...fitCamera }),
    ticket = useRef(0),
    frame = useRef(0),
    tooltipFrame = useRef(0),
    lastPoint = useRef<Point>([0, 0]),
    pinnedRef = useRef(false),
    activeRef = useRef<string | null>(null),
    focusId = useRef<string | null>(null),
    skipFocus = useRef(false);
  const scope = "pm-view-" + useId().replace(/[^a-zA-Z0-9-]/g, ""),
    tooltipId = scope + "-info";
  const filterError = validateMapFilters(filters),
    visible = useMemo(
      () =>
        map?.plots.filter(
          (p) => !filterError && matchesMapFilters(p, filters),
        ) || [],
      [map, filters, filterError],
    ),
    counts = useMemo(() => statusCounts(visible), [visible]),
    activePlot = map?.plots.find((p) => p.id === activeId) || null;
  const latest = useRef({ map, visible });
  latest.current = { map, visible };
  function close(restore = false) {
    const id = activeRef.current;
    activeRef.current = null;
    pinnedRef.current = false;
    setActiveId(null);
    setPinned(false);
    if (restore && id) {
      const node = nodes.current.get(id);
      if (node && document.activeElement !== node) {
        skipFocus.current = true;
        node.focus({ preventScroll: true });
      }
    }
  }
  async function load() {
    const id = ++ticket.current;
    setLoading(true);
    setError("");
    close();
    try {
      const d = await api<PublishedMap>(
        `properties/${projectId}/plot-maps/viewer`,
      );
      if (id !== ticket.current) return;
      setMap(d);
      setFilters({ ...emptyMapFilters });
      setQuery("");
      setMessage("");
    } catch (e) {
      if (id === ticket.current) {
        setMap(null);
        setError(e instanceof Error ? e.message : "Could not load map.");
      }
    } finally {
      if (id === ticket.current) setLoading(false);
    }
  }
  useEffect(() => {
    load();
    return () => {
      ticket.current++;
    };
  }, [projectId]);
  function moveTooltip() {
    if (!tooltip.current) return;
    const r = tooltip.current.getBoundingClientRect(),
      [x, y] = tooltipPosition(
        lastPoint.current,
        [r.width, r.height],
        [window.innerWidth, window.innerHeight],
      );
    tooltip.current.style.transform = `translate3d(${x}px,${y}px,0)`;
  }
  function scheduleTooltip() {
    cancelAnimationFrame(tooltipFrame.current);
    tooltipFrame.current = requestAnimationFrame(moveTooltip);
  }
  function show(id: string, point: Point, pin = false) {
    if (!latest.current.visible.some((p) => p.id === id)) return;
    lastPoint.current = point;
    activeRef.current = id;
    pinnedRef.current = pin;
    setActiveId(id);
    setPinned(pin);
    scheduleTooltip();
  }
  function commitCamera(v: Camera, animate = false) {
    const host = viewport.current;
    if (!host || !world.current) return;
    camera.current = constrainCamera(v, host.clientWidth, host.clientHeight);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (!world.current) return;
      const c = camera.current;
      world.current.style.transition =
        animate &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "transform 150ms ease-out"
          : "none";
      world.current.style.transform = `translate3d(${c.x}px,${c.y}px,0) scale(${c.scale})`;
      world.current.dataset.detail = String(c.scale >= 2);
      setZoom(Math.round(c.scale * 100));
    });
  }
  function fit() {
    commitCamera({ ...fitCamera }, true);
    close();
  }
  function zoomBy(factor: number, point?: Point) {
    const el = viewport.current;
    if (el)
      commitCamera(
        zoomAt(
          camera.current,
          camera.current.scale * factor,
          point || [el.clientWidth / 2, el.clientHeight / 2],
        ),
      );
    close();
  }
  function focusPlot(p: ViewerPlot, center = true) {
    const el = viewport.current,
      node = nodes.current.get(p.id);
    if (!el || !node || !latest.current.map) return;
    focusId.current = p.id;
    for (const [id, path] of nodes.current)
      path.setAttribute("tabindex", id === p.id ? "0" : "-1");
    if (center)
      commitCamera(
        cameraForPlot(
          p.bbox,
          latest.current.map.viewBox,
          el.clientWidth,
          el.clientHeight,
        ),
        true,
      );
    node.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      const r = node.getBoundingClientRect();
      show(p.id, [r.left + r.width / 2, r.top + r.height / 2]);
    });
  }
  // Dataset setup, not per-hover rendering. Native listeners below are delegated once.
  useEffect(() => {
    if (!map || !layer.current) return;
    nodes.current = new Map(
      [...layer.current.querySelectorAll<SVGPathElement>("[data-plot-id]")].map(
        (n) => [n.dataset.plotId!, n],
      ),
    );
    const ids = new Set(map.plots.map((p) => p.elementId));
    for (const el of base.current?.querySelectorAll<SVGElement>("[id]") || [])
      if (ids.has(el.id)) el.style.opacity = "0";
    camera.current = { ...fitCamera };
    focusId.current = null;
    commitCamera({ ...fitCamera });
    return () => {
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(tooltipFrame.current);
    };
  }, [map]);
  useEffect(() => {
    const ids = new Set(visible.map((p) => p.id));
    for (const [id, n] of nodes.current) {
      n.parentElement!.style.display = ids.has(id) ? "" : "none";
      n.setAttribute("aria-hidden", String(!ids.has(id)));
      n.setAttribute("tabindex", "-1");
    }
    const current =
      focusId.current && ids.has(focusId.current)
        ? focusId.current
        : visible[0]?.id;
    focusId.current = current || null;
    if (current) nodes.current.get(current)?.setAttribute("tabindex", "0");
    if (activeRef.current && !ids.has(activeRef.current)) close();
  }, [visible, map]);
  useEffect(() => {
    for (const [id, n] of nodes.current) {
      n.dataset.active = String(id === activeId);
      if (id === activeId) {
        n.setAttribute("aria-describedby", tooltipId);
        n.setAttribute("aria-expanded", String(pinned));
      } else {
        n.removeAttribute("aria-describedby");
        n.removeAttribute("aria-expanded");
      }
    }
  }, [activeId, pinned, tooltipId]);
  useLayoutEffect(() => {
    if (activeId) moveTooltip();
  }, [activeId, pinned]);
  useEffect(() => {
    const host = viewport.current;
    if (!host || !map) return;
    const pointers = new Map<number, Point>();
    let start: Point = [0, 0],
      startView = { ...fitCamera },
      target: string | null = null,
      moved = false,
      pinched = false,
      pinchDistance = 1,
      pinchCenter: Point = [0, 0];
    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = host.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const plotNode = (target: EventTarget | null) => {
      const n =
        target instanceof Element
          ? target.closest<SVGPathElement>("[data-plot-id]")
          : null;
      return n && layer.current?.contains(n) ? n : null;
    };
    const midpoint = () => {
      const p = [...pointers.values()];
      return [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] as Point;
    };
    const distance = () => {
      const p = [...pointers.values()];
      return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
    };
    function down(e: PointerEvent) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const point = local(e);
      pointers.set(e.pointerId, point);
      host!.setPointerCapture(e.pointerId);
      close();
      if (pointers.size === 1) {
        start = point;
        startView = { ...camera.current };
        target = plotNode(e.target)?.dataset.plotId || null;
        moved = false;
        pinched = false;
      } else if (pointers.size === 2) {
        pinched = true;
        pinchCenter = midpoint();
        pinchDistance = Math.max(1, distance());
        startView = { ...camera.current };
      }
    }
    function move(e: PointerEvent) {
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2) {
          if (activeRef.current) close();
          const center = midpoint(),
            next = clampScale((startView.scale * distance()) / pinchDistance),
            factor = next / startView.scale;
          commitCamera({
            scale: next,
            x: center[0] - (pinchCenter[0] - startView.x) * factor,
            y: center[1] - (pinchCenter[1] - startView.y) * factor,
          });
        } else if (pointers.size === 1) {
          const p = local(e),
            dx = p[0] - start[0],
            dy = p[1] - start[1];
          if (Math.hypot(dx, dy) > 5) {
            if (!moved) close();
            moved = true;
          }
          if (moved)
            commitCamera({
              ...startView,
              x: startView.x + dx,
              y: startView.y + dy,
            });
        }
        return;
      }
      if (e.pointerType !== "mouse" || pinnedRef.current) return;
      const n = plotNode(e.target);
      if (n) {
        const id = n.dataset.plotId!;
        if (id !== activeRef.current) show(id, [e.clientX, e.clientY]);
        else {
          lastPoint.current = [e.clientX, e.clientY];
          scheduleTooltip();
        }
      } else if (activeRef.current) close();
    }
    function up(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return;
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (host!.hasPointerCapture(e.pointerId))
        host!.releasePointerCapture(e.pointerId);
      if (e.type !== "pointercancel" && wasSingle && !moved && !pinched) {
        if (target) {
          const n = nodes.current.get(target);
          if (n) {
            focusId.current = target;
            for (const [id, p] of nodes.current)
              p.setAttribute("tabindex", id === target ? "0" : "-1");
            skipFocus.current = document.activeElement !== n;
            n.focus({ preventScroll: true });
            show(target, [e.clientX, e.clientY], true);
          }
        } else close();
      }
      if (pointers.size === 1) {
        start = [...pointers.values()][0];
        startView = { ...camera.current };
        moved = true;
      }
      if (!pointers.size) pinched = false;
    }
    function wheel(e: WheelEvent) {
      e.preventDefault();
      const delta =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host!.clientHeight : 1);
      zoomBy(Math.exp(Math.max(-200, Math.min(200, -delta)) * 0.002), local(e));
    }
    function over(e: PointerEvent) {
      if (e.pointerType === "mouse" && !pointers.size && !pinnedRef.current) {
        const n = plotNode(e.target);
        if (n) show(n.dataset.plotId!, [e.clientX, e.clientY]);
      }
    }
    function leave() {
      if (!pinnedRef.current && !pointers.size) close();
    }
    function focus(e: FocusEvent) {
      const n = plotNode(e.target);
      if (!n) return;
      if (skipFocus.current) {
        skipFocus.current = false;
        return;
      }
      focusId.current = n.dataset.plotId!;
      for (const [id, p] of nodes.current)
        p.setAttribute("tabindex", id === focusId.current ? "0" : "-1");
      const r = n.getBoundingClientRect();
      show(focusId.current, [r.left + r.width / 2, r.top + r.height / 2]);
    }
    function blur(e: FocusEvent) {
      if (!host!.contains(e.relatedTarget as Node) && !pinnedRef.current)
        close();
    }
    function key(e: KeyboardEvent) {
      const n = plotNode(e.target);
      if (!n) return;
      const current = latest.current.visible.find(
        (p) => p.id === n.dataset.plotId,
      );
      if (!current) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const next = directionalPlot(current, latest.current.visible, e.key);
        if (next) {
          const node = nodes.current.get(next.id)!,
            r = node.getBoundingClientRect(),
            h = host!.getBoundingClientRect();
          focusPlot(
            next,
            r.left < h.left + 12 ||
              r.right > h.right - 12 ||
              r.top < h.top + 12 ||
              r.bottom > h.bottom - 12,
          );
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const r = n.getBoundingClientRect();
        show(current.id, [r.left + r.width / 2, r.top + r.height / 2], true);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(1.5);
      } else if (e.key === "-") {
        e.preventDefault();
        zoomBy(1 / 1.5);
      } else if (e.key === "Home") {
        e.preventDefault();
        fit();
      }
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape" && activeRef.current) {
        e.preventDefault();
        close(true);
      }
    }
    function double(e: MouseEvent) {
      e.preventDefault();
      zoomBy(2, local(e));
    }
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("pointerover", over);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("wheel", wheel, { passive: false });
    host.addEventListener("focusin", focus);
    host.addEventListener("focusout", blur);
    host.addEventListener("keydown", key);
    host.addEventListener("dblclick", double);
    document.addEventListener("keydown", escape);
    const resize = new ResizeObserver(() => {
      commitCamera({ ...fitCamera });
      close();
    });
    resize.observe(host);
    return () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("pointerover", over);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("focusin", focus);
      host.removeEventListener("focusout", blur);
      host.removeEventListener("keydown", key);
      host.removeEventListener("dblclick", double);
      document.removeEventListener("keydown", escape);
      resize.disconnect();
    };
  }, [map]);
  function search(e: React.FormEvent) {
    e.preventDefault();
    if (!map) return;
    const p = findPlot(map.plots, query);
    if (!p) {
      setMessage("No plot with that exact number in the published map.");
      return;
    }
    if (!visible.some((v) => v.id === p.id)) {
      setMessage(
        `Plot ${p.number} is hidden by filters. Clear filters, then search again.`,
      );
      return;
    }
    focusPlot(p);
    setMessage(`Found plot ${p.number}.`);
  }
  const setFilter = (key: keyof MapFilters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setMessage("");
  };
  return (
    <div className="space-y-4" aria-label="Published map viewer">
      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-4 text-amber-900">
          {error}
        </p>
      )}
      <button
        className={secondary}
        type="button"
        disabled={loading}
        onClick={load}
      >
        {loading ? "Loading map…" : "Refresh published map"}
      </button>
      {loading && <p role="status">Loading published map…</p>}
      {map && !loading && (
        <>
          <p className="text-sm text-slate-600">
            {map.projectName} · Published version {map.version} ·{" "}
            {map.plots.length} plots. Counts and statuses are the loaded
            snapshot; refresh to see later changes.
          </p>
          <Card title="Find & filter plots">
            <form className="flex flex-wrap gap-2" onSubmit={search}>
              <div className="min-w-0 flex-1">
                <Label name="Search published plot number">
                  <input
                    className={field}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. A-12"
                    maxLength={64}
                  />
                </Label>
              </div>
              <button className={button}>Find plot</button>
            </form>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Label name="Filter status">
                <select
                  className={field}
                  value={filters.status}
                  onChange={(e) => setFilter("status", e.target.value)}
                >
                  <option value="">All statuses</option>
                  {plotStatuses.map((s) => (
                    <option key={s} value={s}>
                      {statusPresentation[s].label}
                    </option>
                  ))}
                </select>
              </Label>
              <Label name="Filter block">
                <select
                  className={field}
                  value={filters.block}
                  onChange={(e) => setFilter("block", e.target.value)}
                >
                  <option value="">All blocks</option>
                  {[
                    ...new Set(
                      map.plots.flatMap((p) => (p.block ? [p.block] : [])),
                    ),
                  ]
                    .sort()
                    .map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                </select>
              </Label>
              <Label name="Filter facing">
                <select
                  className={field}
                  value={filters.facing}
                  onChange={(e) => setFilter("facing", e.target.value)}
                >
                  <option value="">All facings</option>
                  {[
                    ...new Set(
                      map.plots.flatMap((p) => (p.facing ? [p.facing] : [])),
                    ),
                  ]
                    .sort()
                    .map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                </select>
              </Label>
              <Label name="Filter corner">
                <select
                  className={field}
                  value={filters.corner}
                  onChange={(e) => setFilter("corner", e.target.value)}
                >
                  <option value="">All plots</option>
                  <option value="yes">Corner only</option>
                  <option value="no">Non-corner only</option>
                </select>
              </Label>
              {(["minArea", "maxArea", "minPrice", "maxPrice"] as const).map(
                (k) => (
                  <Label
                    key={k}
                    name={`${k === "minArea" ? "Minimum size" : k === "maxArea" ? "Maximum size" : k === "minPrice" ? "Minimum price" : "Maximum price"} (${k.endsWith("Area") ? map.areaUnit : "major currency units"})`}
                  >
                    <input
                      className={field}
                      type="number"
                      min="0"
                      step={k.endsWith("Area") ? "any" : ".01"}
                      value={filters[k]}
                      onChange={(e) => setFilter(k, e.target.value)}
                    />
                  </Label>
                ),
              )}
            </div>
            <p className="text-xs text-slate-500">
              Size ranges use {map.areaUnit}, converting official units when
              needed. Price ranges use each plot’s displayed currency; unknown
              prices/corners do not match a specific range/choice.
            </p>
            <button
              className={secondary}
              type="button"
              onClick={() => {
                setFilters({ ...emptyMapFilters });
                setMessage("Filters cleared.");
              }}
            >
              Clear filters
            </button>
          </Card>
          {filterError && (
            <p role="alert" className="text-red-700">
              {filterError}
            </p>
          )}
          <p role="status" aria-live="polite">
            {message || `${visible.length} of ${map.plots.length} plots shown.`}
          </p>
          <ul
            aria-label="Plot status legend and visible counts"
            className="flex flex-wrap gap-2"
          >
            {plotStatuses.map((s) => (
              <li
                key={s}
                className="rounded-lg border bg-white px-3 py-2 text-sm"
              >
                <span
                  aria-hidden="true"
                  className="mr-2 inline-block h-3 w-3 rounded"
                  style={{ backgroundColor: statusPresentation[s].color }}
                />
                {statusPresentation[s].label}:{" "}
                <strong data-testid={`count-${s}`}>{counts[s]}</strong>{" "}
                <span className="text-xs text-slate-500">
                  ({statusPresentation[s].mark})
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={secondary}
              aria-label="Zoom in"
              onClick={() => zoomBy(1.5)}
            >
              +
            </button>
            <button
              type="button"
              className={secondary}
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / 1.5)}
            >
              −
            </button>
            <button type="button" className={secondary} onClick={fit}>
              Fit to screen
            </button>
            <span data-testid="map-zoom" className="text-sm">
              {zoom}%
            </span>
          </div>
          <p id={scope + "-help"} className="text-xs text-slate-600">
            Wheel/double-click to zoom; drag to pan; pinch on touch screens. Tab
            to a plot, arrow keys to move between plots, Enter/Space to pin
            information, Escape to close, +/− to zoom, Home to fit. Labels scale
            with zoom; status abbreviations appear at 200%.
          </p>
          <div
            ref={viewport}
            className={styles.viewport}
            role="region"
            aria-label="Interactive published map"
            aria-describedby={scope + "-help"}
            data-testid="interactive-published-map"
          >
            <MapScene
              map={map}
              scope={scope}
              worldRef={world}
              baseRef={base}
              layerRef={layer}
            />
          </div>
          {!visible.length && (
            <p>No plots match these filters. Clear or adjust the filters.</p>
          )}
          {activePlot &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={tooltip}
                id={tooltipId}
                className={styles.tooltip}
                data-pinned={String(pinned)}
                role={pinned ? "dialog" : "tooltip"}
                aria-label={`Plot ${activePlot.number} information`}
                aria-modal={pinned ? false : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3>Plot {activePlot.number}</h3>
                  {pinned && (
                    <button
                      className="rounded border px-2 py-1"
                      type="button"
                      aria-label="Close plot information"
                      onClick={() => close(true)}
                    >
                      ×
                    </button>
                  )}
                </div>
                <span className="font-semibold">
                  {statusPresentation[activePlot.status].label}
                </span>
                <dl>
                  <dt>Block / phase</dt>
                  <dd>
                    {activePlot.block || "Not set"} /{" "}
                    {activePlot.phase || "Not set"}
                  </dd>
                  <dt>Size</dt>
                  <dd>
                    {Number(activePlot.area.value.toFixed(3)).toLocaleString()}{" "}
                    {activePlot.area.unit} ({activePlot.area.source})
                  </dd>
                  <dt>Dimensions</dt>
                  <dd>
                    {activePlot.dimensions
                      ? `${activePlot.dimensions.text} (${activePlot.dimensions.source})`
                      : "Not set"}
                  </dd>
                  <dt>Facing</dt>
                  <dd>{activePlot.facing || "Not set"}</dd>
                  <dt>Corner</dt>
                  <dd>
                    {activePlot.corner === null
                      ? "Unknown"
                      : activePlot.corner
                        ? "Yes"
                        : "No"}
                  </dd>
                  <dt>Price</dt>
                  <dd>{money(activePlot)}</dd>
                </dl>
                <p className="mt-2 text-xs text-slate-500">
                  Read-only plot information. Booking and ownership actions are
                  not part of Phase C.
                </p>
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}
