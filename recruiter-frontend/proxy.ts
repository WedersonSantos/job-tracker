import { NextResponse, type NextRequest } from "next/server";
import { getWebConfig } from "@/lib/web-access-store";
import { requestAccess, SESSION_COOKIE, sessionValid } from "@/lib/web-access-core";

/**
 * Default: loopback only. Optional HTTPS origin: all private requests require
 * an origin-bound session, including localhost behind a rewriting proxy.
 *
 * Sem `matcher`, de propósito: roda em tudo, páginas, Server Actions e
 * estáticos. Uma rota esquecida numa lista seria uma rota aberta.
 */
export function proxy(request: NextRequest) {
  let config;
  try { config = getWebConfig(); } catch { return new NextResponse("A configuração de acesso precisa ser corrigida no servidor.", { status: 503 }); }
  const access = requestAccess(request.headers.get("host"), request.headers.get("x-forwarded-host"), request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", ""), config);
  if (!access) return new NextResponse("Endereço não autorizado para esta instalação do Job Tracker.", { status: 403 });
  const path = request.nextUrl.pathname;
  const assets = new Set(["/manifest.webmanifest", "/sw.js", "/offline.html", "/favicon.ico", "/icon.svg", "/icons/pwa-192.png", "/icons/pwa-512.png", "/icons/pwa-maskable-512.png", "/icons/apple-touch-icon.png", "/api/health"]);
  const read = request.method === "GET" || request.method === "HEAD";
  const publicRoute = (path === "/api/session" && request.method === "POST") || (read && (path === "/entrar" || assets.has(path) || path.startsWith("/_next/static/")));
  let response: NextResponse;
  if (config && !publicRoute && !sessionValid(request.cookies.get(SESSION_COOKIE)?.value, config, access.origin)) {
    if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.json({ message: "Sessão encerrada. Entre novamente." }, { status: 401 });
    const login = new URL("/entrar", access.origin);
    login.searchParams.set("next", path + request.nextUrl.search);
    response = NextResponse.redirect(login);
  } else response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  if (!publicRoute || path === "/entrar") response.headers.set("Cache-Control", "private, no-store");
  if (path === "/sw.js") { response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate"); response.headers.set("Service-Worker-Allowed", "/"); }
  return response;
}
