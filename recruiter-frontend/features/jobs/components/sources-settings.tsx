"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { SourceOverview, SourceSettings } from "@recruit/shared";
import { Field } from "@/components/field";
import { checkSourcesAction, saveSourcesAction } from "../sources-actions";

const names: Record<string, string> = {
  gupy: "Gupy",
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  remoteok: "RemoteOK",
  remotive: "Remotive",
  "portais-br": "InfoJobs e Vagas.com.br",
  "uberlandia-inovadora": "Uberlândia Inovadora",
  "solutis-inhire": "Solutis (InHire)",
  jobbol: "Jobbol",
  "linkedin-alerts": "LinkedIn — alertas por email",
};
const states = {
  "not-configured": "Não configurado",
  "not-tested": "Ainda não testado",
  disabled: "Busca ampliada desligada",
  ok: "Funcionando",
  empty: "Sem vagas nesta consulta",
  partial: "Resultado parcial",
  error: "Falhou",
};
const inputText = (settings: SourceSettings) => ({
  greenhouse: settings.greenhouse.join("\n"),
  ashby: settings.ashby.join("\n"),
  lever: settings.lever.join("\n"),
});

export function SourcesSettings({ initial }: { initial: SourceOverview }) {
  const [overview, setOverview] = useState(initial);
  const [draft, setDraft] = useState(inputText(initial.settings));
  const [feedback, setFeedback] = useState<{
    error: boolean;
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [operation, setOperation] = useState<"save" | "check" | null>(null);
  const run = (kind: "save" | "check") => {
    setOperation(kind);
    setFeedback(null);
    startTransition(async () => {
      const settings = Object.fromEntries(
        Object.entries(draft).map(([key, value]) => [
          key,
          value
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        ]),
      ) as SourceSettings;
      const result =
        kind === "save"
          ? await saveSourcesAction(settings)
          : await checkSourcesAction();
      setFeedback({
        error: result.status === "error",
        message: result.message,
      });
      if (result.status === "success") {
        setOverview(result.overview);
        if (kind === "save") setDraft(inputText(result.overview.settings));
      }
      setOperation(null);
    });
  };
  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Fontes da busca</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Configure as empresas que deseja acompanhar e confira a cobertura da
          busca. Esta lista vale para todos os perfis.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Jobbol, Solutis, Uberlândia Inovadora, Ashby e Lever abrem o Chrome e
          aplicam os filtros disponíveis em cada site. Uma nova pesquisa
          consulta as fontes novamente. Se o site pedir verificação de acesso,
          conclua na aba aberta e repita a pesquisa.
        </p>
      </header>
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Murais de empresas</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Cole um link de mural ou identificador por linha. Greenhouse, Ashby e
          Lever consultam somente as empresas desta lista. Salvar valida todos
          os murais antes de substituir a configuração atual. Links do Ashby com
          filtro de departamento e links do Lever com filtro de equipe mantêm
          essa seleção na busca.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("save");
          }}
          className="flex flex-col gap-4"
        >
          {(["greenhouse", "ashby", "lever"] as const).map((kind) => (
            <Field
              key={kind}
              label={names[kind]}
              multiline
              value={draft[kind]}
              placeholder={
                kind === "greenhouse"
                  ? "https://job-boards.greenhouse.io/empresa"
                  : kind === "ashby"
                    ? "https://jobs.ashbyhq.com/empresa"
                    : "https://jobs.lever.co/empresa"
              }
              onValueChange={(value) => setDraft({ ...draft, [kind]: value })}
            />
          ))}
          <button
            disabled={pending}
            type="submit"
            className="self-start cursor-pointer rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending && operation === "save"
              ? "Validando murais…"
              : "Validar e salvar murais"}
          </button>
        </form>
      </section>
      {feedback && (
        <p
          role="status"
          className={`text-sm ${feedback.error ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
        >
          {feedback.message}
        </p>
      )}
      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Resultado por fonte</h2>
          <button
            type="button"
            disabled={pending}
            onClick={() => run("check")}
            className="cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {pending && operation === "check"
              ? "Consultando fontes…"
              : "Testar configuração salva"}
          </button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          O teste usa “python” e inclui a busca ampliada. As contagens são
          anteriores aos filtros do seu perfil. Alterações ainda não salvas não
          entram no teste.
        </p>
        {overview.checkedAt && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Última consulta:{" "}
            {new Date(overview.checkedAt).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}{" "}
            (horário de Brasília).
          </p>
        )}
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {overview.sources.map((source) => (
            <li key={source.name} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {names[source.name] ?? source.name}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {states[source.status]}
                  {["ok", "empty", "partial"].includes(source.status)
                    ? ` · ${source.count} anúncios`
                    : ""}
                </span>
              </div>
              <p className="break-words text-xs text-zinc-500 dark:text-zinc-400">
                {source.message}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Alertas do LinkedIn</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          O app lê alertas de vagas recebidos por email e sincronizados. Ele não
          pesquisa diretamente no LinkedIn.
        </p>
        <p className="text-sm">
          {overview.email.configured
            ? "Configuração de email presente. Confira a sincronização na aba Emails."
            : `Falta configurar: ${overview.email.missingFields.join(", ")}.`}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No arquivo recruiter-backend/.env, configure o servidor IMAP, seu
          email e uma senha de app. Para Gmail: host imap.gmail.com e porta 993.
          Depois reinicie a API. No Gmail, crie o rótulo “
          {overview.email.mailbox}”, disponibilize-o no IMAP e aplique-o aos
          alertas de jobalerts-noreply@linkedin.com.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/emails" className="underline underline-offset-4">
            Abrir Emails
          </Link>
          <a
            href="https://support.google.com/accounts/answer/185833?hl=pt-BR"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Como criar uma senha de app
          </a>
        </div>
      </section>
    </div>
  );
}
