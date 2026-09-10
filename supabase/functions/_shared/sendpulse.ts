// SendPulse App Directory ("market") auth flow.
// Login URL receives GET ?code=…&lang=…; the code is exchanged here within 1 minute.
// Docs: https://sendpulse.com/knowledge-base/app-directory/developers/login-flow

export type SpCredentials = {
  sp_user_id: string; // "id" — the user's SendPulse account UUID
  client_id: string;
  client_secret: string;
};

export async function exchangeCode(code: string): Promise<SpCredentials | null> {
  const appId = Deno.env.get("SP_APP_ID");
  const secret = Deno.env.get("SP_APP_SECRET");
  if (!appId || !secret) return null; // app not registered yet (dev mode)

  const res = await fetch("https://api.sendpulse.com/market-service/oauth/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, secret, code }),
  });
  if (!res.ok) {
    console.error("sendpulse authorize failed", res.status, await res.text());
    return null;
  }
  const body = await res.json();
  if (!body?.result || !body?.data?.client_id) {
    console.error("sendpulse authorize unexpected body", JSON.stringify(body));
    return null;
  }
  return {
    sp_user_id: String(body.data.id ?? ""),
    client_id: String(body.data.client_id),
    client_secret: String(body.data.client_secret),
  };
}
