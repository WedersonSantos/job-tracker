"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { configureAccessAction } from "./actions";

const input = "mt-2 min-h-12 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";
export function AccessForm({ origin, enabled }: { origin: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(configureAccessAction, {});
  const router = useRouter();
  useEffect(() => { if (state.success) router.refresh(); }, [state, router]);
  return <form action={action} className="space-y-5">
    <label className="block text-sm font-medium">Endereço HTTPS
      <input className={input} type="url" name="origin" defaultValue={origin} placeholder="https://seu-jobtracker.exemplo.com" required autoComplete="url" />
    </label>
    <div className="grid gap-5 sm:grid-cols-2">
      <label className="block text-sm font-medium">{enabled ? "Nova senha de acesso" : "Senha de acesso"}
        <input className={input} name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required aria-describedby="password-help" />
      </label>
      <label className="block text-sm font-medium">Confirmar senha
        <input className={input} name="confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" required />
      </label>
    </div>
    <p id="password-help" className="text-sm text-zinc-400">Use de 12 a 128 caracteres. Essa senha dá acesso a todos os perfis desta instalação.</p>
    {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
    {state.success && <p role="status" className="text-sm leading-6 text-accent-2">{state.success}</p>}
    <div className="flex flex-wrap gap-3">
      <button disabled={pending} className="min-h-12 rounded-xl bg-accent px-5 font-semibold text-zinc-950 disabled:opacity-50">{pending ? "Salvando…" : "Salvar acesso"}</button>
      {enabled && <button disabled={pending} name="operation" value="disable" formNoValidate className="min-h-12 rounded-xl border border-white/15 px-5 text-sm disabled:opacity-50">Desativar acesso remoto</button>}
    </div>
  </form>;
}
