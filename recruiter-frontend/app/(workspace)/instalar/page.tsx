import { headers } from "next/headers";
import { InstallControls } from "@/features/pwa/install-controls";
import { AccessForm } from "@/features/web-access/access-form";
import { logoutAction } from "@/features/web-access/actions";
import { getWebConfig } from "@/lib/web-access-store";
import { requestAccess } from "@/lib/web-access-core";

export default async function InstallPage() {
  const h = await headers(), config = getWebConfig();
  const access = requestAccess(h.get("host"), h.get("x-forwarded-host"), h.get("x-forwarded-proto") || "http", config);
  return <div className="mx-auto w-full max-w-3xl space-y-10">
    <div><p className="text-sm font-medium text-accent-2">NO COMPUTADOR E NO CELULAR</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Leve o Job Tracker com você.</h1>
      <p className="mt-4 max-w-2xl leading-7 text-zinc-300">Adicione à tela inicial para abrir suas vagas e seu currículo em um só toque.</p>
    </div>
    <section aria-labelledby="install-title" className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5 sm:p-7">
      <h2 id="install-title" className="mb-5 text-xl font-semibold">Instalar neste dispositivo</h2>
      <InstallControls />
    </section>
    <section aria-labelledby="connection-title" className="space-y-5 border-t border-white/10 pt-8">
      <h2 id="connection-title" className="text-xl font-semibold">Conectar outro dispositivo</h2>
      {config ? <p className="break-words leading-7 text-zinc-300">Endereço configurado: <a className="text-accent-2 underline underline-offset-4" href={config.origin}>{config.origin}</a>. Abra esse endereço no celular e entre com sua senha.</p> :
        <p className="leading-7 text-zinc-300">O endereço 127.0.0.1 funciona só neste computador. Para usar no celular, conecte esta instalação a um endereço HTTPS ou hospede o programa em um servidor.</p>}
      <p className="text-sm leading-6 text-zinc-400">Se o servidor for este computador, ele precisa continuar ligado com o Job Tracker em execução. A extensão de preenchimento no Chrome continua sendo instalada separadamente no computador.</p>
      {access?.local && <details className="rounded-xl border border-white/10 p-5" open>
        <summary className="min-h-11 cursor-pointer font-medium">Configurar endereço e senha</summary>
        <p className="mb-6 mt-2 text-sm leading-6 text-zinc-400">Salve o endereço e uma senha antes de conectar o servidor por HTTPS. Esta opção não cria um domínio nem publica seu computador na internet. Consulte o guia web no projeto para preparar a conexão.</p>
        <AccessForm origin={config?.origin || ""} enabled={Boolean(config)} />
      </details>}
      {config && <form action={logoutAction}><button className="min-h-11 rounded-lg border border-white/15 px-4 text-sm">Sair deste dispositivo</button></form>}
    </section>
  </div>;
}
