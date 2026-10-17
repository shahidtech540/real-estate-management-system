import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { SaxesParser } from "saxes";
import { HttpError } from "@/server/auth/guards";
export const MAX_SVG_BYTES = 10 * 1024 * 1024;
export const SVG_NS = "http://www.w3.org/2000/svg";
// No resources/runScripts option: uploaded XML must never execute or fetch anything.
const window = new JSDOM("").window;
const purifier = createDOMPurify(window);
const fail = (message: string): never => {
  throw new HttpError(400, "INVALID_SVG", message);
};
export function parseSvg(source: string): Document {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(source))
    fail("DOCTYPE/entity declarations are not permitted.");
  // Preflight without building a DOM: reject depth/node bombs before jsdom parses.
  let depth = 0,
    nodes = 0;
  const preflight = new SaxesParser({ xmlns: true });
  preflight.on("opentag", () => {
    if (++depth > 64 || ++nodes > 25000)
      throw new HttpError(
        413,
        "SVG_COMPLEXITY",
        "SVG nesting/elements exceed the 64 / 25,000 limits.",
      );
  });
  preflight.on("closetag", () => {
    depth--;
  });
  try {
    preflight.write(source).close();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail("SVG XML is malformed.");
  }
  const doc = new window.DOMParser().parseFromString(source, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg" ||
    doc.documentElement.namespaceURI !== SVG_NS
  )
    fail("Upload a well-formed SVG XML document with the SVG namespace.");
  const elements = [...doc.querySelectorAll("*")];
  if (elements.length > 25000)
    throw new HttpError(413, "SVG_COMPLEXITY", "SVG limit: 25,000 elements.");
  for (const el of elements) {
    let depth = 0;
    for (let p = el.parentElement; p; p = p.parentElement)
      if (++depth > 64)
        throw new HttpError(
          413,
          "SVG_COMPLEXITY",
          "SVG nesting exceeds 64 levels.",
        );
  }
  return doc;
}
export function sanitizeSvg(source: string) {
  if (!source.trim() || Buffer.byteLength(source, "utf8") > MAX_SVG_BYTES)
    throw new HttpError(
      413,
      "SVG_SIZE",
      "SVG uploads must be non-empty and at most 10 MiB.",
    );
  parseSvg(source);
  const clean = purifier.sanitize(source, {
    USE_PROFILES: { svg: true },
    FORBID_TAGS: [
      "script",
      "foreignObject",
      "style",
      "image",
      "use",
      "a",
      "animate",
      "animateMotion",
      "animateTransform",
      "set",
      "mpath",
      "feImage",
    ],
    FORBID_ATTR: ["style", "href", "xlink:href", "src"],
    ALLOW_DATA_ATTR: true,
  });
  const removed = purifier.removed.length,
    doc = parseSvg(clean);
  // Intentionally stricter than DOMPurify: no CSS/URL resource mechanisms at all,
  // including otherwise-safe fragment URLs. Keep ordinary fill/stroke and geometry.
  for (const el of [...doc.querySelectorAll("*")]) {
    if (el !== doc.documentElement && el.localName === "svg")
      fail("Nested SVG viewports must be flattened before upload.");
    for (const attr of [...el.attributes])
      if (
        attr.value.includes("\\") ||
        /^on/i.test(attr.name) ||
        /href|^src$|^style$/i.test(attr.name) ||
        /url\s*\(|javascript\s*:|@import|@font-face/i.test(attr.value)
      )
        el.removeAttributeNode(attr);
  }
  let index = 0;
  for (const el of [...doc.querySelectorAll("*")]) {
    el.setAttribute("data-source-id", el.getAttribute("id") || "");
    el.setAttribute("id", `pm-${index++}`);
  }
  const sanitized = new window.XMLSerializer().serializeToString(doc);
  return { doc, sanitized, removed };
}
export async function readSvgUpload(req: Request) {
  if (
    (req.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase() !== "image/svg+xml"
  )
    throw new HttpError(
      415,
      "SVG_CONTENT_TYPE",
      "Send the SVG bytes with Content-Type: image/svg+xml.",
    );
  const length = req.headers.get("content-length");
  if (length && Number(length) > MAX_SVG_BYTES)
    throw new HttpError(413, "SVG_SIZE", "Maximum SVG upload: 10 MiB.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "INVALID_SVG", "SVG body required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_SVG_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "SVG_SIZE", "Maximum SVG upload: 10 MiB.");
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    return fail("SVG must be UTF-8.");
  }
}
