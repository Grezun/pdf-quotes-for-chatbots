# SendPulse App Directory listing — copy to the review form

## App name

PDF Quotes for Chatbots

## Category / tool

Chatbots

## Short description

Your chatbot collects the customer's details — this app instantly turns them
into a branded PDF price quote with a download link the bot sends back.

## Full description

Turn chatbot conversations into professional price quotes, automatically.

PDF Quotes for Chatbots gives your SendPulse chatbot the power to hand every
lead a polished, branded PDF estimate the moment they finish answering your
bot's questions — no manual work, no waiting, no lost leads.

How it works:
1. Your bot asks the usual questions: name, which service, how many units
   (square meters, hours, rooms — whatever you sell).
2. The bot sends the answers to this app with a single API Request element.
3. The app calculates the price from the price list you configure, fills your
   branded quote template (logo, colors, contact details), and returns a
   download link.
4. Your bot replies: "Alex, your quote is ready (262.50 USD): [Download PDF]".

Perfect for cleaning companies, repair services, movers, landscapers, beauty
salons, tutors — any service business that quotes prices in chat.

## Key features

- **Instant branded PDF quotes** — logo, brand color, contact details, and a
  professional layout on every document.
- **Automatic price calculation** — set a base price and an optional per-unit
  price for each service; the app computes the total from the bot's answers.
  Your bot can also override the price for special cases.
- **One simple API call** — a single API Request element in your flow; the
  response gives you the download link and the formatted price as variables.
- **Private and secure** — documents are stored privately and shared only
  through expiring links; quotes are kept behind your personal API key.
- **Works in any language** — full Unicode support (Latin, Cyrillic, and more)
  and any currency label.

## Setup guide

1. Install the app — you'll be taken to your personal settings page.
2. Fill in your company details, upload your logo, pick your brand color, and
   list your services with prices. Click "Preview sample PDF" to see your
   template.
3. In your chatbot flow, add an **API Request** element after the questions
   that collect the customer's name and chosen service. Copy the URL and JSON
   body shown on your settings page (your API key is already filled in).
4. In the element's **Save values** tab, map the response key `pdf_url` to a
   variable, and optionally `price`.
5. Add a message element: "{{name}}, your quote is ready ({{price}}):
   {{pdf_url}}".

Done — every lead now gets a professional estimate in seconds.

## Support email

office.xpera@gmail.com

## Privacy policy URL

https://grezun.github.io/pdf-quotes-for-chatbots/privacy.html

## Technical URLs (app registration)

- Install URL: https://emmbigtxifbfuojbtqiu.supabase.co/functions/v1/install
- Uninstall URL: https://emmbigtxifbfuojbtqiu.supabase.co/functions/v1/uninstall
- Scopes: none required (the app never reads SendPulse account data)
