// Renders the fixed quote template with pdf-lib (A4). Uses supplied Unicode
// fonts when given, otherwise falls back to built-in Helvetica (Latin-1 only).
// Hebrew is drawn with RTL word ordering, in mixed-font runs (the Hebrew face
// carries no Latin glyphs and vice versa).
import { PDFDocument, PDFFont, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
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
  // Full right-to-left document: Hebrew labels, mirrored layout.
  rtl?: boolean;
  fonts?: {
    regular: Uint8Array;
    bold: Uint8Array;
    hebRegular?: Uint8Array | null;
    hebBold?: Uint8Array | null;
  } | null;
};

// 'he' → RTL, 'en' → LTR, 'auto' (default) → RTL when the company name is Hebrew.
export function isRtlDoc(docLang: string | null | undefined, companyName: string): boolean {
  if (docLang === "he") return true;
  if (docLang === "en") return false;
  return /[֐-׿]/.test(companyName ?? "");
}

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
const HEB_CHAR = /[֐-׿]/;

type Weight = "reg" | "bold";
type Run = { text: string; font: PDFFont };

const LABELS = {
  en: {
    quote: "QUOTE",
    preparedFor: "PREPARED FOR",
    service: "SERVICE",
    qty: "QTY",
    unitPrice: "UNIT PRICE",
    amount: "AMOUNT",
    total: "TOTAL",
    includesBase: (fee: string) => `Includes base fee ${fee}`,
    generated: (name: string, date: string) => `Generated for ${name} on ${date}`,
  },
  he: {
    quote: "הצעת מחיר",
    preparedFor: "הוכן עבור",
    service: "שירות",
    qty: "כמות",
    unitPrice: "מחיר ליחידה",
    amount: "סכום",
    total: 'סה"כ',
    includesBase: (fee: string) => `כולל מחיר בסיס ${fee}`,
    generated: (name: string, date: string) => `הופק עבור ${name} בתאריך ${date}`,
  },
};

export async function renderQuotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4.w, A4.h]);

  let font: PDFFont, bold: PDFFont;
  let hebFont: PDFFont | null = null, hebBoldFont: PDFFont | null = null;
  if (input.fonts) {
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(input.fonts.regular, { subset: true });
    bold = await doc.embedFont(input.fonts.bold, { subset: true });
    if (input.fonts.hebRegular) hebFont = await doc.embedFont(input.fonts.hebRegular, { subset: true });
    if (input.fonts.hebBold) hebBoldFont = await doc.embedFont(input.fonts.hebBold, { subset: true });
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  const brand = hexToRgb(input.company.brand_color);

  // --- text pipeline -------------------------------------------------------
  // safe(): strip characters no loaded font can draw.
  const safe = (t: string) => {
    if (!input.fonts) return latin1Safe(t);
    if (!hebFont) return t.replace(/[֐-׿]/g, "?");
    return t;
  };
  // shape(): pdf-lib draws in logical order (left to right). For Hebrew,
  // reverse the word order and the characters inside Hebrew words so the text
  // reads correctly right-to-left; numbers and Latin words keep their order.
  const shape = (t: string) => {
    const s = safe(t);
    if (!HEB_CHAR.test(s)) return s;
    return s
      .split(/(\s+)/)
      .reverse()
      .map((w) => {
        if (!HEB_CHAR.test(w)) return w;
        const rev = Array.from(w).reverse().join("");
        // digits/Latin embedded in an RTL word keep their LTR order
        return rev.replace(/[0-9A-Za-z]+/g, (m) => Array.from(m).reverse().join(""));
      })
      .join("");
  };
  const pickFont = (heb: boolean, w: Weight): PDFFont =>
    heb ? (w === "bold" ? hebBoldFont ?? bold : hebFont ?? font) : (w === "bold" ? bold : font);
  // Split an already-shaped string into same-font runs (Hebrew vs everything
  // else) — the Hebrew face has no Latin/digit glyphs, so mixed strings must
  // switch fonts mid-line.
  const runsOf = (shaped: string, w: Weight): Run[] => {
    const runs: Run[] = [];
    let cur = "";
    let curHeb: boolean | null = null;
    for (const ch of shaped) {
      const heb = HEB_CHAR.test(ch); // everything else (digits, punctuation, spaces) → Latin face
      if (curHeb === null || heb === curHeb) {
        cur += ch;
        curHeb = heb;
      } else {
        runs.push({ text: cur, font: pickFont(curHeb, w) });
        cur = ch;
        curHeb = heb;
      }
    }
    if (cur) runs.push({ text: cur, font: pickFont(curHeb ?? false, w) });
    return runs;
  };
  const runs = (t: string, w: Weight = "reg") => runsOf(shape(t), w);
  const widthOf = (rs: Run[], size: number) =>
    rs.reduce((a, r) => a + r.font.widthOfTextAtSize(r.text, size), 0);
  const draw = (rs: Run[], x: number, y: number, size: number, color = DARK) => {
    let cx = x;
    for (const r of rs) {
      page.drawText(r.text, { x: cx, y, size, font: r.font, color });
      cx += r.font.widthOfTextAtSize(r.text, size);
    }
  };
  const drawRightRuns = (rs: Run[], rightX: number, y: number, size: number, color = DARK) =>
    draw(rs, rightX - widthOf(rs, size), y, size, color);
  // Truncate the logical string until its shaped runs fit maxWidth.
  const fitRuns = (t: string, w: Weight, size: number, maxWidth: number): Run[] => {
    let rs = runs(t, w);
    if (widthOf(rs, size) <= maxWidth) return rs;
    let s = t;
    while (s.length > 1) {
      s = s.slice(0, -1);
      rs = runs(s + "…", w);
      if (widthOf(rs, size) <= maxWidth) return rs;
    }
    return rs;
  };
  // -------------------------------------------------------------------------

  // RTL document mode: Hebrew labels + mirrored layout. Only meaningful when
  // the Hebrew font actually loaded.
  const rtl = !!input.rtl && hebFont !== null;
  const L = LABELS[rtl ? "he" : "en"];
  // "start" = reading start (left in LTR, right in RTL); "end" = the opposite.
  const drawStart = (rs: Run[], y: number, size: number, color = DARK) =>
    rtl ? drawRightRuns(rs, A4.w - MARGIN, y, size, color) : draw(rs, MARGIN, y, size, color);
  const drawEnd = (rs: Run[], y: number, size: number, color = DARK) =>
    rtl ? draw(rs, MARGIN, y, size, color) : drawRightRuns(rs, A4.w - MARGIN, y, size, color);

  // Header band
  page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: brand });

  let y = A4.h - 60;

  // Logo at the reading start; without a logo the company name takes its place
  let logoDrawn = false;
  if (input.company.logoBytes?.length) {
    try {
      const img = input.company.logoType === "jpeg"
        ? await doc.embedJpg(input.company.logoBytes)
        : await doc.embedPng(input.company.logoBytes);
      const scale = Math.min(140 / img.width, 56 / img.height, 1);
      const w = img.width * scale;
      page.drawImage(img, {
        x: rtl ? A4.w - MARGIN - w : MARGIN,
        y: y - img.height * scale + 10,
        width: w,
        height: img.height * scale,
      });
      logoDrawn = true;
    } catch (e) {
      console.error("logo embed failed", e);
    }
  }
  if (!logoDrawn) {
    drawStart(runs(input.company.name, "bold"), y - 10, 20, DARK);
  }

  // Company contact block at the reading end
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
    const size = isName ? 11 : 9;
    drawEnd(runs(line, isName ? "bold" : "reg"), cy, size, isName ? DARK : GRAY);
    cy -= isName ? 16 : 13;
  }

  // Title
  y -= 110;
  drawStart(runs(L.quote, "bold"), y, 30, brand);
  drawStart(runs(`#${input.quote_number}   ·   ${input.date}`), y - 20, 10, GRAY);

  // Customer block
  y -= 70;
  drawStart(runs(L.preparedFor, "bold"), y, 8.5, GRAY);
  drawStart(runs(input.customer_name, "bold"), y - 17, 14, DARK);

  // Line-item table. LTR columns: service 50↦, qty 330↦, unit 400↦, amount ↤545.
  // RTL mirrors each column across the page center.
  y -= 70;
  const QTY_X = 330, UNIT_X = 400;
  const putService = (rs: Run[], yy: number, size: number, color = DARK) =>
    rtl ? drawRightRuns(rs, A4.w - MARGIN, yy, size, color) : draw(rs, MARGIN, yy, size, color);
  const putQty = (rs: Run[], yy: number, size: number, color = DARK) =>
    rtl ? drawRightRuns(rs, A4.w - QTY_X, yy, size, color) : draw(rs, QTY_X, yy, size, color);
  const putUnit = (rs: Run[], yy: number, size: number, color = DARK) =>
    rtl ? drawRightRuns(rs, A4.w - UNIT_X, yy, size, color) : draw(rs, UNIT_X, yy, size, color);
  const putAmount = (rs: Run[], yy: number, size: number, color = DARK) =>
    rtl ? draw(rs, MARGIN, yy, size, color) : drawRightRuns(rs, A4.w - MARGIN, yy, size, color);

  page.drawRectangle({ x: MARGIN - 10, y: y - 6, width: A4.w - 2 * MARGIN + 20, height: 24, color: brand, opacity: 0.08 });
  putService(runs(L.service, "bold"), y, 8.5, GRAY);
  putQty(runs(L.qty, "bold"), y, 8.5, GRAY);
  putUnit(runs(L.unitPrice, "bold"), y, 8.5, GRAY);
  putAmount(runs(L.amount, "bold"), y, 8.5, GRAY);

  y -= 26;
  const qty = input.quantity ?? 0;
  const hasUnits = qty > 0 && (input.unit_price ?? 0) > 0;
  putService(fitRuns(input.service_name, "reg", 10.5, QTY_X - MARGIN - 15), y, 10.5, DARK);
  putQty(runs(hasUnits ? `${qty}${input.unit_label ? " " + input.unit_label : ""}` : "—"), y, 10.5, DARK);
  putUnit(runs(hasUnits ? formatMoney(input.unit_price!, input.currency) : "—"), y, 10.5, DARK);
  putAmount(runs(formatMoney(input.total, input.currency)), y, 10.5, DARK);
  if (hasUnits && (input.base_price ?? 0) > 0) {
    y -= 16;
    putService(runs(L.includesBase(formatMoney(input.base_price!, input.currency))), y, 8.5, GRAY);
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
  putUnit(runs(L.total, "bold"), y, 11, DARK);
  putAmount(runs(formatMoney(input.total, input.currency), "bold"), y, 16, brand);

  // Footer
  const footer = input.company.footer_note?.trim();
  if (footer) {
    const rs = fitRuns(footer, "reg", 9.5, A4.w - 2 * MARGIN);
    drawStart(rs, 90, 9.5, GRAY);
  }
  page.drawLine({
    start: { x: MARGIN, y: 70 },
    end: { x: A4.w - MARGIN, y: 70 },
    thickness: 0.5,
    color: rgb(0.85, 0.87, 0.9),
  });
  drawStart(runs(L.generated(input.customer_name, input.date)), 54, 8, GRAY);

  return await doc.save();
}

// Replace characters Helvetica (WinAnsi/Latin-1) can't encode, so rendering
// never crashes when no Unicode font is available.
function latin1Safe(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/[^\x20-\x7e\xa0-\xff–—‘’“”•…€]/g, "?");
}
