# PDF Quotes for Chatbots — Design Spec

**Date:** 2026-09-10
**Status:** Approved by Alex (in chat)
**Target:** Public app in the SendPulse App Directory, category: Chatbots

## 1. Product summary

A SendPulse App Directory app for service businesses. Their chatbot collects a
customer's name, chosen service, and quantity; the bot's API Request element
calls our API; we compute a price from the business's pricing rules, render a
branded PDF quote, and return a download link the bot sends to the customer:

> "Alex, your cleaning quote is ready: Download PDF."

v1 is deliberately narrow: one fixed quote template, base + per-unit pricing,
one settings page. No template designer, no AI, no e-signatures, no
multi-currency conversion.

## 2. Platform constraints (verified from SendPulse docs)

- App Directory apps are hosted by the developer. SendPulse requires an
  **Install URL** (HTTPS, POST) and an **Uninstall URL** (webhook), plus
  listing assets: 250×250 logo, English description, key features, setup
  guide, support email, privacy policy link. Public apps go through review.
- Install handshake is OAuth-style: SendPulse sends a `code` to the Install
  URL; the app exchanges it (using the app's ID + secret) for per-user client
  credentials via the Market REST API.
- Chatbot **API Request element**: GET/POST, variables in URL/headers/body,
  60 s timeout, 65 KB max response, response JSON keys map to bot variables
  (each ≤ 1024 chars). 2xx → Done branch, otherwise Error branch.

## 3. Architecture

Everything runs on one Supabase project:

- **Postgres** — installs, settings, quotes.
- **Storage** — two private buckets: `logos`, `quotes` (PDFs). Access only
  via expiring signed URLs.
- **Edge Functions (Deno)** — the entire API + the settings page + the
  privacy policy page. PDF rendering via `pdf-lib` (pure JS, Deno-compatible).

No other infrastructure.

## 4. Data model

### `installs`
| column | notes |
|---|---|
| `id` uuid PK | |
| `sp_client_id`, `sp_client_secret` | credentials from the code exchange |
| `api_key` | random secret; the chatbot authenticates with this |
| `settings_token` | random secret; authenticates the settings page link |
| `status` | `active` / `uninstalled` |
| `created_at`, `uninstalled_at` | |

### `settings` (1:1 with installs)
| column | notes |
|---|---|
| `install_id` FK | |
| `company_name`, `email`, `phone`, `website`, `address` | shown on the PDF |
| `logo_path` | Storage path in `logos` bucket |
| `brand_color` | hex, used for accents on the PDF |
| `currency` | display symbol/code, no conversion |
| `footer_note` | e.g. "Quote valid 14 days" |
| `services` jsonb | array of `{ name, base_price, unit_price?, unit_label? }` |

### `quotes`
| column | notes |
|---|---|
| `id` uuid PK, `install_id` FK | |
| `customer_name`, `service_name`, `quantity`, `total` | |
| `pdf_path` | Storage path |
| `created_at` | |

Pricing rule: `total = base_price + unit_price × quantity` (quantity
defaults to 0; a request may override with an explicit `price`).

## 5. Endpoints (Edge Functions)

### `install` — POST (SendPulse Install URL)
Receives `{ code }` (plus whatever SendPulse sends). Exchanges the code for
client credentials via the Market API, creates `installs` + default
`settings`, responds 200 with the settings-page URL so the business lands in
configuration. Idempotent per SendPulse user where detectable.

### `uninstall` — POST (SendPulse Uninstall URL)
Marks the install `uninstalled`, deletes its PDFs and logo from Storage.

### `quote` — POST (called by the chatbot's API Request element)
Auth: `api_key` in body or `X-Api-Key` header.
Body: `customer_name` (required), `service` (required; matched
case-insensitively against `settings.services[].name`), `quantity`
(optional number), `price` (optional override).
Flow: validate → compute total → render PDF with pdf-lib (logo, brand color,
company block, customer block, line item, total, date, footer note) →
upload to `quotes` bucket → insert `quotes` row → respond:

```json
{ "pdf_url": "<signed url, 30-day expiry>", "price": "123.00", "quote_id": "…" }
```

Errors respond 4xx with `{ "error": "…" }` so the bot's Error branch fires.
Must comfortably fit 60 s / 65 KB limits (the PDF itself is never inlined).

### `settings` — GET/POST (business-facing)
`GET ?token=…` serves a single-page form: company details, logo upload,
brand color, currency, footer note, services list editor (add/remove rows).
Also shows: the quote endpoint URL + API key, a copy-paste guide for the
bot's API Request element, and a **Preview sample PDF** button (generates a
throwaway PDF with sample data using current saved settings).
`POST` saves settings (token-authenticated). Logo uploads go through this
function into the `logos` bucket.

### `privacy` — GET
Static privacy policy page (required for the public listing).

## 6. Security & privacy

- Quote endpoint rejects requests without a valid `api_key` (401).
- PDFs and logos live in private buckets; only expiring signed URLs leave
  the system (PDF links: 30 days).
- Settings reachable only via unguessable `settings_token` link.
- Service role key used only inside Edge Functions; RLS denies anon access
  to all tables.
- Uninstall purges the install's stored files.

## 7. Public listing deliverables

- App logo 250×250 PNG.
- English description, key-features list, step-by-step setup guide
  (install → configure settings → add API Request element to a bot flow →
  map `pdf_url` into a message).
- Privacy policy (hosted at the `privacy` endpoint).
- Support email: office.xpera@gmail.com.
- Scopes: minimal (the app doesn't need to read SendPulse data in v1).

## 8. Testing

1. Unit-ish: price computation and request validation.
2. Deployed smoke test: simulate the SendPulse install POST → open settings
   page → save real settings + logo → call `quote` exactly as the API
   Request element would → download and eyeball the PDF.
3. Real chatbot test in Alex's SendPulse account before submitting review.

## 9. Out of scope (v1)

Multiple templates, drag-and-drop designer, AI content, currency conversion,
e-signatures, per-customer portals, analytics dashboards.
