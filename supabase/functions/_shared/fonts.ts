// Loads Noto Sans from the private assets bucket once per function instance.
// Failure degrades gracefully: renderQuotePdf falls back to Helvetica.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type FontSet = {
  regular: Uint8Array;
  bold: Uint8Array;
  hebRegular?: Uint8Array | null;
  hebBold?: Uint8Array | null;
};

let cached: Promise<FontSet | null> | null = null;

export function loadFonts(db: SupabaseClient): Promise<FontSet | null> {
  cached ??= (async () => {
    try {
      const dl = (path: string) => db.storage.from("assets").download(path);
      const [reg, bold, hebReg, hebBold] = await Promise.all([
        dl("fonts/NotoSans-Regular.ttf"),
        dl("fonts/NotoSans-Bold.ttf"),
        dl("fonts/NotoSansHebrew-Regular.ttf"),
        dl("fonts/NotoSansHebrew-Bold.ttf"),
      ]);
      if (reg.error || bold.error || !reg.data || !bold.data) {
        console.error("font download failed", reg.error, bold.error);
        return null;
      }
      const bytes = async (d: { data: Blob | null }) =>
        d.data ? new Uint8Array(await d.data.arrayBuffer()) : null;
      return {
        regular: (await bytes(reg))!,
        bold: (await bytes(bold))!,
        // Hebrew fonts are optional — Hebrew text degrades to "?" without them
        hebRegular: hebReg.error ? null : await bytes(hebReg),
        hebBold: hebBold.error ? null : await bytes(hebBold),
      };
    } catch (e) {
      console.error("font load error", e);
      return null;
    }
  })();
  return cached;
}
