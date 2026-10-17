import { getDb } from "@/server/db";
import { HttpError } from "@/server/auth/guards";
import { newId, nowIso } from "../shared/domain";
import type { BookingFileInput } from "@/lib/plot-booking";
export function validateBookingFiles(files: BookingFileInput[]) {
  return files.map((file) => {
    const bytes = Buffer.from(file.base64, "base64");
    const canonical = bytes.toString("base64");
    const signature =
      file.mimeType === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : file.mimeType === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (
      !bytes.length ||
      bytes.length > 2 * 1024 * 1024 ||
      canonical !== file.base64 ||
      !signature
    )
      throw new HttpError(
        400,
        "INVALID_ATTACHMENT",
        "Each attachment must be a matching PDF, PNG or JPEG, at most 2 MiB, in canonical base64.",
      );
    return { ...file, bytes };
  });
}
export function saveBookingFile(
  org: string,
  actor: string,
  bookingId: string,
  kind: string,
  name: string,
  mime: string,
  bytes: Buffer,
) {
  const id = newId("doc"),
    now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO documents(id,organization_id,entity_type,entity_id,title,category,version,storage_key,mime_type,size_bytes,tags_json,created_at,updated_at,created_by) VALUES(?,?,'plot_booking',?,?,?,1,?,?,?,'[]',?,?,?)`,
    )
    .run(
      id,
      org,
      bookingId,
      name,
      kind,
      `private-db:plot-booking/${id}`,
      mime,
      bytes.length,
      now,
      now,
      actor,
    );
  getDb()
    .prepare(
      "INSERT INTO plot_booking_files(organization_id,booking_id,document_id,kind,content,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(org, bookingId, id, kind, bytes, now, now, actor);
  return id;
}
