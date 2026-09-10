# PDF Quotes for Chatbots

A SendPulse App Directory app: a chatbot collects a customer's name, service,
and quantity; its API Request element calls this app; the app computes a price
from the business's rules, renders a branded PDF quote, and returns a signed
download link the bot sends to the customer.

Runs entirely on Supabase: Postgres + private Storage buckets + Edge Functions.

- Spec: `docs/superpowers/specs/2026-09-10-pdf-quotes-for-chatbots-design.md`
- Plan: `docs/superpowers/plans/2026-09-10-pdf-quotes-for-chatbots.md`
- SendPulse account setup: `docs/sendpulse-setup.md`

## Endpoints (Edge Functions)

| Function | Purpose |
|---|---|
| `install` | SendPulse Install URL — creates account + settings, returns settings link |
| `uninstall` | SendPulse Uninstall URL — deactivates, purges files |
| `quote` | Called by the chatbot; returns `{ pdf_url, price, quote_id }` |
| `settings` | Business-facing settings page (token link) + logo upload + preview |
| `privacy` | Privacy policy page for the listing |

## Env secrets (Supabase → Edge Functions → Secrets)

- `SP_APP_ID`, `SP_APP_SECRET` — from the SendPulse app registration (used to
  exchange the install `code` for per-user client credentials). Optional until
  the app is registered; installs still work without them for testing.

## Development

Tests for pure modules run with Node 23+ (native TS):

```bash
node --test supabase/functions/_shared/pricing.test.ts
```

Deploy: `supabase functions deploy <name>` (or via MCP). All functions are
deployed with `verify_jwt=false` — they implement their own auth
(per-install `api_key` / `settings_token`).
