import { NextResponse, type NextRequest } from "next/server";
import { getWebConfig } from "@/lib/web-access-store";
import { makeSession, passwordMatches, requestAccess, safeReturnPath, SESSION_COOKIE, SESSION_SECONDS } from "@/lib/web-access-core";

// A route handler, rather than a public Server Action: every other mutation
// remains behind the proxy's session guard, regardless of its action ID.
let failures = { start: 0, count: 0 };
export async function POST(request: NextRequest) {
  try {
    const config = getWebConfig();
    const access = requestAccess(request.headers.get("host"), request.headers.get("x-forwarded-host"), request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", ""), config);
    if (!config || !access || request.headers.get("origin") !== access.origin) return new NextResponse("Solicitação não permitida.", { status: 403 });
    const length = request.headers.get("content-length");
    if (length && Number(length) > 4096) return new NextResponse(null, { status: 413 });
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new NextResponse(null, { status: 415 });
    const reader = request.body?.getReader();
    if (!reader) return new NextResponse(null, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return new NextResponse(null, { status: 413 }); }
      chunks.push(value);
    }
    const data = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const next = safeReturnPath(data.get("next"));
    const denied = (error: string) => {
      const url = new URL("/entrar", access.origin);
      url.searchParams.set("error", error); url.searchParams.set("next", next);
      const response = NextResponse.redirect(url, 303);
      response.headers.set("Cache-Control", "no-store");
      return response;
    };
    const now = Date.now();
    if (now - failures.start >= 5 * 60000) failures = { start: now, count: 0 };
    if (failures.count >= 20) return denied("rate");
    if (!passwordMatches(data.get("password") || "", config.passwordHash)) { failures.count++; return denied("credentials"); }
    const response = NextResponse.redirect(new URL(next, access.origin), 303);
    response.cookies.set(SESSION_COOKIE, makeSession(config, access.origin), { httpOnly: true, secure: access.origin.startsWith("https:"), sameSite: "strict", path: "/", maxAge: SESSION_SECONDS });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return new NextResponse("Não foi possível entrar. Tente novamente.", { status: 503 }); }
}
