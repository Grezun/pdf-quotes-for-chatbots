// The endpoint a chatbot's API Request element calls.
// POST { api_key?, customer_name, service, quantity?, price? }
// (api_key may instead come via X-Api-Key header)
// → 200 { pdf_url, price, quote_id }  |  4xx { error }
import { json, serviceClient } from "../_shared/db.ts";
import { computeTotal, formatMoney, type Service } from "../_shared/pricing.ts";
import { renderQuotePdf } from "../_shared/pdf.ts";
import { loadFonts } from "../_shared/fonts.ts";

const SIGNED_URL_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const apiKey = (typeof body.api_key === "string" && body.api_key) ||
    req.headers.get("x-api-key") || "";
  if (!apiKey) return json({ error: "missing_api_key" }, 401);

  const db = serviceClient();
  const { data: install } = await db
    .from("installs")
    .select("id, status, settings(*)")
    .eq("api_key", apiKey)
    .maybeSingle();
  if (!install || install.status !== "active") {
    return json({ error: "invalid_api_key" }, 401);
  }
  const settings = Array.isArray(install.settings) ? install.settings[0] : install.settings;
  if (!settings) return json({ error: "not_configured" }, 409);

  const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  const serviceName = typeof body.service === "string" ? body.service.trim() : "";
  if (!customerName || customerName.length > 120) {
    return json({ error: "customer_name is required (max 120 chars)" }, 400);
  }
  if (!serviceName) return json({ error: "service is required" }, 400);

  const services = (settings.services ?? []) as Service[];
  const quantity = toNumber(body.quantity);
  const priceOverride = toNumber(body.price);

  let service: Service, total: number;
  try {
    ({ service, total } = computeTotal(services, serviceName, quantity, priceOverride));
  } catch {
    return json(
      { error: "unknown_service", known_services: services.map((s) => s.name) },
      400,
    );
  }

  // Logo + fonts for the PDF
  let logoBytes: Uint8Array | null = null;
  let logoType: "png" | "jpeg" | null = null;
  if (settings.logo_path) {
    const { data } = await db.storage.from("logos").download(settings.logo_path);
    if (data) {
      logoBytes = new Uint8Array(await data.arrayBuffer());
      logoType = settings.logo_path.toLowerCase().endsWith(".png") ? "png" : "jpeg";
    }
  }
  const fonts = await loadFonts(db);

  const quoteId = crypto.randomUUID();
  const now = new Date();
  const date = now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const quoteNumber = `Q-${now.getFullYear()}-${quoteId.slice(0, 6).toUpperCase()}`;

  const pdfBytes = await renderQuotePdf({
    company: {
      name: settings.company_name,
      email: settings.email,
      phone: settings.phone,
      website: settings.website,
      address: settings.address,
      brand_color: settings.brand_color,
      footer_note: settings.footer_note,
      logoBytes,
      logoType,
    },
    customer_name: customerName,
    service_name: service.name,
    quantity,
    unit_label: service.unit_label,
    unit_price: service.unit_price,
    base_price: service.base_price,
    total,
    currency: settings.currency,
    quote_number: quoteNumber,
    date,
    fonts,
  });

  const pdfPath = `${install.id}/${quoteId}.pdf`;
  const { error: upErr } = await db.storage.from("quotes").upload(pdfPath, pdfBytes, {
    contentType: "application/pdf",
  });
  if (upErr) {
    console.error("pdf upload failed", upErr);
    return json({ error: "pdf_storage_failed" }, 500);
  }

  const { data: signed, error: signErr } = await db.storage
    .from("quotes")
    .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS, { download: `quote-${quoteNumber}.pdf` });
  if (signErr || !signed) {
    console.error("sign url failed", signErr);
    return json({ error: "pdf_link_failed" }, 500);
  }

  await db.from("quotes").insert({
    id: quoteId,
    install_id: install.id,
    customer_name: customerName,
    service_name: service.name,
    quantity: quantity ?? null,
    total,
    currency: settings.currency,
    pdf_path: pdfPath,
  });

  return json({
    pdf_url: signed.signedUrl,
    price: formatMoney(total, settings.currency),
    quote_id: quoteNumber,
  });
});
