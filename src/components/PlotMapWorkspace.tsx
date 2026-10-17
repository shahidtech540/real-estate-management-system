"use client";
import React, { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { api, button, Card, field, Label, secondary } from "./Phase4Shared";
type Point = [number, number];
type Data = {
  block?: string | null;
  phase?: string | null;
  street?: string | null;
  area_official?: number | null;
  area_unit?: string;
  dimensions_official?: string | null;
  facing?: string | null;
  is_corner?: number | null;
  category?: string | null;
  price_per_unit_minor?: number | null;
  total_price_minor?: number | null;
  currency?: string;
  status?: string;
};
type Plot = {
  id: string;
  elementId: string;
  plotNumber: string;
  method: string;
  confidence: number;
  excluded: boolean;
  rings: Point[][];
  bbox: number[];
  fillRule: "evenodd" | "nonzero";
  areaSvg: number;
  data: Data;
  calculated: null | {
    area: {
      value: number;
      unit: string;
      sqft: number;
      sqm: number;
      marla: number;
      kanal: number;
    };
    dimensions: { width: number; length: number; unit: string };
    facingCalculated: string | null;
    cornerCalculated: boolean | null;
  };
};
type Review = {
  id: string;
  status: string;
  version: number;
  revision: number;
  viewBox: number[];
  scale: null | {
    unit: string;
    ratio: number;
    areaUnit: string;
    marlaSqFt: number;
    northUp: boolean;
  };
  defaults: { areaUnit: string; marlaSqFt: number };
  plots: Plot[];
  shapes: {
    elementId: string;
    sourceId: string;
    area: number;
    nonPlot: boolean;
  }[];
  validation: {
    errors: { code: string; message: string }[];
    warnings: { code: string; message: string; elementId?: string }[];
  };
  diff: {
    baselineMapId: string | null;
    added: string[];
    removed: string[];
    changed: string[];
    unchanged: string[];
  };
};
const path = (rings: Point[][]) =>
  rings.map((r) => "M" + r.map((p) => p.join(" ")).join("L") + "Z").join(" ");
const round = (n: number) => Number(n.toFixed(3)).toLocaleString();
export function PlotMapWorkspace() {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]),
    [project, setProject] = useState(""),
    [versions, setVersions] = useState<
      { id: string; version: number; status: string }[]
    >([]),
    [mapId, setMapId] = useState("");
  const [review, setReview] = useState<Review | null>(null),
    [svg, setSvg] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [shape, setShape] = useState(""),
    [plotNumber, setPlotNumber] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState("");
  const [pickMode, setPickMode] = useState(false),
    [points, setPoints] = useState<Point[]>([]),
    [calibrationMode, setCalibrationMode] = useState("ratio"),
    [axis, setAxis] = useState("x");
  const [keep, setKeep] = useState(true),
    [accept, setAccept] = useState(false),
    [reason, setReason] = useState(""),
    [ackRemoved, setAckRemoved] = useState(false),
    [pattern, setPattern] = useState("");
  const overlay = useRef<SVGSVGElement>(null),
    generation = useRef(0),
    versionEpoch = useRef(0);
  const [mapProject, setMapProject] = useState("");
  const root = `properties/${project}/plot-maps`,
    base = `${root}/${mapId}`,
    editable = review?.status === "draft";
  async function loadVersions(p: string, preferred?: string) {
    const ticket = ++versionEpoch.current;
    const r = await api<{ maps: typeof versions; plotNumberPattern: string }>(
      `properties/${p}/plot-maps`,
    );
    if (ticket !== versionEpoch.current) return;
    setMapProject(p);
    setVersions(r.maps);
    setPattern(r.plotNumberPattern);
    setMapId(preferred || r.maps[0]?.id || "");
  }
  useEffect(() => {
    let live = true;
    api<{ properties: typeof projects }>("properties")
      .then((r) => {
        if (live) {
          setProjects(r.properties);
          setProject(r.properties[0]?.id || "");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setReview(null);
    setSvg("");
    setMapId("");
    setVersions([]);
    setSelected([]);
    setShape("");
    if (project) loadVersions(project).catch((e) => setError(e.message));
    return () => {
      versionEpoch.current++;
    };
  }, [project]);
  async function refresh() {
    const ticket = ++generation.current;
    setReview(null);
    setSvg("");
    try {
      const [r, image] = await Promise.all([
        api<Review>(`${base}/review`),
        authFetch(`/api/v1/${base}/svg`),
      ]);
      if (!image.ok) throw Error("Unable to load sanitized SVG.");
      const source = await image.text();
      if (ticket !== generation.current) return;
      setReview(r);
      setSvg(source);
      setSelected([]);
      setShape("");
      setAccept(false);
      setAckRemoved(false);
      setReason("");
      setPoints([]);
      setPickMode(false);
    } catch (e) {
      if (ticket === generation.current) throw e;
    }
  }
  useEffect(() => {
    generation.current++;
    setReview(null);
    setSvg("");
    setSelected([]);
    if (mapId && project && mapProject === project)
      refresh().catch((e) => setError(e.message));
    return () => {
      generation.current++;
    };
  }, [mapId, project, mapProject]);
  async function run(work: () => Promise<void>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function edit(action: Record<string, unknown>) {
    if (!review) throw Error("Reload the review.");
    await api(`${base}/review`, "PATCH", {
      ...action,
      revision: review.revision,
    });
    await refresh();
  }
  function choose(id: string) {
    setShape(id);
    const p = review?.plots.find((p) => p.elementId === id);
    setPlotNumber(p?.plotNumber || "");
    if (p && !p.excluded) setSelected([id]);
    else setSelected([]);
  }
  async function download() {
    const r = await authFetch(`/api/v1/${base}/csv`);
    if (!r.ok) {
      const d = await r.json();
      throw Error(d.error?.message || "Export failed");
    }
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = `plot-map-v${review?.version}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const active = review?.plots.filter((p) => !p.excluded) || [],
    chosen = review?.plots.find((p) => p.elementId === shape),
    visible = active.filter((p) =>
      p.plotNumber.toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <div className="space-y-5" aria-label="Plot Map administration">
      <div>
        <h1 className="text-2xl font-bold">Plot Map · Review & publish</h1>
        <p className="text-sm text-slate-600">
          Administrator workspace. Draft edits never change live inventory until
          publishing. Booking and interactive visitor tools arrive in later
          phases.
        </p>
      </div>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          {error}{" "}
          <button
            className="underline"
            disabled={busy || !mapId}
            onClick={() => run(refresh, "Review reloaded.")}
          >
            Reload latest review
          </button>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-3 text-emerald-800"
        >
          {notice}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-5 min-w-0">
        <Card title="Project & map versions">
          <div className="grid gap-3 md:grid-cols-2">
            <Label name="Project">
              <select
                className={field}
                value={project}
                onChange={(e) => {
                  setError("");
                  setNotice("");
                  setProject(e.target.value);
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Label>
            <Label name="Map version">
              <select
                className={field}
                value={mapId}
                onChange={(e) => {
                  setError("");
                  setNotice("");
                  setMapId(e.target.value);
                }}
              >
                <option value="">Select or upload a map</option>
                {versions.map((m) => (
                  <option key={m.id} value={m.id}>
                    Version {m.version} · {m.status}
                  </option>
                ))}
              </select>
            </Label>
          </div>
          <Label name="Upload SVG (max 10 MiB)">
            <input
              className={field}
              type="file"
              accept="image/svg+xml,.svg"
              disabled={!project}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                run(async () => {
                  if (file.size > 10 * 1024 * 1024)
                    throw Error("SVG exceeds 10 MiB.");
                  const r = await authFetch(`/api/v1/${root}`, {
                    method: "POST",
                    headers: { "Content-Type": "image/svg+xml" },
                    body: file,
                  });
                  const d = await r.json();
                  if (!r.ok) throw Error(d.error?.message || "Upload failed");
                  await loadVersions(project, d.id);
                }, "SVG detected. Review and calibrate this draft before publishing.");
              }}
            />
          </Label>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">
              Advanced detection pattern
            </summary>
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api(root, "PATCH", { plotNumberPattern: pattern });
                }, "Pattern saved for future uploads.");
              }}
            >
              <input
                aria-label="Plot number pattern"
                className={field}
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                maxLength={256}
              />
              <button className={secondary}>Save pattern</button>
            </form>
          </details>
        </Card>
        {review && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <strong>
                Version {review.version} · {review.status} · revision{" "}
                {review.revision}
              </strong>
              <span>{active.length} active plots</span>
              <button
                type="button"
                className={secondary}
                onClick={() => run(refresh, "Review refreshed.")}
              >
                Refresh review
              </button>
              {!editable && (
                <span className="text-sm">
                  Read-only. Upload a new version to change it.
                </span>
              )}
            </div>
            <Card title="Scale calibration">
              <form
                key={`${mapId}-${review.revision}`}
                className="grid gap-3 md:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(
                    () =>
                      edit({
                        action: "calibrate",
                        calibration: {
                          unit: f.get("unit"),
                          areaUnit: f.get("areaUnit"),
                          marlaSqFt: Number(f.get("marla")),
                          northUp: f.get("north") === "on",
                          ...(calibrationMode === "ratio"
                            ? { ratio: Number(f.get("ratio")) }
                            : { points, distance: Number(f.get("distance")) }),
                        },
                      }),
                    "Scale calibrated. Calculated values updated; official values kept separate.",
                  );
                }}
              >
                <Label name="Calibration method">
                  <select
                    className={field}
                    value={calibrationMode}
                    disabled={!editable}
                    onChange={(e) => setCalibrationMode(e.target.value)}
                  >
                    <option value="ratio">1 SVG unit = real distance</option>
                    <option value="points">
                      Pick 2 points + real distance
                    </option>
                  </select>
                </Label>
                <Label name="Real distance unit">
                  <select
                    name="unit"
                    className={field}
                    defaultValue={review.scale?.unit || "ft"}
                    disabled={!editable}
                  >
                    <option value="ft">Feet</option>
                    <option value="m">Meters</option>
                  </select>
                </Label>
                {calibrationMode === "ratio" ? (
                  <Label name="Real units per SVG unit">
                    <input
                      className={field}
                      name="ratio"
                      type="number"
                      step="any"
                      min="0.000000001"
                      max="1000000"
                      required
                      defaultValue={review.scale?.ratio || 1}
                      disabled={!editable}
                    />
                  </Label>
                ) : (
                  <div className="space-y-2">
                    <button
                      type="button"
                      className={secondary}
                      disabled={!editable}
                      onClick={() => {
                        setPoints([]);
                        setPickMode(true);
                      }}
                    >
                      Pick two points on preview
                    </button>
                    <p className="text-xs" role="status">
                      {points.length}/2 points:{" "}
                      {points
                        .map((p) => p.map((v) => v.toFixed(2)).join(", "))
                        .join(" → ")}
                    </p>
                    <Label name="Real distance between points">
                      <input
                        name="distance"
                        type="number"
                        step="any"
                        min="0.000001"
                        required
                        className={field}
                        disabled={!editable}
                      />
                    </Label>
                  </div>
                )}
                <Label name="Display / price area unit">
                  <select
                    className={field}
                    name="areaUnit"
                    defaultValue={
                      review.scale?.areaUnit || review.defaults.areaUnit
                    }
                    disabled={!editable}
                  >
                    {["sqft", "sqm", "marla", "kanal"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </Label>
                <Label name="Square feet per marla (org default)">
                  <input
                    name="marla"
                    className={field}
                    type="number"
                    min="0.001"
                    max="10000"
                    step="any"
                    defaultValue={
                      review.scale?.marlaSqFt || review.defaults.marlaSqFt
                    }
                    required
                    disabled={!editable}
                  />
                </Label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    name="north"
                    type="checkbox"
                    defaultChecked={review.scale?.northUp}
                    disabled={!editable}
                  />{" "}
                  SVG top is north (for road-facing estimate)
                </label>
                <button
                  disabled={
                    !editable ||
                    (calibrationMode === "points" && points.length !== 2)
                  }
                  className={button}
                >
                  Apply calibration
                </button>
              </form>
              <p className="text-xs text-slate-500">
                1 kanal = 20 marla. Geometry and road hints are approximate, not
                survey/legal measurements. Official values override calculated
                values; both remain visible.
              </p>
            </Card>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
              <Card title="Sanitized SVG review">
                <p className="text-sm">
                  {pickMode
                    ? "Select two points on the map for calibration."
                    : "Click a highlighted plot or an unassigned SVG shape to review. Cyan = selected; blue = detected. Excluded shapes have no overlay."}
                </p>
                <div
                  className="relative h-[430px] w-full overflow-hidden rounded-xl border bg-slate-50"
                  data-testid="plot-review-preview"
                >
                  {/* Only authenticated server-sanitized SVG reaches this sink. Never use uploaded file text here. */}
                  <div
                    className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: svg }}
                    onClick={(e) => {
                      if (!pickMode) {
                        const el = (e.target as Element).closest("[id]");
                        if (
                          el &&
                          review.shapes.some((s) => s.elementId === el.id)
                        )
                          choose(el.id);
                      }
                    }}
                  />
                  <svg
                    ref={overlay}
                    className={`absolute inset-0 h-full w-full ${pickMode ? "cursor-crosshair" : "pointer-events-none"}`}
                    viewBox={review.viewBox.join(" ")}
                    aria-label="Detected plot review overlay"
                    onClick={(e) => {
                      if (!pickMode || !overlay.current) return;
                      const matrix = overlay.current.getScreenCTM();
                      if (!matrix) return;
                      const p = new DOMPoint(
                        e.clientX,
                        e.clientY,
                      ).matrixTransform(matrix.inverse());
                      const next = [...points, [p.x, p.y] as Point].slice(0, 2);
                      setPoints(next);
                      if (next.length === 2) setPickMode(false);
                    }}
                  >
                    {active.map((p) => (
                      <path
                        key={p.id}
                        d={path(p.rings)}
                        fillRule={p.fillRule}
                        fill={
                          selected.includes(p.elementId) ? "#0891b2" : "#2563eb"
                        }
                        fillOpacity="0.25"
                        stroke={
                          selected.includes(p.elementId) ? "#0e7490" : "#1d4ed8"
                        }
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                        className={
                          pickMode ? "" : "pointer-events-auto cursor-pointer"
                        }
                        tabIndex={pickMode ? -1 : 0}
                        role="button"
                        aria-label={`Review plot ${p.plotNumber}`}
                        onClick={(e) => {
                          if (!pickMode) {
                            e.stopPropagation();
                            choose(p.elementId);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            choose(p.elementId);
                          }
                        }}
                      >
                        <title>
                          Plot {p.plotNumber} · {p.method}
                        </title>
                      </path>
                    ))}
                    {points.map((p, i) => (
                      <circle
                        key={i}
                        cx={p[0]}
                        cy={p[1]}
                        r={review.viewBox[2] / 180}
                        fill="#dc2626"
                        pointerEvents="none"
                      />
                    ))}
                  </svg>
                </div>
                <Label name="Shape selector (includes excluded/non-plot shapes)">
                  <select
                    className={field}
                    value={shape}
                    onChange={(e) => choose(e.target.value)}
                  >
                    <option value="">Choose a shape</option>
                    {review.shapes.map((s) => (
                      <option key={s.elementId} value={s.elementId}>
                        {s.elementId} {s.sourceId}{" "}
                        {s.nonPlot ? "(non-plot layer)" : ""}
                      </option>
                    ))}
                    {review.plots
                      .filter(
                        (p) =>
                          !review.shapes.some(
                            (s) => s.elementId === p.elementId,
                          ),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.elementId}>
                          {p.plotNumber} ({p.method})
                        </option>
                      ))}
                  </select>
                </Label>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(
                      () =>
                        edit({
                          action: "assign",
                          elementId: shape,
                          plotNumber,
                        }),
                      "Plot number assigned.",
                    );
                  }}
                >
                  <input
                    aria-label="Assign plot number"
                    className={field}
                    value={plotNumber}
                    onChange={(e) => setPlotNumber(e.target.value)}
                    placeholder="Plot number"
                    required
                    maxLength={64}
                    disabled={!editable}
                  />
                  <button className={button} disabled={!editable || !shape}>
                    Assign / fix number
                  </button>
                  <button
                    type="button"
                    className={secondary}
                    disabled={!editable || (!shape && !selected.length)}
                    onClick={() =>
                      run(
                        () =>
                          edit({
                            action: "exclude",
                            elementIds: selected.length ? selected : [shape],
                          }),
                        "Marked not a plot.",
                      )
                    }
                  >
                    Mark not a plot
                  </button>
                </form>
              </Card>
              <Card title="Official plot data / bulk edit">
                <p className="text-sm">
                  {selected.length} selected. Blank fields mean no change;
                  enable a clear checkbox to remove an official override. Money
                  is integer PKR minor units (100 paisa = PKR 1).
                </p>
                {chosen?.calculated && (
                  <div className="rounded-lg bg-blue-50 p-3 text-sm space-y-1">
                    <p>
                      Calculated: {round(chosen.calculated.area.value)}{" "}
                      {chosen.calculated.area.unit} ·{" "}
                      {round(chosen.calculated.dimensions.width)} ×{" "}
                      {round(chosen.calculated.dimensions.length)}{" "}
                      {chosen.calculated.dimensions.unit}
                    </p>
                    <p>
                      Official: {chosen.data.area_official ?? "not set"}{" "}
                      {chosen.data.area_unit || review.scale?.areaUnit} ·{" "}
                      {chosen.data.dimensions_official || "not set"}
                    </p>
                    <p>
                      Road-facing estimate:{" "}
                      {chosen.calculated.facingCalculated || "unknown"} ·
                      corner:{" "}
                      {chosen.calculated.cornerCalculated === null
                        ? "unknown"
                        : chosen.calculated.cornerCalculated
                          ? "yes"
                          : "no"}
                    </p>
                  </div>
                )}
                <form
                  key={shape + review.revision}
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget),
                      data: Record<string, unknown> = {};
                    for (const k of [
                      "block",
                      "phase",
                      "street",
                      "area_official",
                      "dimensions_official",
                      "facing",
                      "price_per_unit_minor",
                      "total_price_minor",
                      "is_corner",
                      "category",
                      "status",
                      "area_unit",
                    ]) {
                      const v = String(f.get(k) || "");
                      if (f.get("clear_" + k) === "on" || v === "__clear__")
                        data[k] = null;
                      else if (v !== "")
                        data[k] = [
                          "area_official",
                          "price_per_unit_minor",
                          "total_price_minor",
                          "is_corner",
                        ].includes(k)
                          ? Number(v)
                          : v;
                    }
                    run(
                      () =>
                        edit({ action: "bulk", elementIds: selected, data }),
                      "Draft official data updated. Publish to apply it.",
                    );
                  }}
                >
                  {[
                    "block",
                    "phase",
                    "street",
                    "area_official",
                    "dimensions_official",
                    "facing",
                    "price_per_unit_minor",
                    "total_price_minor",
                  ].map((k) => (
                    <div key={k}>
                      <Label name={k.replaceAll("_", " ")}>
                        <input
                          name={k}
                          className={field}
                          disabled={!editable}
                          type={
                            [
                              "area_official",
                              "price_per_unit_minor",
                              "total_price_minor",
                            ].includes(k)
                              ? "number"
                              : "text"
                          }
                          min={k === "area_official" ? "0.000001" : "0"}
                          step={k === "area_official" ? "any" : "1"}
                          maxLength={k === "dimensions_official" ? 500 : 200}
                          placeholder={
                            chosen?.data[k as keyof Data]?.toString() ||
                            "No change"
                          }
                        />
                      </Label>
                      <label className="text-xs">
                        <input
                          name={"clear_" + k}
                          type="checkbox"
                          disabled={!editable}
                        />{" "}
                        Clear official value
                      </label>
                    </div>
                  ))}
                  <Label name="Official area / price unit">
                    <select
                      className={field}
                      name="area_unit"
                      disabled={!editable}
                    >
                      <option value="">No change</option>
                      {["sqft", "sqm", "marla", "kanal"].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </Label>
                  <Label name="Official corner">
                    <select
                      className={field}
                      name="is_corner"
                      disabled={!editable}
                    >
                      <option value="">No change</option>
                      <option value="__clear__">
                        Use calculated / unknown
                      </option>
                      <option value="1">Yes</option>
                      <option value="0">No</option>
                    </select>
                  </Label>
                  <Label name="Category">
                    <select
                      className={field}
                      name="category"
                      disabled={!editable}
                    >
                      <option value="">No change</option>
                      <option>residential</option>
                      <option>commercial</option>
                    </select>
                  </Label>
                  <Label name="Inventory status">
                    <select
                      className={field}
                      name="status"
                      disabled={!editable}
                    >
                      <option value="">No change</option>
                      <option>available</option>
                      <option>blocked</option>
                    </select>
                  </Label>
                  <button
                    className={button}
                    disabled={!editable || !selected.length}
                  >
                    Apply to selected
                  </button>
                </form>
              </Card>
            </div>
            <Card title="Plot candidates">
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label="Find plot in review table"
                  className={field}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter table by plot number"
                />
                <button
                  type="button"
                  className={secondary}
                  disabled={!editable}
                  onClick={() =>
                    setSelected(visible.slice(0, 500).map((p) => p.elementId))
                  }
                >
                  Select filtered (max 500)
                </button>
                <button
                  type="button"
                  className={secondary}
                  onClick={() => setSelected([])}
                >
                  Clear selection
                </button>
              </div>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        "Select",
                        "Plot",
                        "Method / confidence",
                        "Calculated area",
                        "Official area",
                        "Status",
                      ].map((h) => (
                        <th key={h} className="p-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr
                        key={p.id}
                        className={
                          selected.includes(p.elementId)
                            ? "bg-cyan-50"
                            : "border-t"
                        }
                      >
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Select plot ${p.plotNumber}`}
                            checked={selected.includes(p.elementId)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, p.elementId]
                                  : selected.filter((id) => id !== p.elementId),
                              )
                            }
                          />
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="font-semibold underline"
                            onClick={() => choose(p.elementId)}
                          >
                            {p.plotNumber || "(no number)"}
                          </button>
                        </td>
                        <td className="p-2">
                          {p.method} · {round(p.confidence * 100)}%
                        </td>
                        <td className="p-2">
                          {p.calculated
                            ? `${round(p.calculated.area.value)} ${p.calculated.area.unit}`
                            : `${round(p.areaSvg)} SVG²`}
                        </td>
                        <td className="p-2">
                          {p.data.area_official ?? "—"}{" "}
                          {p.data.area_official
                            ? p.data.area_unit || review.scale?.areaUnit
                            : ""}
                        </td>
                        <td className="p-2">{p.data.status || "available"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Merge / split selected plots">
              <div className="grid gap-4 md:grid-cols-2">
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(
                      () =>
                        edit({
                          action: "merge",
                          elementIds: selected,
                          plotNumber: f.get("number"),
                        }),
                      "Merged geometry created. Review any protected identity/removal warnings.",
                    );
                  }}
                >
                  <Label name="Merged plot number">
                    <input
                      name="number"
                      required
                      className={field}
                      disabled={!editable}
                    />
                  </Label>
                  <button
                    className={secondary}
                    disabled={
                      !editable || selected.length < 2 || selected.length > 50
                    }
                  >
                    Merge selected ({selected.length})
                  </button>
                </form>
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(
                      () =>
                        edit({
                          action: "split",
                          elementId: selected[0],
                          axis,
                          at: Number(f.get("at")),
                          numbers: [f.get("one"), f.get("two")],
                        }),
                      "Split geometry created. Review both new plots.",
                    );
                  }}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Label name="Split axis">
                      <select
                        className={field}
                        value={axis}
                        disabled={!editable}
                        onChange={(e) => setAxis(e.target.value)}
                      >
                        <option value="x">Vertical (X)</option>
                        <option value="y">Horizontal (Y)</option>
                      </select>
                    </Label>
                    <Label name="SVG split coordinate">
                      <input
                        key={shape + axis}
                        className={field}
                        name="at"
                        type="number"
                        step="any"
                        required
                        defaultValue={
                          chosen
                            ? (chosen.bbox[axis === "x" ? 0 : 1] +
                                chosen.bbox[axis === "x" ? 2 : 3]) /
                              2
                            : ""
                        }
                        disabled={!editable}
                      />
                    </Label>
                    <Label name="First new plot number">
                      <input
                        name="one"
                        className={field}
                        required
                        disabled={!editable}
                      />
                    </Label>
                    <Label name="Second new plot number">
                      <input
                        name="two"
                        className={field}
                        required
                        disabled={!editable}
                      />
                    </Label>
                  </div>
                  <button
                    className={secondary}
                    disabled={!editable || selected.length !== 1}
                  >
                    Split one selected plot
                  </button>
                </form>
              </div>
              <p className="text-xs text-slate-500">
                Boolean geometry operations preserve holes. Splits create two
                halves along the selected SVG axis. New geometry gets real
                internal SVG path IDs. Original source remains private and
                unchanged.
              </p>
            </Card>
            <Card title="CSV / Excel exchange">
              <button
                type="button"
                className={secondary}
                onClick={() => run(download, "CSV exported.")}
              >
                Export CSV for Excel
              </button>
              <Label name="Import UTF-8 CSV (match by plot_number)">
                <input
                  className={field}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={!editable}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f)
                      run(async () => {
                        if (f.size > 950000) throw Error("CSV exceeds 950 KB.");
                        await api(`${base}/csv`, "POST", {
                          revision: review.revision,
                          csv: await f.text(),
                        });
                        await refresh();
                      }, "CSV imported atomically into this draft.");
                  }}
                />
              </Label>
              <p className="text-xs">
                Export a template, edit it in Excel, then Save As CSV UTF-8.
                Blank cells do not change data. Money columns are integer minor
                units; no currency symbols/formulas. Booking/sale statuses
                cannot be fabricated through imports.
              </p>
            </Card>
            <Card title="Validation, version diff & publish">
              <p>
                {review.validation.errors.length} blocking errors ·{" "}
                {review.validation.warnings.length} warnings
              </p>
              <ul className="max-h-64 overflow-auto space-y-1 text-sm">
                {review.validation.errors.map((v, i) => (
                  <li key={"e" + i} className="text-red-800">
                    Error: {v.message}
                  </li>
                ))}
                {review.validation.warnings.map((v, i) => (
                  <li key={"w" + i} className="text-amber-900">
                    Warning: {v.message}{" "}
                    {v.elementId && (
                      <button
                        className="underline"
                        type="button"
                        onClick={() => choose(v.elementId!)}
                      >
                        Select shape
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["added", "removed", "changed", "unchanged"] as const).map(
                  (k) => (
                    <div key={k} className="rounded-lg bg-slate-50 p-3 text-sm">
                      <strong className="capitalize">
                        {k}: {review.diff[k].length}
                      </strong>
                      <p className="max-h-24 overflow-auto break-words">
                        {review.diff[k].join(", ") || "None"}
                      </p>
                    </div>
                  ),
                )}
              </div>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={keep}
                  disabled={!editable}
                  onChange={(e) => setKeep(e.target.checked)}
                />
                Keep existing plot data where numbers match (IDs, bookings,
                sales and history are never replaced)
              </label>
              {!!review.diff.removed.length && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ackRemoved}
                    disabled={!editable}
                    onChange={(e) => setAckRemoved(e.target.checked)}
                  />
                  I reviewed removed plots. Plots with business history must
                  remain; unused removed plots are archived, not erased.
                </label>
              )}
              {!!review.validation.warnings.length && (
                <>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={accept}
                      disabled={!editable}
                      onChange={(e) => setAccept(e.target.checked)}
                    />
                    I reviewed and accept the listed warnings
                  </label>
                  <Label name="Warning acceptance reason (audited)">
                    <input
                      className={field}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={3}
                      maxLength={1000}
                      disabled={!editable}
                    />
                  </Label>
                </>
              )}
              <button
                className={button}
                type="button"
                disabled={
                  !editable ||
                  review.validation.errors.length > 0 ||
                  (review.validation.warnings.length > 0 &&
                    (!accept || reason.trim().length < 3)) ||
                  (review.diff.removed.length > 0 && !ackRemoved)
                }
                onClick={() => {
                  if (
                    !window.confirm(
                      `Publish version ${review.version} with ${active.length} plots? This updates live inventory; the previous map will be archived.`,
                    )
                  )
                    return;
                  run(async () => {
                    await api(`${base}/publish`, "POST", {
                      revision: review.revision,
                      baselineMapId: review.diff.baselineMapId,
                      keepExistingData: keep,
                      acceptWarnings: accept,
                      warningReason: reason,
                      acknowledgeRemoved: ackRemoved,
                    });
                    await loadVersions(project, mapId);
                    await refresh();
                  }, "Map published. Existing matching plot identities and business history preserved.");
                }}
              >
                Publish map
              </button>
            </Card>
          </>
        )}
      </fieldset>
    </div>
  );
}
