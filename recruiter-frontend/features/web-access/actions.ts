"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createWebConfig, makeSession, requestAccess, SESSION_COOKIE, SESSION_SECONDS, sessionValid } from "@/lib/web-access-core";
import { getWebConfig, removeWebConfig, saveWebConfig } from "@/lib/web-access-store";

export type AccessState = { error?: string; success?: string };
async function context() {
  const h = await headers(), config = getWebConfig();
  const access = requestAccess(h.get("host"), h.get("x-forwarded-host"), h.get("x-forwarded-proto") || "http", config);
  if (!access || h.get("origin") !== access.origin) throw Error("A origem desta solicitação não é permitida.");
  return { access, config };
}
async function setSession(config: ReturnType<typeof createWebConfig>, origin: string) {
  (await cookies()).set(SESSION_COOKIE, makeSession(config, origin), { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "strict", path: "/", maxAge: SESSION_SECONDS });
}
export async function configureAccessAction(_state: AccessState, data: FormData): Promise<AccessState> {
  try {
    const { access, config } = await context();
    if (!access.local) return { error: "Configure o acesso no computador que executa o Job Tracker." };
    if (config && !sessionValid((await cookies()).get(SESSION_COOKIE)?.value, config, access.origin)) return { error: "Entre novamente antes de alterar o acesso." };
    if (data.get("operation") === "disable") {
      await removeWebConfig(); (await cookies()).delete(SESSION_COOKIE);
      return { success: "Acesso por endereço HTTPS desativado. O aplicativo continua disponível apenas no computador." };
    }
    if (data.get("password") !== data.get("confirm")) return { error: "As senhas não coincidem." };
    const next = createWebConfig(String(data.get("origin") || ""), String(data.get("password") || ""));
    await saveWebConfig(next); await setSession(next, access.origin);
    return { success: "Senha e endereço configurados. O endereço precisa estar conectado ao servidor por HTTPS para funcionar no celular." };
  } catch { return { error: "Não foi possível salvar. Confira o endereço HTTPS, a senha e a permissão de gravação no servidor." }; }
}
export async function logoutAction() {
  await context();
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/entrar");
}
