# PDF Quotes for Chatbots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable SendPulse App Directory app that turns chatbot answers into a branded PDF quote and returns a signed download link.

**Architecture:** One Supabase project: Postgres (installs/settings/quotes), private Storage buckets (logos, quotes), and Deno Edge Functions for the whole surface — install/uninstall webhooks, the chatbot-facing `quote` endpoint, a token-authenticated `settings` page, and a `privacy` page. PDF rendered in-function with pdf-lib.

**Tech Stack:** Supabase (Postgres, Storage, Edge Functions/Deno), pdf-lib, vanilla-HTML settings page served from an Edge Function.

**Spec:** `docs/superpowers/specs/2026-09-10-pdf-quotes-for-chatbots-design.md`

## Global Constraints

- All endpoints HTTPS (Supabase provides this).
- `quote` response must be JSON ≤ 65 KB, complete well under 60 s; keys: `pdf_url`, `price`, `quote_id`; each value ≤ 1024 chars.
- Signed PDF URLs: 30-day expiry. Buckets `logos` and `quotes` are private.
- Auth: `api_key` (chatbot→quote), `settings_token` (settings page). Both 32-byte random hex.
- Errors: non-2xx with `{ "error": string }`.
- RLS enabled on all tables; no anon policies (service role only inside functions).
- Support email in listing/privacy: office.xpera@gmail.com.

---

### Task 1: Repo scaffolding + shared pricing module with tests

**Files:**
- Create: `supabase/functions/_shared/pricing.ts`
- Create: `supabase/functions/_shared/pricing.test.ts`
- Create: `.gitignore`, `README.md`

**Interfaces:**
- Produces: `type Service = { name: string; base_price: number; unit_price?: number; unit_label?: string }`
- Produces: `computeTotal(services: Service[], serviceName: string, quantity?: number, priceOverride?: number): { service: Service; total: number }` — throws `Error("unknown_service")` when no case-insensitive name match; `total = base + (unit_price ?? 0) * (quantity ?? 0)`; `priceOverride` (finite number ≥ 0) wins over the computed total; result rounded to 2 decimals.
- Produces: `formatMoney(amount: number, currency: string): string` → e.g. `"149.50 USD"`.

- [ ] **Step 1:** Write `pricing.test.ts` covering: exact match, case-insensitive match, unknown service throws, base-only, base+unit×qty, override wins, rounding, formatMoney.
- [ ] **Step 2:** `deno test supabase/functions/_shared/pricing.test.ts` → fails (module missing).
- [ ] **Step 3:** Implement `pricing.ts`.
- [ ] **Step 4:** `deno test` → all pass.
- [ ] **Step 5:** Commit `feat: pricing module with tests`.

### Task 2: Supabase project + schema migration + buckets

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Produces tables exactly per spec §4 (`installs`, `settings`, `quotes`), RLS enabled, no policies. `installs.api_key` and `installs.settings_token` unique. `settings.services` jsonb default `'[]'`.
- Produces private buckets `logos`, `quotes`.

- [ ] **Step 1:** Pick/create Supabase project via MCP (check `get_cost` first; use free tier).
- [ ] **Step 2:** Write `0001_init.sql` (tables, indexes on `api_key`, `settings_token`; `alter table … enable row level security`).
- [ ] **Step 3:** Apply via `apply_migration`; create buckets (insert into `storage.buckets` with `public=false` via migration or API).
- [ ] **Step 4:** Verify with `list_tables` + a select on `storage.buckets`.
- [ ] **Step 5:** Commit `feat: initial schema and buckets`.

### Task 3: `install` + `uninstall` edge functions

**Files:**
- Create: `supabase/functions/install/index.ts`
- Create: `supabase/functions/uninstall/index.ts`
- Create: `supabase/functions/_shared/db.ts` (service-role client factory), `supabase/functions/_shared/token.ts` (`randomToken(): string` 32-byte hex)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `install` POST: accepts JSON or form body; reads `code` (and `service_user_id`/`user_id` if present). Exchanges code at `https://oauth.sendpulse.com/market/oauth/access_token` style Market endpoint using env `SP_APP_ID`/`SP_APP_SECRET` — because exact endpoint may differ, the exchange lives in `_shared/sendpulse.ts` as `exchangeCode(code: string): Promise<{client_id: string; client_secret: string} | null>`; a `null` (or missing env) still creates the install (credentials nullable) so private testing works before app registration. Inserts `installs` + default `settings` row (`company_name: "Your Company"`, `currency: "USD"`, sample service `[{name:"Standard service", base_price:100}]`). Returns 200 JSON `{ settings_url }` where `settings_url = <FUNCTIONS_BASE>/settings?token=<settings_token>`.
- Produces: `uninstall` POST: identifies install by `client_id`/`install_id` in body; sets `status='uninstalled'`, `uninstalled_at=now()`, deletes storage objects under `quotes/<install_id>/` and `logos/<install_id>/`. Always 200.

- [ ] **Step 1:** Implement `_shared/db.ts`, `_shared/token.ts`, `_shared/sendpulse.ts`, both functions.
- [ ] **Step 2:** Deploy both with `verify_jwt=false` (SendPulse can't send Supabase JWTs).
- [ ] **Step 3:** Smoke test: `curl -X POST …/install -d '{"code":"fake"}'` → 200 with `settings_url`; row exists. `curl -X POST …/uninstall -d '{"install_id":"…"}'` → status flips.
- [ ] **Step 4:** Commit `feat: install/uninstall webhooks`.

### Task 4: PDF template module

**Files:**
- Create: `supabase/functions/_shared/pdf.ts`

**Interfaces:**
- Consumes: `Service`, `formatMoney` from Task 1.
- Produces: `renderQuotePdf(input: { company: { name; email?; phone?; website?; address?; brand_color?; footer_note?; logoBytes?: Uint8Array; logoType?: "png"|"jpeg" }, customer_name: string; service_name: string; quantity?: number; unit_label?: string; unit_price?: number; base_price?: number; total: number; currency: string; quote_number: string; date: string }): Promise<Uint8Array>` — A4, header band in brand color, logo top-left (fit 120×60), company block right, "QUOTE #" title, customer greeting line, line-item table (service, qty, unit price, amount), bold total row, footer note + generated-by line. Uses only StandardFonts (Helvetica) — no font downloads at runtime.

- [ ] **Step 1:** Implement `pdf.ts` with pdf-lib from `npm:pdf-lib`.
- [ ] **Step 2:** Local check: small Deno script renders a sample PDF to scratchpad; open/verify visually (Read tool on the PDF).
- [ ] **Step 3:** Commit `feat: quote PDF template`.

### Task 5: `quote` edge function (the product)

**Files:**
- Create: `supabase/functions/quote/index.ts`

**Interfaces:**
- Consumes: `computeTotal`, `renderQuotePdf`, db client.
- Produces: POST, auth via `api_key` body field or `X-Api-Key` header → 401 `{error:"invalid_api_key"}`. Body: `customer_name` (required, ≤120 chars), `service` (required), `quantity?` (number|numeric string), `price?` (override). 404-style 400 `{error:"unknown_service", known_services:[…names]}` on no match. Renders PDF (downloads logo bytes from Storage if set), uploads to `quotes/<install_id>/<quote_id>.pdf` (contentType `application/pdf`), creates 30-day signed URL, inserts `quotes` row, returns 200 `{ pdf_url, price, quote_id }` (`price` = formatted string like `"149.50 USD"`).

- [ ] **Step 1:** Implement + deploy (`verify_jwt=false`).
- [ ] **Step 2:** Smoke test with curl using the Task 3 install's api_key; download the returned `pdf_url`, verify it's a valid PDF (open it).
- [ ] **Step 3:** Error-path tests: bad key → 401; unknown service → 400 with `known_services`.
- [ ] **Step 4:** Commit `feat: quote endpoint`.

### Task 6: `settings` edge function (page + save + logo upload + preview)

**Files:**
- Create: `supabase/functions/settings/index.ts`
- Create: `supabase/functions/settings/page.ts` (exports `renderPage(data): string` — the HTML)

**Interfaces:**
- Consumes: db client, `renderQuotePdf`.
- Produces routes (all token-authenticated via `?token=` or JSON `token`; invalid → 403 page/JSON):
  - `GET /settings?token=…` → HTML form prefilled from `settings`: company fields, brand color picker, currency, footer note, dynamic services rows (name/base/unit/unit label, add/remove via vanilla JS), logo file input. Shows read-only integration box: quote endpoint URL, api_key, example JSON body, SendPulse API Request element instructions, response mapping (`pdf_url`, `price`). Buttons: Save, Preview sample PDF.
  - `POST /settings` `action=save` (multipart form) → upserts settings; logo file (png/jpeg ≤ 1 MB) stored at `logos/<install_id>/logo.<ext>`; redirects back with `?saved=1`.
  - `GET /settings/preview?token=…` → renders sample PDF (customer "Alex Example", first service, qty 2) with current saved settings, returns it inline (`Content-Type: application/pdf`).
- Single-page vanilla HTML/CSS — clean, neutral, no framework.

- [ ] **Step 1:** Implement page + routes; deploy (`verify_jwt=false`).
- [ ] **Step 2:** Browser test with the in-app Browser: open settings URL, fill fields, add a service, upload logo, save, hit Preview, verify PDF.
- [ ] **Step 3:** Re-run a `quote` curl and confirm branding shows on the customer PDF.
- [ ] **Step 4:** Commit `feat: settings page`.

### Task 7: `privacy` page + listing assets + docs

**Files:**
- Create: `supabase/functions/privacy/index.ts` (static HTML privacy policy naming data collected: business settings, quote records, generated PDFs; retention; contact office.xpera@gmail.com)
- Create: `listing/description.md` (name, short + long description, key features, setup guide steps for the SendPulse review form)
- Create: `listing/logo.png` (250×250)
- Modify: `README.md` (what it is, architecture, env vars `SP_APP_ID`/`SP_APP_SECRET`, deploy steps, SendPulse app registration steps: Install URL, Uninstall URL, scopes: none/minimal)

- [ ] **Step 1:** Implement + deploy privacy; write listing copy; generate logo (simple SVG→PNG: document glyph + accent).
- [ ] **Step 2:** Verify privacy URL loads.
- [ ] **Step 3:** Commit `feat: privacy page and listing assets`.

### Task 8: End-to-end smoke test + handoff

- [ ] **Step 1:** Full simulated run: install POST → open settings from returned URL → configure → quote curl with realistic bot payload → download PDF → uninstall POST → confirm quote endpoint now 403/410 for that key and files purged.
- [ ] **Step 2:** Write `docs/sendpulse-setup.md`: exact steps in Alex's SendPulse account (Become developer → Create app → paste Install/Uninstall URLs → set env secrets `SP_APP_ID`/`SP_APP_SECRET` in Supabase → test-mode install → bot flow wiring with API Request element screenshots-to-take list → submit for review).
- [ ] **Step 3:** Final commit; report results with all URLs.
