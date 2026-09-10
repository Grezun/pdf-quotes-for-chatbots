// Renders the fixed quote template with pdf-lib (A4). Uses supplied Unicode
// fonts when given, otherwise falls back to built-in Helvetica (Latin-1 only).
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { formatMoney } from "./pricing.ts";

export type QuotePdfInput = {
  company: {
    name: string;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    address?: string | null;
    brand_color?: string | null;
    footer_note?: string | null;
    logoBytes?: Uint8Array | null;
    logoType?: "png" | "jpeg" | null;
  };
  customer_name: string;
  service_name: string;
  quantity?: number | null;
  unit_label?: string | null;
  unit_price?: number | null;
  base_price?: number | null;
  total: number;
  currency: string;
  quote_number: string;
  date: string; // already formatted, e.g. "10 Sep 2026"
  // Unicode fonts (e.g. Noto Sans TTF bytes). Without them Helvetica is used,
  // which only encodes Latin-1 — non-Latin text is transliterated to "?".
  fonts?: { regular: Uint8Array; bold: Uint8Array } | null;
};

function hexToRgb(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return rgb(0.145, 0.388, 0.922); // default #2563eb
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 50;
const GRAY = rgb(0.42, 0.45, 0.5);
const DARK = rgb(0.12, 0.16, 0.22);

export async function renderQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4.w, A4.h]);
  let font: PDFFont, bold: PDFFont;
  if (input.fonts) {
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(input.fonts.regular, { subset: true });
    bold = await doc.embedFont(input.fonts.bold, { subset: true });
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  const brand = hexToRgb(input.company.brand_color);
  const safe = (t: string) => (input.fonts ? t : latin1Safe(t));

  // Header band
  page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: brand });

  let y = A4.h - 60;

  // Logo (left) — fit into 140×56; without a logo the company name takes its place
  let logoDrawn = false;
  if (input.company.logoBytes?.length) {
    try {
      const img = input.company.logoType === "jpeg"
        ? await doc.embedJpg(input.company.logoBytes)
        : await doc.embedPng(input.company.logoBytes);
      const scale = Math.min(140 / img.width, 56 / img.height, 1);
      page.drawImage(img, {
        x: MARGIN,
        y: y - img.height * scale + 10,
        width: img.width * scale,
        height: img.height * scale,
      });
      logoDrawn = true;
    } catch (e) {
      console.error("logo embed failed", e);
    }
  }
  if (!logoDrawn) {
    page.drawText(safe(input.company.name), { x: MARGIN, y: y - 10, size: 20, font: bold, color: DARK });
  }

  // Company block (right, right-aligned); name only repeated when a logo holds the left slot
  const companyLines = [
    logoDrawn ? input.company.name : null,
    input.company.address,
    input.company.phone,
    input.company.email,
    input.company.website,
  ].filter((v): v is string => !!v && v.trim().length > 0);
  let cy = y;
  for (const [i, line] of companyLines.entries()) {
    const isName = logoDrawn && i === 0;
    const f = isName ? bold : font;
    const size = isName ? 11 : 9;
    const text = safe(line);
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: A4.w - MARGIN - w, y: cy, size, font: f, color: isName ? DARK : GRAY });
    cy -= isName ? 16 : 13;
  }

  // Title
  y -= 110;
  page.drawText("QUOTE", { x: MARGIN, y, size: 30, font: bold, color: brand });
  const meta = `#${input.quote_number}   ·   ${input.date}`;
  page.drawText(meta, { x: MARGIN, y: y - 20, size: 10, font, color: GRAY });

  // Customer block
  y -= 70;
  page.drawText("PREPARED FOR", { x: MARGIN, y, size: 8.5, font: bold, color: GRAY });
  page.drawText(safe(input.customer_name), { x: MARGIN, y: y - 17, size: 14, font: bold, color: DARK });

  // Line-item table
  y -= 70;
  const col = { item: MARGIN, qty: 330, unit: 400, amount: A4.w - MARGIN };
  page.drawRectangle({ x: MARGIN - 10, y: y - 6, width: A4.w - 2 * MARGIN + 20, height: 24, color: brand, opacity: 0.08 });
  page.drawText("SERVICE", { x: col.item, y, size: 8.5, font: bold, color: GRAY });
  page.drawText("QTY", { x: col.qty, y, size: 8.5, font: bold, color: GRAY });
  page.drawText("UNIT PRICE", { x: col.unit, y, size: 8.5, font: bold, color: GRAY });
  drawRight(page, "AMOUNT", col.amount, y, 8.5, bold, GRAY);

  y -= 26;
  const qty = input.quantity ?? 0;
  const hasUnits = qty > 0 && (input.unit_price ?? 0) > 0;
  const qtyText = safe(hasUnits ? `${qty}${input.unit_label ? " " + input.unit_label : ""}` : "—");
  const unitText = safe(hasUnits ? formatMoney(input.unit_price!, input.currency) : "—");
  page.drawText(fit(safe(input.service_name), font, 10.5, col.qty - col.item - 15), {
    x: col.item, y, size: 10.5, font, color: DARK,
  });
  page.drawText(qtyText, { x: col.qty, y, size: 10.5, font, color: DARK });
  page.drawText(unitText, { x: col.unit, y, size: 10.5, font, color: DARK });
  drawRight(page, safe(formatMoney(input.total, input.currency)), col.amount, y, 10.5, font, DARK);
  if (hasUnits && (input.base_price ?? 0) > 0) {
    y -= 16;
    page.drawText(safe(`Includes base fee ${formatMoney(input.base_price!, input.currency)}`), {
      x: col.item, y, size: 8.5, font, color: GRAY,
    });
  }

  // Divider + total
  y -= 24;
  page.drawLine({
    start: { x: MARGIN - 10, y },
    end: { x: A4.w - MARGIN + 10, y },
    thickness: 0.75,
    color: rgb(0.85, 0.87, 0.9),
  });
  y -= 30;
  page.drawText("TOTAL", { x: col.unit, y, size: 11, font: bold, color: DARK });
  drawRight(page, safe(formatMoney(input.total, input.currency)), col.amount, y, 16, bold, brand);

  // Footer
  const footer = input.company.footer_note?.trim();
  if (footer) {
    page.drawText(fit(safe(footer), font, 9.5, A4.w - 2 * MARGIN), {
      x: MARGIN, y: 90, size: 9.5, font, color: GRAY,
    });
  }
  page.drawLine({
    start: { x: MARGIN, y: 70 },
    end: { x: A4.w - MARGIN, y: 70 },
    thickness: 0.5,
    color: rgb(0.85, 0.87, 0.9),
  });
  page.drawText(safe(`Generated for ${input.customer_name} on ${input.date}`), {
    x: MARGIN, y: 54, size: 8, font, color: GRAY,
  });

  return await doc.save();
}

function drawRight(page: PDFPage, text: string, rightX: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y, size, font, color });
}

// Replace characters Helvetica (WinAnsi/Latin-1) can't encode, so rendering
// never crashes when no Unicode font is available.
function latin1Safe(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/[^\x20-\x7e\xa0-\xff–—‘’“”•…€]/g, "?");
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}
