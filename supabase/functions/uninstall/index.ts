// SendPulse Uninstall URL. POST with { id, user_id, app_id, client_id, … }.
// Always answer 200 — SendPulse removes the connection either way.
import { json, serviceClient } from "../_shared/db.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: true });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    try {
      body = Object.fromEntries((await req.formData()).entries());
    } catch { /* keep empty */ }
  }

  const spUserId = body.id ? String(body.id) : null;
  const clientId = body.client_id ? String(body.client_id) : null;
  const installId = body.install_id ? String(body.install_id) : null; // dev/testing
  if (!spUserId && !clientId && !installId) return json({ ok: true });

  const db = serviceClient();
  let q = db.from("installs").select("id");
  if (installId) q = q.eq("id", installId);
  else if (spUserId) q = q.eq("sp_user_id", spUserId);
  else q = q.eq("sp_client_id", clientId!);
  const { data: install } = await q.maybeSingle();
  if (!install) return json({ ok: true });

  await db
    .from("installs")
    .update({ status: "uninstalled", uninstalled_at: new Date().toISOString() })
    .eq("id", install.id);

  // Purge stored files for this install.
  for (const bucket of ["quotes", "logos"]) {
    const { data: files } = await db.storage.from(bucket).list(install.id, { limit: 1000 });
    if (files?.length) {
      await db.storage.from(bucket).remove(files.map((f) => `${install.id}/${f.name}`));
    }
  }

  return json({ ok: true });
});
