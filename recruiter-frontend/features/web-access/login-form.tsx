"use client";
import { useState } from "react";

export function LoginForm({ next, error }: { next: string; error?: string }) {
  const [pending, setPending] = useState(false);
  const message = error === "rate" ? "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." : error ? "Senha incorreta. Confira e tente novamente." : "";
  return <form action="/api/session" method="post" onSubmit={() => setPending(true)} className="mt-8 space-y-5">
    <input name="next" type="hidden" value={next} />
    <label className="block text-sm font-medium">Senha do Job Tracker
      <input name="password" type="password" autoComplete="current-password" required maxLength={128} className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-zinc-950 px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
    </label>
    {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
    <button disabled={pending} className="min-h-12 w-full rounded-xl bg-accent px-5 font-semibold text-zinc-950 disabled:opacity-50">{pending ? "Entrando…" : "Entrar"}</button>
    <p className="text-sm leading-6 text-zinc-400">Use a senha definida no computador que executa o Job Tracker. Sua sessão dura até 12 horas.</p>
  </form>;
}
