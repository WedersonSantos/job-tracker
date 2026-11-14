"use client";
import { usePwa } from "./pwa-provider";

export function InstallControls() {
  const pwa = usePwa();
  return <div className="space-y-5">
    {!pwa.ready ? <p role="status" className="text-zinc-400">Verificando este navegador…</p> : pwa.installed ?
      <p className="font-medium text-accent-2">Você já está usando o Job Tracker como aplicativo.</p> : <>
        {pwa.canInstall && <button type="button" onClick={pwa.install} className="min-h-12 rounded-xl bg-accent px-6 font-semibold text-zinc-950 transition hover:brightness-110">Instalar neste dispositivo</button>}
        {!pwa.secure && <p className="text-amber-200">Abra o endereço HTTPS do Job Tracker para instalar neste dispositivo.</p>}
        {pwa.ios ? <p className="leading-7 text-zinc-300">No Safari, abra <strong>Compartilhar</strong>, escolha <strong>Adicionar à Tela de Início</strong> e confirme em Adicionar.</p> :
          <p className="leading-7 text-zinc-300">No Chrome ou Edge, abra o menu do navegador e escolha <strong>Instalar Job Tracker</strong> ou <strong>Adicionar à tela inicial</strong>. Quando disponível, o botão acima abre essa opção.</p>}
      </>}
    {pwa.message && <p role="status" className="text-sm text-zinc-300">{pwa.message}</p>}
    <p className="text-sm leading-6 text-zinc-400">O ícone abre o aplicativo em uma janela própria. Currículos, vagas e candidaturas continuam no servidor; é preciso estar conectado para consultá-los.</p>
  </div>;
}
