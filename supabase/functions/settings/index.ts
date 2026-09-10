// JSON API behind the static settings page (hosted on GitHub Pages — Supabase
// won't serve HTML on *.supabase.co). All routes authenticated by the
// install's settings_token; CORS is open because auth is token-based, not
// cookie-based.
//   OPTIONS *                → CORS preflight
//   GET  /settings?token=…    → { settings, api_key, quote_endpoint, logo_url }
//   POST /settings (multipart)→ { ok } | { error }   (fields + optional logo)
//   GET  /settings/preview?token=… → { preview_url } (signed, 1 h)
import { functionsBase, serviceClient } from "../_shared/db.ts";
import { isRtlDoc, renderQuotePdf } from "../_shared/pdf.ts";
import { loadFonts } from "../_shared/fonts.ts";
import type { Service } from "../_shared/pricing.ts";

const MAX_LOGO_BYTES = 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function findInstall(db: ReturnType<typeof serviceClient>, token: string | null) {
  if (!token) return null;
  const { data } = await db
    .from("installs")
    .select("id, api_key, status, settings(*)")
    .eq("settings_token", token)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  const settings = Array.isArray(data.settings) ? data.settings[0] : data.settings;
  if (!settings) return null;
  return { id: data.id, api_key: data.api_key, settings };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const db = serviceClient();

  if (req.method === "GET") {
    const install = await findInstall(db, url.searchParams.get("token"));
    if (!install) return json({ error: "invalid_token" }, 403);
    if (url.pathname.endsWith("/preview")) return await preview(db, install);

    let logoUrl: string | null = null;
    if (install.settings.logo_path) {
      const { data } = await db.storage.from("logos")
        .createSignedUrl(install.settings.logo_path, 3600);
      logoUrl = data?.signedUrl ?? null;
    }
    const { logo_path: _lp, install_id: _id, updated_at: _ua, ...settings } = install.settings;
    return json({
      settings,
      api_key: install.api_key,
      quote_endpoint: `${functionsBase()}/quote`,
      logo_url: logoUrl,
    });
  }

  if (req.method === "POST") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ error: "expected multipart form data" }, 400);
    }
    const install = await findInstall(db, String(form.get("token") ?? ""));
    if (!install) return json({ error: "invalid_token" }, 403);
    const err = await save(db, install, form);
    return err ? json({ error: err }, 400) : json({ ok: true });
  }

  return json({ error: "method_not_allowed" }, 405);
});

async function save(
  db: ReturnType<typeof serviceClient>,
  install: { id: string; settings: Record<string, unknown> },
  form: FormData,
): Promise<string | null> {
  const str = (k: string, max: number) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim().slice(0, max) : "";
  };

  const companyName = str("company_name", 120);
  if (!companyName) return "Company name is required.";

  const brandColor = /^#[0-9a-f]{6}$/i.test(str("brand_color", 7)) ? str("brand_color", 7) : "#2563eb";

  // Parallel arrays from the services table
  const names = form.getAll("svc_name").map((v) => String(v).trim().slice(0, 120));
  const bases = form.getAll("svc_base").map((v) => Number(String(v).replace(",", ".")));
  const units = form.getAll("svc_unit").map((v) => String(v).trim());
  const labels = form.getAll("svc_label").map((v) => String(v).trim().slice(0, 20));
  const services: Service[] = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    const base = Number.isFinite(bases[i]) && bases[i] >= 0 ? Math.round(bases[i] * 100) / 100 : 0;
    const svc: Service = { name: names[i], base_price: base };
    const unit = units[i] === "" ? NaN : Number(units[i].replace(",", "."));
    if (Number.isFinite(unit) && unit > 0) {
      svc.unit_price = Math.round(unit * 100) / 100;
      if (labels[i]) svc.unit_label = labels[i];
    }
    services.push(svc);
  }
  if (services.length === 0) return "Add at least one service with a name.";
  const seen = new Set<string>();
  for (const s of services) {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return `Duplicate service name: ${s.name}`;
    seen.add(key);
  }

  // Optional logo upload
  let logoPath = (install.settings.logo_path as string | null) ?? null;
  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > MAX_LOGO_BYTES) return "Logo is too large (max 1 MB).";
    const isPng = logo.type === "image/png";
    const isJpeg = logo.type === "image/jpeg";
    if (!isPng && !isJpeg) return "Logo must be a PNG or JPG image.";
    const path = `${install.id}/logo.${isPng ? "png" : "jpg"}`;
    const bytes = new Uint8Array(await logo.arrayBuffer());
    const { error } = await db.storage.from("logos").upload(path, bytes, {
      contentType: logo.type,
      upsert: true,
    });
    if (error) {
      console.error("logo upload failed", error);
      return "Logo upload failed, please try again.";
    }
    // Remove the other-extension variant so only one logo file remains
    const other = `${install.id}/logo.${isPng ? "jpg" : "png"}`;
    if (other !== path) await db.storage.from("logos").remove([other]);
    logoPath = path;
  }

  const { error } = await db.from("settings").update({
    company_name: companyName,
    email: str("email", 120) || null,
    phone: str("phone", 40) || null,
    website: str("website", 120) || null,
    address: str("address", 200) || null,
    brand_color: brandColor,
    currency: str("currency", 8) || "USD",
    doc_lang: ["auto", "en", "he"].includes(str("doc_lang", 4)) ? str("doc_lang", 4) : "auto",
    footer_note: str("footer_note", 300),
    services,
    logo_path: logoPath,
    updated_at: new Date().toISOString(),
  }).eq("install_id", install.id);
  if (error) {
    console.error("settings update failed", error);
    return "Saving failed, please try again.";
  }
  return null;
}

async function preview(
  db: ReturnType<typeof serviceClient>,
  install: { id: string; settings: Record<string, unknown> },
): Promise<Response> {
  // deno-lint-ignore no-explicit-any
  const s = install.settings as any;
  const service: Service = s.services?.[0] ?? { name: "Sample service", base_price: 100 };
  const quantity = service.unit_price ? 2 : undefined;
  const total = Math.round((service.base_price + (service.unit_price ?? 0) * (quantity ?? 0)) * 100) / 100;

  let logoBytes: Uint8Array | null = null;
  let logoType: "png" | "jpeg" | null = null;
  if (s.logo_path) {
    const { data } = await db.storage.from("logos").download(s.logo_path);
    if (data) {
      logoBytes = new Uint8Array(await data.arrayBuffer());
      logoType = s.logo_path.toLowerCase().endsWith(".png") ? "png" : "jpeg";
    }
  }

  const pdf = await renderQuotePdf({
    company: {
      name: s.company_name,
      email: s.email,
      phone: s.phone,
      website: s.website,
      address: s.address,
      brand_color: s.brand_color,
      footer_note: s.footer_note,
      logoBytes,
      logoType,
    },
    customer_name: "Alex Example",
    service_name: service.name,
    quantity,
    unit_label: service.unit_label,
    unit_price: service.unit_price,
    base_price: service.base_price,
    total,
    currency: s.currency ?? "USD",
    quote_number: "Q-PREVIEW",
    date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    rtl: isRtlDoc(s.doc_lang, s.company_name),
    fonts: await loadFonts(db),
  });

  const path = `${install.id}/preview.pdf`;
  const { error: upErr } = await db.storage.from("quotes").upload(path, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upErr) {
    console.error("preview upload failed", upErr);
    return json({ error: "preview_failed" }, 500);
  }
  const { data: signed, error: signErr } = await db.storage.from("quotes").createSignedUrl(path, 3600);
  if (signErr || !signed) return json({ error: "preview_failed" }, 500);
  return json({ preview_url: signed.signedUrl });
}
