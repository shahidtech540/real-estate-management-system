import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { NextResponse } from "next/server";
// The contract template is English; tenant identity in Unicode remains available in the JSON record.
export async function pdfResponse(
  title: string,
  lines: string[],
  filename: string,
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]),
    y = 790;
  const clean = (s: string) =>
    s.normalize("NFKD").replace(/[^\x20-\x7e]/g, "?");
  const draw = (text: string, heading = false) => {
    const words = clean(text).split(/\s+/);
    let line = "";
    for (const word of words) {
      if (
        (heading ? bold : font).widthOfTextAtSize(
          `${line} ${word}`,
          heading ? 14 : 10,
        ) > 490 &&
        line
      ) {
        render(line);
        line = word;
      } else line += `${line ? " " : ""}${word}`;
    }
    render(line);
    function render(value: string) {
      if (y < 65) {
        page = doc.addPage([595, 842]);
        y = 790;
      }
      page.drawText(value, {
        x: 50,
        y,
        size: heading ? 14 : 10,
        font: heading ? bold : font,
        color: rgb(0.12, 0.18, 0.26),
      });
      y -= heading ? 26 : 17;
    }
  };
  draw(title, true);
  lines.forEach((l) => {
    draw(l);
    y -= 5;
  });
  doc.setTitle(clean(title));
  doc.setProducer("PakLand REMS");
  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^a-zA-Z0-9_.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
