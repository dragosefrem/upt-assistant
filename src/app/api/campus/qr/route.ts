import { qrCode } from "@/lib/campuspath/client";
import { campusError, withCampus } from "@/lib/campuspath/http";
import { CAMPUS_PATH } from "@/lib/campuspath/links";

/**
 * A route address of this app (`<origin>/campus?from=…&to=…`) as a QR code: SVG, or PNG with
 * `format=png`. The service checks the address against the host passed on here, which is the
 * public host this request came to.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return withCampus(null, async ({ t }) => {
    const format = params.get("format") ?? "svg";
    const link = params.get("link") ?? "";
    const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
    let address: URL;
    try {
      address = new URL(link);
    } catch {
      return campusError(400, t.campus.api.badRequest);
    }
    if ((format !== "svg" && format !== "png") || !host || address.host.toLowerCase() !== host.toLowerCase() || address.pathname !== CAMPUS_PATH) {
      return campusError(400, t.campus.api.badRequest);
    }
    const picture = await qrCode({ link, format, host });
    if (picture.status !== 200) return campusError(picture.status >= 500 ? 502 : 400, t.campus.api.badRequest);
    return new Response(new Uint8Array(picture.body), {
      headers: { "Content-Type": picture.type || (format === "png" ? "image/png" : "image/svg+xml"), "Cache-Control": "private, max-age=86400" },
    });
  });
}
