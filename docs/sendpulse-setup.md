# Registering the app in SendPulse — step by step

Everything below happens in your SendPulse account (sendpulse.com). The app
itself is already deployed and working.

## 1. Become a developer

1. Log in to SendPulse → left menu → **App directory** → **Home**.
2. Click **Become developer** and accept the terms.

## 2. Create the app

1. App directory → **Create app** (choose **Public** — it can stay in testing
   mode until you submit for review; use **Private** first if you prefer).
2. **General information:**
   - Name: `PDF Quotes for Chatbots`
   - Logo: upload `listing/logo.png` (250×250)
   - Tool: **Chatbots**
   - Scopes: select none (the app doesn't read SendPulse data)
3. **Technical URLs:**
   - Install URL: `https://emmbigtxifbfuojbtqiu.supabase.co/functions/v1/install`
   - Uninstall URL: `https://emmbigtxifbfuojbtqiu.supabase.co/functions/v1/uninstall`
4. **Descriptions:** copy from `listing/description.md` (short description,
   full description, key features, setup guide).
5. Support email: `office.xpera@gmail.com`
   Privacy policy: `https://grezun.github.io/pdf-quotes-for-chatbots/privacy.html`

## 3. Copy the app credentials into Supabase

After creating the app, SendPulse shows the app's **ID** and **Secret**.
Add them as Edge Function secrets so the install handshake works:

Supabase dashboard → project `pdf-quotes-for-chatbots` → **Edge Functions** →
**Secrets** → add:

- `SP_APP_ID` = (app ID from SendPulse)
- `SP_APP_SECRET` = (app secret from SendPulse)

(CLI alternative: `supabase secrets set SP_APP_ID=… SP_APP_SECRET=… --project-ref emmbigtxifbfuojbtqiu`)

No redeploy needed — secrets are picked up on the next invocation.

## 4. Test-install into your own account

1. In App directory, open your app (it's visible to you while in testing
   mode) and click **Install**.
2. SendPulse opens the Install URL with a login code; you should land on the
   settings page with a fresh account. Configure your test company and
   services, upload a logo, click **Preview sample PDF**.

## 5. Wire a test chatbot

1. Chatbots → your bot → edit a flow.
2. Collect variables, e.g. `name` (text), `service` (buttons matching your
   configured service names exactly), `quantity` (number, optional).
3. Add an **API Request** element:
   - Method: **POST**, URL: `https://emmbigtxifbfuojbtqiu.supabase.co/functions/v1/quote`
   - Body (JSON) — copy from your settings page; it looks like:
     ```json
     {
       "api_key": "<your api key>",
       "customer_name": "{{name}}",
       "service": "{{service}}",
       "quantity": "{{quantity}}"
     }
     ```
   - **Save values** tab: map `pdf_url` → variable `pdf_url`, `price` →
     variable `price`.
4. After the API element (Done branch), add a message:
   `{{name}}, your quote is ready ({{price}}): {{pdf_url}}`
5. On the Error branch, add a fallback message ("Sorry, something went
   wrong — we'll get back to you.").
6. Test the flow in the chat preview; you should receive a working PDF link.

## 6. Screenshots for the listing (optional but recommended)

Take up to 1600×900 screenshots of: the settings page, the bot flow with the
API Request element, a chat showing the quote message, and the PDF itself.

## 7. Submit for review

In App directory → your app → **Submit for review**. English descriptions are
required (already prepared). Once approved, the app is public.

## Costs to know

- Supabase project: $10/month (already active).
- GitHub Pages, fonts, everything else: free.
