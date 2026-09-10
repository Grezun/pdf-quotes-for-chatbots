// SendPulse Login/Install URL. SendPulse opens this in the user's browser as
// GET ?code=…&lang=… — on first install AND every later "open app" click.
// We exchange the code, find-or-create the install, and redirect to settings.
import { serviceClient } from "../_shared/db.ts";
import { randomToken } from "../_shared/token.ts";
import { exchangeCode } from "../_shared/sendpulse.ts";

const DEV_INSTALL_SECRET = Deno.env.get("DEV_INSTALL_SECRET"); // manual testing only
// Static settings page (GitHub Pages) — Supabase can't serve HTML itself.
const APP_URL = Deno.env.get("APP_URL") ?? "https://grezun.github.io/pdf-quotes-for-chatbots/";

function errorPage(message: string, status = 400): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>PDF Quotes</title>
     <body style="font-family:system-ui;max-width:32rem;margin:4rem auto;color:#1f2937">
     <h2>Something went wrong</h2><p>${message}</p>
     <p>Please try opening the app again from SendPulse. If it keeps failing,
     contact <a href="mailto:office.xpera@gmail.com">office.xpera@gmail.com</a>.</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const db = serviceClient();

  // Dev backdoor: create a test install without SendPulse, guarded by a secret.
  if (!code && DEV_INSTALL_SECRET && url.searchParams.get("dev") === DEV_INSTALL_SECRET) {
    const install = await createInstall(db, null);
    return Response.redirect(`${APP_URL}?token=${install.settings_token}`, 302);
  }

  if (!code) return errorPage("Missing authorization code.");

  const creds = await exchangeCode(code);
  if (!creds) {
    return errorPage("Could not verify your SendPulse account (the login code may have expired).", 401);
  }

  // Reuse an existing install for this SendPulse user (opens after first install).
  const { data: existing } = await db
    .from("installs")
    .select("id, settings_token, status")
    .eq("sp_user_id", creds.sp_user_id)
    .maybeSingle();

  let settingsToken: string;
  if (existing && existing.status === "active") {
    settingsToken = existing.settings_token;
    await db
      .from("installs")
      .update({ sp_client_id: creds.client_id, sp_client_secret: creds.client_secret })
      .eq("id", existing.id);
  } else if (existing) {
    // Reinstall after uninstall: reactivate with fresh secrets.
    settingsToken = randomToken();
    await db
      .from("installs")
      .update({
        status: "active",
        uninstalled_at: null,
        api_key: randomToken(),
        settings_token: settingsToken,
        sp_client_id: creds.client_id,
        sp_client_secret: creds.client_secret,
      })
      .eq("id", existing.id);
  } else {
    const install = await createInstall(db, creds);
    settingsToken = install.settings_token;
  }

  return Response.redirect(`${APP_URL}?token=${settingsToken}`, 302);
});

async function createInstall(
  db: ReturnType<typeof serviceClient>,
  creds: { sp_user_id: string; client_id: string; client_secret: string } | null,
): Promise<{ id: string; settings_token: string }> {
  const { data: install, error } = await db
    .from("installs")
    .insert({
      sp_user_id: creds?.sp_user_id ?? null,
      sp_client_id: creds?.client_id ?? null,
      sp_client_secret: creds?.client_secret ?? null,
      api_key: randomToken(),
      settings_token: randomToken(),
    })
    .select("id, settings_token")
    .single();
  if (error) throw error;
  const { error: sErr } = await db.from("settings").insert({ install_id: install.id });
  if (sErr) throw sErr;
  return install;
}
