import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "jobtracker_session";
export const SESSION_SECONDS = 12 * 60 * 60;
export interface WebAccessConfig { version: 1; origin: string; passwordHash: string; sessionSecret: string }
export function normalizeWebOrigin(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.length > 200)
    throw new Error("Informe somente um endereço HTTPS, como https://seu-jobtracker.exemplo.com.");
  return url.origin;
}
export function passwordHash(password: string): string {
  if (password.length < 12 || password.length > 128) throw new Error("Use uma senha entre 12 e 128 caracteres.");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 32).toString("hex");
}
export function passwordMatches(password: string, stored: string): boolean {
  if (password.length < 1 || password.length > 128 || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(stored)) return false;
  const [salt, expected] = stored.split(":");
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(expected, "hex"));
}
export function createWebConfig(origin: string, password: string): WebAccessConfig {
  return { version: 1, origin: normalizeWebOrigin(origin), passwordHash: passwordHash(password), sessionSecret: randomBytes(32).toString("hex") };
}
export function validateWebConfig(input: unknown): WebAccessConfig {
  const value = input as Partial<WebAccessConfig>;
  if (!value || value.version !== 1 || typeof value.origin !== "string" || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(value.passwordHash ?? "") || !/^[a-f0-9]{64}$/.test(value.sessionSecret ?? "")) throw new Error("Configuração de acesso web inválida.");
  return { ...value, origin: normalizeWebOrigin(value.origin) } as WebAccessConfig;
}
export function makeSession(config: WebAccessConfig, origin: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ origin, expires: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  return body + "." + createHmac("sha256", Buffer.from(config.sessionSecret, "hex")).update(body).digest("base64url");
}
export function sessionValid(token: string | undefined, config: WebAccessConfig, origin: string, now = Date.now()): boolean {
  if (!token || token.length > 1024) return false;
  try {
    const [body, signature, extra] = token.split(".");
    if (extra || !body || !signature) return false;
    const expected = createHmac("sha256", Buffer.from(config.sessionSecret, "hex")).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return session.origin === origin && Number.isInteger(session.expires) && session.expires > Math.floor(now / 1000) && session.expires <= Math.floor(now / 1000) + SESSION_SECONDS;
  } catch { return false; }
}
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value) || value.startsWith("/entrar")) return "/";
  try { const url = new URL(value, "https://jobtracker.invalid"); return url.origin === "https://jobtracker.invalid" ? url.pathname + url.search : "/"; } catch { return "/"; }
}
/** Forwarded headers never grant local access. */
export function requestAccess(host: string | null, forwardedHost: string | null, protocol: string | null, config: WebAccessConfig | null): { origin: string; local: boolean } | null {
  try {
    if (protocol !== "http" && protocol !== "https") return null;
    const parse = (input: string) => { if (!/^[a-zA-Z0-9.[\]:-]+$/.test(input)) throw Error(); return new URL("https://" + input); };
    const actual = parse(host ?? "");
    const forwarded = forwardedHost ? parse(forwardedHost) : null;
    const localHost = (url: URL) => ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const local = localHost(actual) && (!forwarded || localHost(forwarded));
    if (local) return { origin: new URL((protocol === "https" ? "https://" : "http://") + (forwardedHost || host)).origin, local: true };
    if (!config || protocol !== "https") return null;
    const expected = new URL(config.origin);
    if (!localHost(actual) && actual.host !== expected.host) return null;
    if ((forwarded ?? actual).host !== expected.host) return null;
    return { origin: config.origin, local: false };
  } catch { return null; }
}
