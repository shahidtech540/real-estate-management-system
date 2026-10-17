import { HttpError } from "@/server/auth/guards";
export const columns = [
  "plot_number",
  "block",
  "phase",
  "street",
  "area_official",
  "area_unit",
  "dimensions_official",
  "facing",
  "is_corner",
  "category",
  "price_per_unit_minor",
  "total_price_minor",
  "currency",
  "status",
] as const;
export function parseCsv(source: string): Record<string, string>[] {
  if (Buffer.byteLength(source) > 950000)
    throw new HttpError(413, "CSV_SIZE", "CSV limit is 950 KB.");
  source = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const push = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 32) throw Error("Too many CSV columns");
  };
  try {
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (quoted) {
        if (c === '"') {
          if (source[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
            closed = true;
          }
        } else cell += c;
      } else if (c === '"') {
        if (cell || closed) throw Error("Unexpected quote");
        quoted = true;
      } else if (c === ",") push();
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && source[i + 1] === "\n") i++;
        push();
        if (row.some((x) => x !== "")) rows.push(row);
        row = [];
        if (rows.length > 5001) throw Error("Maximum 5,000 data rows");
      } else {
        if (closed) throw Error("Unexpected characters after quote");
        cell += c;
      }
    }
    if (quoted) throw Error("Unclosed quoted field");
    push();
    if (row.some((x) => x !== "")) rows.push(row);
    const header = rows.shift();
    if (
      !header ||
      header[0] !== "plot_number" ||
      new Set(header).size !== header.length ||
      header.some((h) => !(columns as readonly string[]).includes(h))
    )
      throw Error(
        "Header must start with plot_number and contain only documented unique columns",
      );
    if (!rows.length || rows.length > 5000)
      throw Error("Provide 1–5,000 data rows");
    return rows.map((r, i) => {
      if (r.length !== header.length)
        throw Error(`Wrong column count at row ${i + 2}`);
      return Object.fromEntries(header.map((h, j) => [h, r[j]]));
    });
  } catch (e) {
    throw new HttpError(
      400,
      "CSV_INVALID",
      e instanceof Error ? e.message : "Invalid CSV",
    );
  }
}
export function exportCsv(rows: Record<string, unknown>[]) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      columns.join(","),
      ...rows.map((r) => columns.map((c) => cell(r[c])).join(",")),
    ].join("\r\n") +
    "\r\n"
  );
}
