// Loads Noto Sans from the private assets bucket once per function instance.
// Failure degrades gracefully: renderQuotePdf falls back to Helvetica.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type FontPair = { regular: Uint8Array; bold: Uint8Array };

let cached: Promise<FontPair | null> | null = null;

export function loadFonts(db: SupabaseClient): Promise<FontPair | null> {
  cached ??= (async () => {
    try {
      const [reg, bold] = await Promise.all([
        db.storage.from("assets").download("fonts/NotoSans-Regular.ttf"),
        db.storage.from("assets").download("fonts/NotoSans-Bold.ttf"),
      ]);
      if (reg.error || bold.error || !reg.data || !bold.data) {
        console.error("font download failed", reg.error, bold.error);
        return null;
      }
      return {
        regular: new Uint8Array(await reg.data.arrayBuffer()),
        bold: new Uint8Array(await bold.data.arrayBuffer()),
      };
    } catch (e) {
      console.error("font load error", e);
      return null;
    }
  })();
  return cached;
}
